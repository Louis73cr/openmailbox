use std::time::Duration;

use mail_model::{Error, OAuthServer, Result};
use serde::Deserialize;

pub const REDIRECT_URI: &str = "com.soluce.openmailbox:/oauth";
pub const MAIL_SCOPE: &str = "urn:ietf:params:oauth:scope:mail openid offline_access";
const MAIL_SCOPE_NAME: &str = "urn:ietf:params:oauth:scope:mail";
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerMetadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: String,
}

fn unusable(reason: &str) -> Error {
    Error::Server(format!(
        "the server's OAuth settings are not usable ({reason})"
    ))
}

fn https(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| url.scheme() == "https" && url.host_str().is_some())
}

fn check_issuer(issuer: &str) -> Result<url::Url> {
    let url = url::Url::parse(issuer)
        .map_err(|_| Error::InvalidInput(format!("invalid OAuth issuer {issuer}")))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::InvalidInput(format!(
            "invalid OAuth issuer {issuer}"
        )));
    }
    Ok(url)
}

fn metadata_url(issuer: &str) -> Result<String> {
    let url = check_issuer(issuer)?;
    Ok(format!(
        "{}/.well-known/oauth-authorization-server{}",
        url.origin().ascii_serialization(),
        url.path().trim_end_matches('/')
    ))
}

fn openid_configuration_url(issuer: &str) -> String {
    format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    )
}

#[derive(Deserialize)]
struct Document {
    issuer: Option<String>,
    authorization_endpoint: Option<String>,
    token_endpoint: Option<String>,
    registration_endpoint: Option<String>,
    #[serde(default)]
    response_types_supported: Vec<String>,
    #[serde(default)]
    grant_types_supported: Vec<String>,
    #[serde(default)]
    token_endpoint_auth_methods_supported: Vec<String>,
    #[serde(default)]
    code_challenge_methods_supported: Vec<String>,
    #[serde(default)]
    authorization_response_iss_parameter_supported: bool,
}

fn supports(values: &[String], wanted: &str) -> bool {
    values.iter().any(|value| value == wanted)
}

fn parse_metadata(body: &str, issuer: &str) -> Result<ServerMetadata> {
    let document: Document =
        serde_json::from_str(body).map_err(|_| unusable("unreadable metadata"))?;
    if document.issuer.as_deref() != Some(issuer) {
        return Err(unusable("issuer mismatch"));
    }
    let endpoint = |value: Option<String>, name: &str| {
        value
            .filter(|value| https(value))
            .ok_or_else(|| unusable(name))
    };
    let authorization_endpoint =
        endpoint(document.authorization_endpoint, "authorization endpoint")?;
    let token_endpoint = endpoint(document.token_endpoint, "token endpoint")?;
    let registration_endpoint = endpoint(document.registration_endpoint, "registration endpoint")?;
    if !supports(&document.response_types_supported, "code")
        || !supports(&document.grant_types_supported, "authorization_code")
        || !supports(&document.grant_types_supported, "refresh_token")
        || !supports(&document.token_endpoint_auth_methods_supported, "none")
        || !supports(&document.code_challenge_methods_supported, "S256")
        || !document.authorization_response_iss_parameter_supported
    {
        return Err(unusable("public clients are not supported"));
    }
    Ok(ServerMetadata {
        issuer: issuer.to_owned(),
        authorization_endpoint,
        token_endpoint,
        registration_endpoint,
    })
}

fn registration_body() -> serde_json::Value {
    serde_json::json!({
        "redirect_uris": [REDIRECT_URI],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "scope": MAIL_SCOPE,
        "client_name": "Open Mailbox",
    })
}

