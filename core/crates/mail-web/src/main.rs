//! HTTP bridge for the web build: runs the same `MailCore` the phone runs, one per user, and
//! exposes its methods as JSON RPC. Users come from a trusted reverse-proxy header (Authentik).

use std::collections::HashMap;
use std::convert::Infallible;
use std::net::{IpAddr, ToSocketAddrs};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Path as UrlPath, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::Stream;
use mail_ffi::*;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tokio::sync::broadcast;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::services::{ServeDir, ServeFile};

/// Secret sent by the browser to mean "use the password the server keeps".
const STORED_SECRET: &str = "\u{0}stored";

struct UserCore {
    core: Arc<MailCore>,
    events: broadcast::Sender<String>,
    dir: PathBuf,
    secrets: Mutex<HashMap<String, String>>,
}

impl UserCore {
    fn save_secrets(&self) {
        let secrets = self.secrets.lock().unwrap();
        let path = self.dir.join("secrets.json");
        let _ = std::fs::write(&path, serde_json::to_vec(&*secrets).unwrap());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }

    fn uploads(&self) -> PathBuf {
        self.dir.join("uploads")
    }
}

struct Sink(broadcast::Sender<String>);

impl EventListener for Sink {
    fn on_event(&self, event: CoreEvent) {
        let _ = self.0.send(serde_json::to_string(&event).unwrap());
    }
}

struct App {
    root: PathBuf,
    user_header: String,
    single_user: Option<String>,
    users: Mutex<HashMap<String, Arc<UserCore>>>,
}

type Shared = Arc<App>;

fn fail(status: StatusCode, message: impl ToString) -> Response {
    (status, message.to_string()).into_response()
}

impl App {
    fn user(&self, headers: &HeaderMap) -> Result<Arc<UserCore>, Response> {
        let name = headers
            .get(&self.user_header)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
            .or_else(|| self.single_user.clone())
            .ok_or_else(|| fail(StatusCode::UNAUTHORIZED, "no user"))?;
        if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || "._-@".contains(c)) {
            return Err(fail(StatusCode::BAD_REQUEST, "bad user name"));
        }
        let mut users = self.users.lock().unwrap();
        if let Some(user) = users.get(&name) {
            return Ok(user.clone());
        }
        let dir = self.root.join(&name);
        std::fs::create_dir_all(dir.join("mail")).map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e))?;
        let core = MailCore::open(dir.join("mail").to_string_lossy().into_owned())
            .map_err(|e| fail(StatusCode::INTERNAL_SERVER_ERROR, e))?;
        let (events, _) = broadcast::channel(256);
        core.subscribe(Arc::new(Sink(events.clone())));
        // The server keeps syncing (and feeding notifications) whether or not a tab is open.
        core.on_foreground();
        let secrets = std::fs::read(dir.join("secrets.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let user = Arc::new(UserCore { core, events, dir, secrets: Mutex::new(secrets) });
        users.insert(name, user.clone());
        Ok(user)
    }
}

fn arg<T: DeserializeOwned>(args: &mut std::vec::IntoIter<Value>) -> Result<T, Response> {
    serde_json::from_value(args.next().unwrap_or(Value::Null))
        .map_err(|e| fail(StatusCode::BAD_REQUEST, e))
}

fn reply<T: serde::Serialize>(result: Result<T, CoreError>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => (StatusCode::UNPROCESSABLE_ENTITY, Json(error)).into_response(),
    }
}

/// Uploaded files only: a draft must not attach arbitrary files of the server.
fn inside(path: &str, dir: &Path) -> bool {
    let path = Path::new(path);
    path.starts_with(dir) && path.components().all(|c| !matches!(c, Component::ParentDir))
}

