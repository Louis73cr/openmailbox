use std::collections::HashMap;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use mail_model::{
    Authentication, Error, Result, Security, ServerConfig, ServerEndpoint, now_millis,
};
use ring::rand::SecureRandom;
use serde::Deserialize;

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const PERSONAL_TENANT: &str = "9188040d-6c67-4c5b-b112-36a304b66dad";
const GRAPH_SEND_SCOPE: &str = "https://graph.microsoft.com/Mail.Send";

struct Provider {
    authorize_url: &'static str,
    token_url: &'static str,
    client_id: &'static str,
    redirect_uri: &'static str,
    scope: &'static str,
    parameters: &'static [(&'static str, &'static str)],
}

const MICROSOFT: Provider = Provider {
    authorize_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    client_id: "37493326-2866-414d-bc1b-58b84101bac1",
    redirect_uri: "openmailbox://oauth",
    scope: "openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    parameters: &[("prompt", "select_account")],
};

#[cfg(target_os = "android")]
const GOOGLE_CLIENT: (&str, &str) = (
    "894628345620-57teil6uf23hnhek3in2g82b19b9ieac.apps.googleusercontent.com",
    "com.soluce.openmailbox:/oauth2redirect",
);

#[cfg(not(target_os = "android"))]
const GOOGLE_CLIENT: (&str, &str) = (
    "894628345620-n02dmit6km3lipioghk4r6unjnmr5l98.apps.googleusercontent.com",
    "com.googleusercontent.apps.894628345620-n02dmit6km3lipioghk4r6unjnmr5l98:/oauth2redirect",
);

const GOOGLE: Provider = Provider {
    authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
    token_url: "https://oauth2.googleapis.com/token",
    client_id: GOOGLE_CLIENT.0,
    redirect_uri: GOOGLE_CLIENT.1,
    scope: "openid email profile https://mail.google.com/",
    parameters: &[("access_type", "offline"), ("prompt", "select_account")],
};