#[derive(Deserialize)]
struct Registration {
    client_id: Option<String>,
    redirect_uris: Option<Vec<String>>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn parse_registration(status: u16, body: &str) -> Result<String> {
    let registration: Registration =
        serde_json::from_str(body).map_err(|_| unusable("unreadable registration"))?;
    if !(200..300).contains(&status) {
        return Err(Error::Server(
            registration
                .error_description
                .or(registration.error)
                .unwrap_or_else(|| format!("registration refused ({status})")),
        ));
    }
    if !registration
        .redirect_uris
        .is_some_and(|uris| uris.iter().any(|uri| uri == REDIRECT_URI))
    {
        return Err(unusable("redirect refused"));
    }
    if registration
        .scope
        .is_some_and(|scope| !scope.split(' ').any(|scope| scope == MAIL_SCOPE_NAME))
    {
        return Err(unusable("mail scope refused"));
    }
    registration
        .client_id
        .filter(|id| !id.is_empty())
        .ok_or_else(|| unusable("no client id"))
}

async fn send(
    request: impl FnOnce() -> Result<(u16, String)> + Send + 'static,
) -> Result<(u16, String)> {
    tokio::task::spawn_blocking(request)
        .await
        .map_err(|error| Error::Network(error.to_string()))?
}

fn read(mut response: ureq::http::Response<ureq::Body>) -> Result<(u16, String)> {
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|error| Error::Network(error.to_string()))?;
    Ok((status, body))
}

async fn get(url: String) -> Result<(u16, String)> {
    send(move || {
        let response = crate::http::agent(&url, HTTP_TIMEOUT)
            .get(&url)
            .header("Accept", "application/json")
            .call()
            .map_err(|error| Error::Network(error.to_string()))?;
        read(response)
    })
    .await
}

#[derive(Deserialize)]
struct Configuration {
    issuer: Option<String>,
}

pub async fn discover(configuration_url: &str) -> Result<ServerMetadata> {
    if !https(configuration_url) {
        return Err(unusable("configuration is not on HTTPS"));
    }
    let (status, body) = get(configuration_url.to_owned()).await?;
    if status != 200 {
        return Err(unusable("configuration unavailable"));
    }
    let issuer = serde_json::from_str::<Configuration>(&body)
        .ok()
        .and_then(|configuration| configuration.issuer)
        .ok_or_else(|| unusable("no issuer"))?;
    let (status, body) = get(metadata_url(&issuer)?).await?;
    let body = if status == 200 {
        body
    } else {
        let (status, body) = get(openid_configuration_url(&issuer)).await?;
        if status != 200 {
            return Err(unusable("metadata unavailable"));
        }
        body
    };
    parse_metadata(&body, &issuer)
}

pub async fn register(metadata: &ServerMetadata) -> Result<OAuthServer> {
    let url = metadata.registration_endpoint.clone();
    let (status, body) = send(move || {
        let response = crate::http::agent(&url, HTTP_TIMEOUT)
            .post(&url)
            .content_type("application/json")
            .send(registration_body().to_string())
            .map_err(|error| Error::Network(error.to_string()))?;
        read(response)
    })
    .await?;
    Ok(OAuthServer {
        issuer: metadata.issuer.clone(),
        authorization_endpoint: metadata.authorization_endpoint.clone(),
        token_endpoint: metadata.token_endpoint.clone(),
        client_id: parse_registration(status, &body)?,
    })
}

#[cfg(test)]
mod tests {
    use mail_model::Error;

    use super::*;

    fn metadata(overrides: serde_json::Value) -> String {
        let mut document = serde_json::json!({
            "issuer": "https://mail.example.org",
            "authorization_endpoint": "https://mail.example.org/login",
            "token_endpoint": "https://mail.example.org/auth/token",
            "registration_endpoint": "https://mail.example.org/auth/register",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "token_endpoint_auth_methods_supported": ["none"],
            "code_challenge_methods_supported": ["S256"],
            "authorization_response_iss_parameter_supported": true,
            "scopes_supported": ["openid", "offline_access", "urn:ietf:params:oauth:scope:mail"]
        });
        for (key, value) in overrides.as_object().unwrap() {
            document[key] = value.clone();
        }
        document.to_string()
    }