async fn rpc(
    State(app): State<Shared>,
    headers: HeaderMap,
    UrlPath(method): UrlPath<String>,
    Json(args): Json<Vec<Value>>,
) -> Response {
    let user = match app.user(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    match dispatch(&user, &method, args).await {
        Ok(response) | Err(response) => response,
    }
}

async fn dispatch(user: &UserCore, method: &str, args: Vec<Value>) -> Result<Response, Response> {
    let a = &mut args.into_iter();
    let core = &user.core;
    Ok(match method {
        "discover" => reply(core.discover(arg(a)?).await),
        "addAccount" => {
            let (config, secret): (AccountConfig, String) = (arg(a)?, arg(a)?);
            let result = core.add_account(config, secret.clone()).await;
            if let Ok(account) = &result {
                user.secrets.lock().unwrap().insert(account.id.clone(), secret);
                user.save_secrets();
            }
            reply(result)
        }
        "unlockAccount" => {
            let (id, mut secret): (String, String) = (arg(a)?, arg(a)?);
            if secret == STORED_SECRET {
                match user.secrets.lock().unwrap().get(&id) {
                    Some(stored) => secret = stored.clone(),
                    None => return Err(fail(StatusCode::NOT_FOUND, "no stored secret")),
                }
            }
            core.unlock_account(id, secret);
            reply(Ok(()))
        }
        "updatePassword" => {
            let (id, secret): (String, String) = (arg(a)?, arg(a)?);
            let result = core.update_password(id.clone(), secret.clone()).await;
            if result.is_ok() {
                user.secrets.lock().unwrap().insert(id, secret);
                user.save_secrets();
            }
            reply(result)
        }
        "removeAccount" => {
            let id: String = arg(a)?;
            let result = core.remove_account(id.clone()).await;
            if result.is_ok() {
                user.secrets.lock().unwrap().remove(&id);
                user.save_secrets();
            }
            reply(result)
        }
        "hasSecret" => {
            let id: String = arg(a)?;
            reply::<bool>(Ok(user.secrets.lock().unwrap().contains_key(&id)))
        }
        "listAccounts" => reply(core.list_accounts().await),
        "renameAccount" => reply(core.rename_account(arg(a)?, arg(a)?).await),
        "listMailboxes" => reply(core.list_mailboxes(arg(a)?).await),
        "listThreads" => {
            reply(core.list_threads(arg(a)?, arg(a)?, arg(a)?, arg(a)?, arg(a)?).await)
        }
        "threadEmails" => reply(core.thread_emails(arg(a)?, arg(a)?).await),
        "checkNewMail" => reply(core.check_new_mail(arg(a)?).await),
        "body" => reply(core.body(arg(a)?).await),
        "unsubscribe" => reply(core.unsubscribe(arg(a)?).await),
        "suggestAddresses" => reply(core.suggest_addresses(arg(a)?, arg(a)?).await),
        "search" => reply(core.search(arg(a)?, arg(a)?, arg(a)?).await),
        "setSenderCategory" => reply(core.set_sender_category(arg(a)?, arg(a)?).await),
        "setKeywords" => reply(core.set_keywords(arg(a)?, arg(a)?, arg(a)?).await),
        "setThreadKeywords" => {
            reply(core.set_thread_keywords(arg(a)?, arg(a)?, arg(a)?, arg(a)?).await)
        }
        "moveThread" => reply(core.move_thread(arg(a)?, arg(a)?, arg(a)?, arg(a)?).await),
        "moveEmails" => reply(core.move_emails(arg(a)?, arg(a)?, arg(a)?, arg(a)?).await),
        "send" => {
            let draft: Draft = arg(a)?;
            let uploads = user.uploads();
            if !draft.attachments.iter().all(|file| inside(&file.path, &uploads)) {
                return Err(fail(StatusCode::FORBIDDEN, "attachment outside uploads"));
            }
            let paths: Vec<String> = draft.attachments.iter().map(|f| f.path.clone()).collect();
            let result = core.send(draft).await;
            for path in paths {
                let _ = tokio::fs::remove_file(path).await;
            }
            reply(result)
        }
        "syncNow" => {
            core.sync_now(arg(a)?);
            reply(Ok(()))
        }
        "openMailbox" => reply(core.open_mailbox(arg(a)?).await),
        "loadOlder" => reply(core.load_older(arg(a)?).await),
        "onForeground" => {
            core.on_foreground();
            reply(Ok(()))
        }
        _ => return Err(fail(StatusCode::NOT_FOUND, "unknown method")),
    })
}

async fn events(
    State(app): State<Shared>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, Response> {
    let user = app.user(&headers)?;
    let stream = BroadcastStream::new(user.events.subscribe())
        .filter_map(|event| event.ok())
        .map(|event| Ok(Event::default().data(event)));
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

async fn attachment(
    State(app): State<Shared>,
    headers: HeaderMap,
    UrlPath((email_id, index)): UrlPath<(String, u32)>,
) -> Response {
    let user = match app.user(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let dir = user.dir.join("attachments").join(uuid::Uuid::new_v4().to_string());
    let result = user
        .core
        .save_attachment(email_id, index, dir.to_string_lossy().into_owned())
        .await;
    let response = match result {
        // ponytail: whole file in memory, stream it if huge attachments matter.
        Ok(path) => match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let name = Path::new(&path).file_name().unwrap_or_default().to_string_lossy();
                let disposition = format!(
                    "inline; filename*=UTF-8''{}",
                    name.bytes()
                        .map(|b| if b.is_ascii_alphanumeric() || b".-_".contains(&b) {
                            (b as char).to_string()
                        } else {
                            format!("%{b:02X}")
                        })
                        .collect::<String>()
                );
                (
                    [
                        (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
                        (header::CONTENT_DISPOSITION, disposition),
                    ],
                    bytes,
                )
                    .into_response()
            }
            Err(error) => fail(StatusCode::INTERNAL_SERVER_ERROR, error),
        },
        Err(error) => reply::<()>(Err(error)),
    };
    let _ = tokio::fs::remove_dir_all(&dir).await;
    response
}

async fn upload(
    State(app): State<Shared>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    body: Bytes,
) -> Response {
    let user = match app.user(&headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let name: String = query
        .get("name")
        .map(String::as_str)
        .unwrap_or("file")
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0'))
        .collect();
    let dir = user.uploads().join(uuid::Uuid::new_v4().to_string());
    let path = dir.join(if name.is_empty() || name.starts_with('.') { "file" } else { &name });
    if let Err(error) = tokio::fs::create_dir_all(&dir).await {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, error);
    }
    match tokio::fs::write(&path, &body).await {
        Ok(()) => Json(json!({ "path": path })).into_response(),
        Err(error) => fail(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                || (a == 100 && (b & 0xc0) == 64))
        }
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_public(IpAddr::V4(v4)),
            None => {
                let first = v6.segments()[0];
                !(v6.is_loopback() || v6.is_unspecified() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80)
            }
        },
    }
}

const MAX_IMAGE_BYTES: u64 = 512 * 1024;

/// Fetches a public https image (sender avatars): browsers can't, favicons send no CORS headers.
/// Every hop of a redirect is checked so the proxy never reaches the local network.
fn fetch_image(mut url: url::Url) -> Option<(String, Vec<u8>)> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(std::time::Duration::from_secs(10)))
        .build()
        .into();
    for _ in 0..4 {
        if url.scheme() != "https" {
            return None;
        }
        let addresses = (url.host_str()?, url.port_or_known_default()?).to_socket_addrs().ok()?;
        // ponytail: DNS is resolved twice (here and by ureq), a rebinding race remains; pin the IP if it matters.
        if !addresses.into_iter().all(|address| is_public(address.ip())) {
            return None;
        }
        let mut response = agent.get(url.as_str()).call().ok()?;
        if response.status().is_redirection() {
            let location = response.headers().get(header::LOCATION)?.to_str().ok()?;
            url = url.join(location).ok()?;
            continue;
        }
        if !response.status().is_success() {
            return None;
        }
        let kind = response.headers().get(header::CONTENT_TYPE)?.to_str().ok()?.to_owned();
        if !kind.starts_with("image/") {
            return None;
        }
        let bytes = response.body_mut().with_config().limit(MAX_IMAGE_BYTES).read_to_vec().ok()?;
        return (!bytes.is_empty()).then_some((kind, bytes));
    }
    None
}