fn provider(authentication: Authentication) -> Result<&'static Provider> {
    match authentication {
        Authentication::Microsoft => Ok(&MICROSOFT),
        Authentication::Google => Ok(&GOOGLE),
        Authentication::Password => Err(Error::InvalidInput("not an OAuth provider".into())),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignInRequest {
    pub url: String,
    pub redirect_uri: String,
}

#[derive(Debug, Clone)]
pub struct PendingSignIn {
    pub provider: Authentication,
    pub state: String,
    pub verifier: String,
    pub redirect_uri: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub email: String,
    pub name: Option<String>,
    pub tenant: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Grant {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
    pub identity: Option<Identity>,
}

pub fn begin(
    authentication: Authentication,
    login_hint: Option<&str>,
) -> Result<(SignInRequest, PendingSignIn)> {
    let provider = provider(authentication)?;
    let mut random = [0u8; 32];
    ring::rand::SystemRandom::new()
        .fill(&mut random)
        .map_err(|_| Error::InvalidInput("no randomness".into()))?;
    let verifier = URL_SAFE_NO_PAD.encode(random);
    let challenge = URL_SAFE_NO_PAD.encode(ring::digest::digest(
        &ring::digest::SHA256,
        verifier.as_bytes(),
    ));
    let state = uuid::Uuid::new_v4().simple().to_string();
    let scope = match authentication {
        Authentication::Microsoft => format!("{} {GRAPH_SEND_SCOPE}", provider.scope),
        _ => provider.scope.to_owned(),
    };
    let mut parameters = vec![
        ("client_id", provider.client_id),
        ("response_type", "code"),
        ("redirect_uri", provider.redirect_uri),
        ("scope", scope.as_str()),
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
    ];
    parameters.extend_from_slice(provider.parameters);
    if let Some(hint) = login_hint {
        parameters.push(("login_hint", hint));
    }
    let url = url::Url::parse_with_params(provider.authorize_url, parameters)
        .map_err(|error| Error::InvalidInput(error.to_string()))?;
    Ok((
        SignInRequest {
            url: url.into(),
            redirect_uri: provider.redirect_uri.to_owned(),
        },
        PendingSignIn {
            provider: authentication,
            state,
            verifier,
            redirect_uri: provider.redirect_uri.to_owned(),
        },
    ))
}

pub fn authorization_code(callback_url: &str, pending: &PendingSignIn) -> Result<String> {
    let url =
        url::Url::parse(callback_url).map_err(|error| Error::InvalidInput(error.to_string()))?;
    let mut answer: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if answer.get("state") != Some(&pending.state) {
        return Err(Error::InvalidInput("unexpected sign-in answer".into()));
    }
    if let Some(error) = answer.remove("error") {
        if answer.get("error_subcode").map(String::as_str) == Some("cancel") {
            return Err(Error::Cancelled);
        }
        return Err(Error::Server(
            answer.remove("error_description").unwrap_or(error),
        ));
    }
    answer
        .remove("code")
        .ok_or_else(|| Error::InvalidInput("sign-in answer without a code".into()))
}

fn exchange_form(pending: &PendingSignIn, code: &str) -> Vec<(&'static str, String)> {
    let mut form = vec![
        ("grant_type", "authorization_code".to_owned()),
        ("code", code.to_owned()),
        ("redirect_uri", pending.redirect_uri.clone()),
        ("code_verifier", pending.verifier.clone()),
    ];
    if pending.provider == Authentication::Microsoft {
        form.push(("scope", MICROSOFT.scope.to_owned()));
    }
    form
}

pub async fn exchange(pending: &PendingSignIn, code: &str) -> Result<Grant> {
    request_token(provider(pending.provider)?, exchange_form(pending, code)).await
}

fn graph_refresh_form(refresh_token: &str) -> Vec<(&'static str, String)> {
    vec![
        ("grant_type", "refresh_token".to_owned()),
        ("refresh_token", refresh_token.to_owned()),
        ("scope", format!("{GRAPH_SEND_SCOPE} offline_access")),
    ]
}

pub async fn graph_grant(refresh_token: &str) -> Result<Grant> {
    request_token(&MICROSOFT, graph_refresh_form(refresh_token)).await
}

fn refresh_form(
    authentication: Authentication,
    refresh_token: &str,
) -> Vec<(&'static str, String)> {
    let mut form = vec![
        ("grant_type", "refresh_token".to_owned()),
        ("refresh_token", refresh_token.to_owned()),
    ];
    if authentication == Authentication::Microsoft {
        form.push(("scope", MICROSOFT.scope.to_owned()));
    }
    form
}

pub async fn refresh(authentication: Authentication, refresh_token: &str) -> Result<Grant> {
    request_token(
        provider(authentication)?,
        refresh_form(authentication, refresh_token),
    )
    .await
}

async fn request_token(
    provider: &'static Provider,
    mut form: Vec<(&'static str, String)>,
) -> Result<Grant> {
    form.push(("client_id", provider.client_id.to_owned()));
    let (status, body) = tokio::task::spawn_blocking(move || post_form(provider.token_url, &form))
        .await
        .map_err(|error| Error::Network(error.to_string()))??;
    parse_grant(status, &body, now_millis())
}

fn post_form(url: &str, form: &[(&str, String)]) -> Result<(u16, String)> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(HTTP_TIMEOUT))
        .http_status_as_error(false)
        .build()
        .into();
    let mut response = agent
        .post(url)
        .send_form(form.iter().map(|(name, value)| (*name, value.as_str())))
        .map_err(|error| Error::Network(error.to_string()))?;
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|error| Error::Network(error.to_string()))?;
    Ok((status, body))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    id_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct Claims {
    email: Option<String>,
    preferred_username: Option<String>,
    name: Option<String>,
    tid: Option<String>,
}

fn parse_grant(status: u16, body: &str, now: i64) -> Result<Grant> {
    if status == 429 || status >= 500 {
        return Err(Error::Network(format!(
            "sign-in service unavailable ({status})"
        )));
    }
    let response: TokenResponse = serde_json::from_str(body)
        .map_err(|_| Error::Network(format!("unreadable sign-in answer ({status})")))?;
    if let Some(error) = response.error {
        return Err(match error.as_str() {
            "invalid_grant" | "interaction_required" | "consent_required" | "login_required" => {
                Error::Auth
            }
            _ => Error::Server(response.error_description.unwrap_or(error)),
        });
    }
    let access_token = response
        .access_token
        .ok_or_else(|| Error::Server("no access token".into()))?;
    Ok(Grant {
        access_token,
        refresh_token: response.refresh_token,
        expires_at: now + response.expires_in.unwrap_or(3600) * 1000,
        identity: response.id_token.as_deref().and_then(identity),
    })
}

fn identity(id_token: &str) -> Option<Identity> {
    let payload = URL_SAFE_NO_PAD
        .decode(id_token.split('.').nth(1)?.trim_end_matches('='))
        .ok()?;
    let claims: Claims = serde_json::from_slice(&payload).ok()?;
    Some(Identity {
        email: claims
            .email
            .or(claims.preferred_username)?
            .trim()
            .to_owned(),
        name: claims.name.filter(|name| !name.trim().is_empty()),
        tenant: claims.tid,
    })
}

pub fn servers(authentication: Authentication, identity: &Identity) -> ServerConfig {
    let endpoint = |host: &str, port, security| ServerEndpoint {
        host: host.to_owned(),
        port,
        security,
    };
    let (imap, smtp) = match authentication {
        Authentication::Google => (
            endpoint("imap.gmail.com", 993, Security::Tls),
            endpoint("smtp.gmail.com", 465, Security::Tls),
        ),
        _ => (
            endpoint("outlook.office365.com", 993, Security::Tls),
            if identity.tenant.as_deref() == Some(PERSONAL_TENANT) {
                endpoint("smtp-mail.outlook.com", 587, Security::StartTls)
            } else {
                endpoint("smtp.office365.com", 587, Security::StartTls)
            },
        ),
    };
    ServerConfig {
        imap,
        smtp,
        username: identity.email.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use mail_model::{Authentication, Error, Security};

    use super::*;

    fn query(url: &str) -> HashMap<String, String> {
        url::Url::parse(url)
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect()
    }

    fn scopes(query: &HashMap<String, String>) -> Vec<String> {
        query["scope"].split(' ').map(str::to_owned).collect()
    }

    #[test]
    fn microsoft_request_uses_pkce_and_hint() {
        let (request, pending) =
            begin(Authentication::Microsoft, Some("alice@outlook.com")).unwrap();
        let url = url::Url::parse(&request.url).unwrap();
        assert_eq!(url.host_str(), Some("login.microsoftonline.com"));
        assert_eq!(url.path(), "/common/oauth2/v2.0/authorize");
        let query = query(&request.url);
        assert_eq!(query["client_id"], "37493326-2866-414d-bc1b-58b84101bac1");
        assert_eq!(query["redirect_uri"], "openmailbox://oauth");
        assert_eq!(request.redirect_uri, "openmailbox://oauth");
        assert_eq!(query["response_type"], "code");
        assert_eq!(query["code_challenge_method"], "S256");
        let digest = ring::digest::digest(&ring::digest::SHA256, pending.verifier.as_bytes());
        assert_eq!(query["code_challenge"], URL_SAFE_NO_PAD.encode(digest));
        assert_eq!(query["prompt"], "select_account");
        assert_eq!(query["login_hint"], "alice@outlook.com");
        assert_eq!(query["state"], pending.state);
        assert!(scopes(&query).contains(&"offline_access".to_owned()));
        assert!(
            scopes(&query).contains(&"https://outlook.office.com/IMAP.AccessAsUser.All".to_owned())
        );
        assert!(scopes(&query).contains(&"https://outlook.office.com/SMTP.Send".to_owned()));
        assert!(pending.verifier.len() >= 43);
        let (again, other) = begin(Authentication::Microsoft, None).unwrap();
        assert_ne!(other.state, pending.state);
        assert!(!self::query(&again.url).contains_key("login_hint"));
    }

    #[test]
    fn google_request_asks_offline_mail_access() {
        let (request, _) = begin(Authentication::Google, None).unwrap();
        let url = url::Url::parse(&request.url).unwrap();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(url.path(), "/o/oauth2/v2/auth");
        let query = query(&request.url);
        assert!(scopes(&query).contains(&"https://mail.google.com/".to_owned()));
        assert_eq!(query["access_type"], "offline");
        assert!(query["client_id"].ends_with(".apps.googleusercontent.com"));
        assert!(matches!(
            begin(Authentication::Password, None),
            Err(Error::InvalidInput(_))
        ));
    }

    #[test]
    fn callback_checks_state() {
        let (_, pending) = begin(Authentication::Microsoft, None).unwrap();
        let state = &pending.state;
        assert_eq!(
            authorization_code(
                &format!("openmailbox://oauth?code=abc&state={state}"),
                &pending
            )
            .unwrap(),
            "abc"
        );
        assert!(matches!(
            authorization_code("openmailbox://oauth?code=abc&state=other", &pending),
            Err(Error::InvalidInput(_))
        ));
        assert!(matches!(
            authorization_code(
                &format!(
                    "openmailbox://oauth?error=access_denied&error_subcode=cancel&state={state}"
                ),
                &pending
            ),
            Err(Error::Cancelled)
        ));
        assert!(matches!(
            authorization_code(
                &format!("openmailbox://oauth?error=consent_required&error_description=Need%20admin&state={state}"),
                &pending
            ),
            Err(Error::Server(message)) if message == "Need admin"
        ));
    }

    fn id_token(claims: &str) -> String {
        format!("e30.{}.signature", URL_SAFE_NO_PAD.encode(claims))
    }

    #[test]
    fn grant_reads_tokens_and_identity() {
        let microsoft = serde_json::json!({
            "access_token": "at",
            "refresh_token": "rt",
            "expires_in": 3600,
            "id_token": id_token(r#"{"preferred_username":"a@outlook.com","name":"A","tid":"9188040d-6c67-4c5b-b112-36a304b66dad"}"#),
        });
        let grant = parse_grant(200, &microsoft.to_string(), 1_000).unwrap();
        assert_eq!(grant.access_token, "at");
        assert_eq!(grant.refresh_token.as_deref(), Some("rt"));
        assert_eq!(grant.expires_at, 1_000 + 3_600_000);
        let identity = grant.identity.unwrap();
        assert_eq!(identity.email, "a@outlook.com");
        assert_eq!(identity.name.as_deref(), Some("A"));
        assert_eq!(identity.tenant.as_deref(), Some(PERSONAL_TENANT));

        let google = serde_json::json!({
            "access_token": "at",
            "expires_in": 3599,
            "id_token": id_token(r#"{"email":"b@gmail.com","name":"B"}"#),
        });
        let grant = parse_grant(200, &google.to_string(), 0).unwrap();
        assert_eq!(grant.identity.unwrap().email, "b@gmail.com");
        assert_eq!(grant.refresh_token, None);

        assert!(matches!(
            parse_grant(
                400,
                r#"{"error":"invalid_grant","error_description":"expired"}"#,
                0
            ),
            Err(Error::Auth)
        ));
        assert!(matches!(
            parse_grant(400, r#"{"error":"invalid_client","error_description":"bad client"}"#, 0),
            Err(Error::Server(message)) if message == "bad client"
        ));
    }

    #[test]
    fn token_endpoint_trouble_is_temporary() {
        assert!(matches!(
            parse_grant(503, "<html>Service Unavailable</html>", 0),
            Err(Error::Network(_))
        ));
        assert!(matches!(parse_grant(429, "{}", 0), Err(Error::Network(_))));
        let unreadable = r#"{"access_token":"secret-at","expires_in":"soon"}"#;
        match parse_grant(200, unreadable, 0) {
            Err(Error::Network(message)) => assert!(!message.contains("secret-at")),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn a_refresh_the_provider_refuses_needs_a_new_sign_in() {
        for error in [
            "invalid_grant",
            "interaction_required",
            "consent_required",
            "login_required",
        ] {
            let body = format!(r#"{{"error":"{error}","error_description":"sign in"}}"#);
            assert!(
                matches!(parse_grant(400, &body, 0), Err(Error::Auth)),
                "{error}"
            );
        }
    }

    #[test]
    fn microsoft_refreshes_name_the_mail_scopes() {
        let scope = |form: Vec<(&str, String)>| {
            form.into_iter()
                .find(|(name, _)| *name == "scope")
                .map(|(_, value)| value)
        };
        let microsoft = scope(refresh_form(Authentication::Microsoft, "rt")).unwrap();
        assert!(microsoft.contains("https://outlook.office.com/IMAP.AccessAsUser.All"));
        assert!(microsoft.contains("offline_access"));
        assert_eq!(scope(refresh_form(Authentication::Google, "rt")), None);
    }

    fn form_value(form: &[(&str, String)], name: &str) -> Option<String> {
        form.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.clone())
    }

    #[test]
    fn microsoft_sign_in_also_asks_to_send_through_graph() {
        let (request, pending) = begin(Authentication::Microsoft, None).unwrap();
        assert!(scopes(&query(&request.url)).contains(&GRAPH_SEND_SCOPE.to_owned()));
        let exchange = form_value(&exchange_form(&pending, "code"), "scope").unwrap();
        assert!(exchange.contains("https://outlook.office.com/IMAP.AccessAsUser.All"));
        assert!(!exchange.contains("graph.microsoft.com"));
        let (_, google) = begin(Authentication::Google, None).unwrap();
        assert_eq!(form_value(&exchange_form(&google, "code"), "scope"), None);
    }

    #[test]
    fn a_graph_token_is_redeemed_for_mail_send_only() {
        let form = graph_refresh_form("rt");
        assert_eq!(
            form_value(&form, "grant_type").as_deref(),
            Some("refresh_token")
        );
        assert_eq!(form_value(&form, "refresh_token").as_deref(), Some("rt"));
        assert_eq!(
            form_value(&form, "scope").as_deref(),
            Some("https://graph.microsoft.com/Mail.Send offline_access")
        );
    }

    #[test]
    fn servers_follow_the_tenant() {
        let identity = |tenant: Option<&str>| Identity {
            email: "a@contoso.com".into(),
            name: None,
            tenant: tenant.map(str::to_owned),
        };
        let personal = servers(Authentication::Microsoft, &identity(Some(PERSONAL_TENANT)));
        assert_eq!(personal.imap.host, "outlook.office365.com");
        assert_eq!(personal.imap.port, 993);
        assert_eq!(personal.smtp.host, "smtp-mail.outlook.com");
        assert_eq!(personal.smtp.port, 587);
        assert_eq!(personal.smtp.security, Security::StartTls);
        assert_eq!(personal.username, "a@contoso.com");
        let work = servers(Authentication::Microsoft, &identity(Some("72f988bf-0000")));
        assert_eq!(work.smtp.host, "smtp.office365.com");
        let google = servers(Authentication::Google, &identity(None));
        assert_eq!(
            (google.imap.host.as_str(), google.imap.port),
            ("imap.gmail.com", 993)
        );
        assert_eq!(
            (google.smtp.host.as_str(), google.smtp.port),
            ("smtp.gmail.com", 465)
        );
        assert_eq!(google.smtp.security, Security::Tls);
    }
}
