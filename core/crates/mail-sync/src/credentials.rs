use std::future::Future;
use std::sync::Arc;

use mail_auth::oauth::{self, Grant};
use mail_model::{Account, Authentication, CoreEvent, Credential, Error, Result, now_millis};

use crate::events::Events;
use crate::worker::Secret;

const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;
const GRAPH_CONSENT_NEEDED: &str = "Microsoft needs a new sign-in to send this message: open the account settings and choose Sign in Again.";

pub type TokenCache = Arc<tokio::sync::Mutex<Option<(String, i64)>>>;

fn fresh(expires_at: i64, now: i64) -> bool {
    expires_at - now > REFRESH_MARGIN_MS
}

fn read(secret: &Secret) -> Option<String> {
    secret
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn store_refresh_token(
    account_id: &str,
    refresh_token: Option<String>,
    secret: &Secret,
    events: &Events,
) {
    if let Some(refresh_token) = refresh_token {
        let mut current = secret
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if current.as_deref() != Some(refresh_token.as_str()) {
            *current = Some(refresh_token.clone());
            events.emit(CoreEvent::SecretChanged {
                account_id: account_id.to_owned(),
                secret: refresh_token,
            });
        }
    }
}

pub fn keep_grant(
    account_id: &str,
    grant: Grant,
    secret: &Secret,
    cached: &mut Option<(String, i64)>,
    events: &Events,
) -> String {
    store_refresh_token(account_id, grant.refresh_token, secret, events);
    *cached = Some((grant.access_token.clone(), grant.expires_at));
    grant.access_token
}

async fn graph_access_token<F, R>(
    account_id: &str,
    tokens: &TokenCache,
    secret: &Secret,
    events: &Events,
    redeem: F,
) -> Result<String>
where
    F: FnOnce(String) -> R,
    R: Future<Output = Result<Grant>>,
{
    let _serialized = tokens.lock().await;
    let refresh_token = read(secret).ok_or(Error::Auth)?;
    let grant = redeem(refresh_token).await.map_err(|error| match error {
        Error::Auth => Error::Server(GRAPH_CONSENT_NEEDED.into()),
        other => other,
    })?;
    store_refresh_token(account_id, grant.refresh_token, secret, events);
    Ok(grant.access_token)
}

pub async fn graph_token(
    account: &Account,
    secret: &Secret,
    tokens: &TokenCache,
    events: &Events,
) -> Result<String> {
    graph_access_token(
        &account.id,
        tokens,
        secret,
        events,
        |refresh_token| async move { oauth::graph_grant(&refresh_token).await },
    )
    .await
}

async fn access_token<F, R>(
    account_id: &str,
    tokens: &TokenCache,
    secret: &Secret,
    events: &Events,
    refresh: F,
) -> Result<String>
where
    F: FnOnce(String) -> R,
    R: Future<Output = Result<Grant>>,
{
    let mut cached = tokens.lock().await;
    if let Some((token, expires_at)) = cached.as_ref()
        && fresh(*expires_at, now_millis())
    {
        return Ok(token.clone());
    }
    let refresh_token = read(secret).ok_or(Error::Auth)?;
    let grant = match refresh(refresh_token.clone()).await {
        Err(Error::Auth) => {
            let mut current = secret
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if current.as_deref() == Some(refresh_token.as_str()) {
                *current = None;
            }
            events.emit(CoreEvent::AuthRequired {
                account_id: account_id.to_owned(),
            });
            return Err(Error::Auth);
        }
        result => result?,
    };
    Ok(keep_grant(account_id, grant, secret, &mut cached, events))
}

pub async fn credential(
    account: &Account,
    secret: &Secret,
    tokens: &TokenCache,
    events: &Events,
) -> Result<Credential> {
    match account.authentication {
        Authentication::Password => read(secret).map(Credential::Password).ok_or(Error::Auth),
        provider => access_token(
            &account.id,
            tokens,
            secret,
            events,
            |refresh_token| async move { oauth::refresh(provider, &refresh_token).await },
        )
        .await
        .map(Credential::AccessToken),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex, RwLock};
    use std::time::Duration;

    use mail_auth::oauth::Grant;
    use mail_model::CoreEvent;

    use super::*;
    use crate::events::Events;

    fn recorded(events: &Events) -> Arc<Mutex<Vec<CoreEvent>>> {
        let seen: Arc<Mutex<Vec<CoreEvent>>> = Arc::default();
        let sink = seen.clone();
        events.set_sink(Arc::new(move |event| sink.lock().unwrap().push(event)));
        seen
    }

    fn grant(access_token: &str, refresh_token: Option<&str>) -> Grant {
        Grant {
            access_token: access_token.into(),
            refresh_token: refresh_token.map(str::to_owned),
            expires_at: now_millis() + 3_600_000,
            identity: None,
        }
    }

    #[test]
    fn a_token_is_fresh_with_more_than_five_minutes_left() {
        assert!(fresh(1_000 + 5 * 60 * 1000 + 1, 1_000));
        assert!(!fresh(1_000 + 5 * 60 * 1000, 1_000));
        assert!(!fresh(0, 1_000));
    }

    #[test]
    fn a_new_refresh_token_replaces_the_secret_and_is_announced_once() {
        let events = Events::start();
        let seen = recorded(&events);
        let secret: Secret = Arc::new(RwLock::new(Some("old".into())));
        let mut cached = None;
        assert_eq!(
            keep_grant(
                "a",
                grant("at1", Some("new")),
                &secret,
                &mut cached,
                &events
            ),
            "at1"
        );
        keep_grant(
            "a",
            grant("at2", Some("new")),
            &secret,
            &mut cached,
            &events,
        );
        keep_grant("a", grant("at3", None), &secret, &mut cached, &events);
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(secret.read().unwrap().as_deref(), Some("new"));
        assert_eq!(
            cached.as_ref().map(|(token, _)| token.as_str()),
            Some("at3")
        );
        assert_eq!(
            *seen.lock().unwrap(),
            vec![CoreEvent::SecretChanged {
                account_id: "a".into(),
                secret: "new".into()
            }]
        );
    }

    #[tokio::test]
    async fn concurrent_logins_refresh_once() {
        let events = Events::start();
        let secret: Secret = Arc::new(RwLock::new(Some("rt".into())));
        let tokens = TokenCache::default();
        let calls = AtomicUsize::new(0);
        let refresh = |_: String| async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(50)).await;
            Ok(grant("at", Some("rt")))
        };
        let (first, second) = tokio::join!(
            access_token("a", &tokens, &secret, &events, refresh),
            access_token("a", &tokens, &secret, &events, refresh),
        );
        assert_eq!(first.unwrap(), "at");
        assert_eq!(second.unwrap(), "at");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_refused_refresh_stops_asking_until_signed_in_again() {
        let events = Events::start();
        let seen = recorded(&events);
        let secret: Secret = Arc::new(RwLock::new(Some("dead".into())));
        let tokens = TokenCache::default();
        let calls = AtomicUsize::new(0);
        let refuse = |_: String| async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(Error::Auth)
        };
        assert!(matches!(
            access_token("a", &tokens, &secret, &events, refuse).await,
            Err(Error::Auth)
        ));
        assert!(matches!(
            access_token("a", &tokens, &secret, &events, refuse).await,
            Err(Error::Auth)
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(*secret.read().unwrap(), None);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(seen.lock().unwrap().contains(&CoreEvent::AuthRequired {
            account_id: "a".into()
        }));
    }

    #[tokio::test]
    async fn a_graph_token_leaves_the_mail_token_and_saves_a_rotated_secret() {
        let events = Events::start();
        let seen = recorded(&events);
        let secret: Secret = Arc::new(RwLock::new(Some("rt".into())));
        let tokens: TokenCache = Arc::new(tokio::sync::Mutex::new(Some((
            "mail-at".into(),
            now_millis() + 3_600_000,
        ))));
        let token = graph_access_token("a", &tokens, &secret, &events, |_| async {
            Ok(grant("graph-at", Some("rt2")))
        })
        .await
        .unwrap();
        assert_eq!(token, "graph-at");
        assert_eq!(
            tokens.lock().await.as_ref().map(|(token, _)| token.clone()),
            Some("mail-at".into())
        );
        assert_eq!(secret.read().unwrap().as_deref(), Some("rt2"));
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(seen.lock().unwrap().contains(&CoreEvent::SecretChanged {
            account_id: "a".into(),
            secret: "rt2".into()
        }));
    }

    #[tokio::test]
    async fn a_graph_refusal_asks_to_sign_in_again_without_signing_out() {
        let events = Events::start();
        let seen = recorded(&events);
        let secret: Secret = Arc::new(RwLock::new(Some("rt".into())));
        let result = graph_access_token("a", &TokenCache::default(), &secret, &events, |_| async {
            Err(Error::Auth)
        })
        .await;
        assert!(matches!(result, Err(Error::Server(message)) if message.contains("Sign in Again")));
        assert_eq!(secret.read().unwrap().as_deref(), Some("rt"));
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_missing_secret_needs_a_new_sign_in() {
        let events = Events::start();
        let secret: Secret = Arc::new(RwLock::new(None));
        let result = access_token("a", &TokenCache::default(), &secret, &events, |_| async {
            Ok(grant("at", None))
        })
        .await;
        assert!(matches!(result, Err(Error::Auth)));
    }
}