async fn image(State(app): State<Shared>, headers: HeaderMap, Query(query): Query<HashMap<String, String>>) -> Response {
    if let Err(response) = app.user(&headers) {
        return response;
    }
    let Some(url) = query.get("url").and_then(|url| url::Url::parse(url).ok()) else {
        return fail(StatusCode::BAD_REQUEST, "bad url");
    };
    match tokio::task::spawn_blocking(move || fetch_image(url)).await.ok().flatten() {
        Some((kind, bytes)) => (
            [
                (header::CONTENT_TYPE, kind),
                (header::CACHE_CONTROL, "private, max-age=604800".to_owned()),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
                // SVG logos stay inert even if opened directly.
                (header::CONTENT_SECURITY_POLICY, "default-src 'none'; style-src 'unsafe-inline'; sandbox".to_owned()),
            ],
            bytes,
        )
            .into_response(),
        None => fail(StatusCode::NOT_FOUND, "no image"),
    }
}

#[tokio::main]
async fn main() {
    let env = |key: &str, default: &str| std::env::var(key).unwrap_or_else(|_| default.into());
    let app = Arc::new(App {
        root: env("DATA_DIR", "/data").into(),
        user_header: env("USER_HEADER", "x-authentik-username").to_lowercase(),
        single_user: std::env::var("SINGLE_USER").ok(),
        users: Mutex::default(),
    });
    let web = PathBuf::from(env("WEB_DIR", "/web"));
    let router = Router::new()
        .route("/api/rpc/{method}", post(rpc))
        .route("/api/events", get(events))
        .route("/api/attachment/{email}/{index}", get(attachment))
        .route("/api/upload", post(upload))
        .route("/api/image", get(image))
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024))
        .fallback_service(ServeDir::new(&web).fallback(ServeFile::new(web.join("index.html"))))
        .with_state(app);
    let address = env("LISTEN", "0.0.0.0:8080");
    let listener = tokio::net::TcpListener::bind(&address).await.unwrap();
    println!("open mailbox web on {address}");
    axum::serve(listener, router)
        .with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; })
        .await
        .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_format_matches_uniffi_typescript() {
        let event = CoreEvent::SyncState {
            account_id: "1".into(),
            status: SyncStatus::Failed { kind: SyncErrorKind::Auth, message: "x".into() },
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            json!({"tag":"SyncState","inner":{"accountId":"1","status":{"tag":"Failed","inner":{"kind":1,"message":"x"}}}})
        );
        assert_eq!(serde_json::to_value(CoreError::Auth).unwrap(), json!({"tag":"Auth"}));
        let scope: ThreadScope = serde_json::from_value(json!({"tag":"Mailbox","inner":{"mailboxId":"3"}})).unwrap();
        assert!(matches!(scope, ThreadScope::Mailbox { mailbox_id } if mailbox_id == "3"));
        assert!(inside("/data/u/uploads/a/f.pdf", Path::new("/data/u/uploads")));
        assert!(!inside("/data/u/uploads/../secrets.json", Path::new("/data/u/uploads")));
        assert!(!inside("/etc/passwd", Path::new("/data/u/uploads")));
        for private in ["127.0.0.1", "10.1.2.3", "192.168.9.185", "100.64.0.1", "169.254.1.1", "::1", "fd00::1", "::ffff:192.168.1.1"] {
            assert!(!is_public(private.parse().unwrap()), "{private}");
        }
        assert!(is_public("1.1.1.1".parse().unwrap()));
        assert!(fetch_image(url::Url::parse("https://127.0.0.1/x.png").unwrap()).is_none());
        assert!(fetch_image(url::Url::parse("http://example.com/x.png").unwrap()).is_none());
    }
}