    #[test]
    fn metadata_lives_at_the_rfc_8414_address() {
        assert_eq!(
            metadata_url("https://mail.example.org").unwrap(),
            "https://mail.example.org/.well-known/oauth-authorization-server"
        );
        assert_eq!(
            metadata_url("https://example.org/tenant").unwrap(),
            "https://example.org/.well-known/oauth-authorization-server/tenant"
        );
        assert_eq!(
            openid_configuration_url("https://example.org/tenant"),
            "https://example.org/tenant/.well-known/openid-configuration"
        );
        assert_eq!(
            openid_configuration_url("https://example.org/"),
            "https://example.org/.well-known/openid-configuration"
        );
    }

    #[test]
    fn an_issuer_must_be_plain_https() {
        assert!(check_issuer("https://mail.example.org").is_ok());
        for issuer in [
            "http://mail.example.org",
            "https://mail.example.org/?tenant=1",
            "https://mail.example.org/#top",
            "https://alice@mail.example.org",
            "mail.example.org",
        ] {
            assert!(
                matches!(check_issuer(issuer), Err(Error::InvalidInput(_))),
                "{issuer}"
            );
        }
    }

    #[test]
    fn metadata_follows_the_open_public_client_profile() {
        let accepted =
            parse_metadata(&metadata(serde_json::json!({})), "https://mail.example.org").unwrap();
        assert_eq!(
            accepted.token_endpoint,
            "https://mail.example.org/auth/token"
        );
        assert_eq!(
            accepted.registration_endpoint,
            "https://mail.example.org/auth/register"
        );
        for refused in [
            serde_json::json!({"issuer": "https://evil.example"}),
            serde_json::json!({"token_endpoint": "http://mail.example.org/auth/token"}),
            serde_json::json!({"code_challenge_methods_supported": ["plain"]}),
            serde_json::json!({"authorization_response_iss_parameter_supported": false}),
            serde_json::json!({"token_endpoint_auth_methods_supported": ["client_secret_basic"]}),
            serde_json::json!({"registration_endpoint": null}),
        ] {
            assert!(
                parse_metadata(&metadata(refused.clone()), "https://mail.example.org").is_err(),
                "{refused}"
            );
        }
    }

    #[test]
    fn registration_asks_for_a_public_mail_client() {
        let body = registration_body();
        assert_eq!(
            body["redirect_uris"],
            serde_json::json!(["com.soluce.openmailbox:/oauth"])
        );
        assert_eq!(body["token_endpoint_auth_method"], "none");
        assert_eq!(
            body["grant_types"],
            serde_json::json!(["authorization_code", "refresh_token"])
        );
        assert_eq!(body["response_types"], serde_json::json!(["code"]));
        assert_eq!(
            body["scope"],
            "urn:ietf:params:oauth:scope:mail openid offline_access"
        );
        assert_eq!(body["client_name"], "Open Mailbox");
    }

    #[test]
    fn a_registration_answer_must_keep_our_redirect_and_mail_scope() {
        let answer = |overrides: serde_json::Value| {
            let mut document = serde_json::json!({
                "client_id": "swc1.abc",
                "redirect_uris": ["com.soluce.openmailbox:/oauth"],
                "scope": "urn:ietf:params:oauth:scope:mail openid offline_access"
            });
            for (key, value) in overrides.as_object().unwrap() {
                document[key] = value.clone();
            }
            document.to_string()
        };
        assert_eq!(
            parse_registration(201, &answer(serde_json::json!({}))).unwrap(),
            "swc1.abc"
        );
        assert!(
            parse_registration(
                201,
                &answer(serde_json::json!({"redirect_uris": ["com.other:/cb"]}))
            )
            .is_err()
        );
        assert!(parse_registration(201, &answer(serde_json::json!({"scope": "openid"}))).is_err());
        assert!(parse_registration(201, &answer(serde_json::json!({"client_id": null}))).is_err());
        assert!(matches!(
            parse_registration(400, r#"{"error":"invalid_redirect_uri","error_description":"no"}"#),
            Err(Error::Server(message)) if message == "no"
        ));
    }
}
