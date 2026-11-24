use std::sync::{Arc, LazyLock};
use std::time::Duration;

use async_imap::extensions::idle::IdleResponse;
use async_imap::imap_proto::NameAttribute;
use async_imap::types::{Fetch, Flag};
use futures::TryStreamExt;
use mail_model::{
    Credential, Error, Flags, MailboxRole, RemoteMailbox, Result, Security, ServerEndpoint,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::pki_types::ServerName;

const NETWORK_TIMEOUT: Duration = Duration::from_secs(45);
const NOOP_TIMEOUT: Duration = Duration::from_secs(10);
/// The slowest uplink a large upload is given time for.
const SLOW_UPLINK_BYTES_PER_SECOND: u64 = 32 * 1024;
const SUMMARY_HEADER_FIELDS: &str = "DATE FROM TO CC REPLY-TO SUBJECT MESSAGE-ID IN-REPLY-TO REFERENCES \
     CONTENT-TYPE CONTENT-TRANSFER-ENCODING MIME-VERSION \
     LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST LIST-ID PRECEDENCE AUTO-SUBMITTED X-AUTO-RESPONSE-SUPPRESS \
     X-MAILER X-CSA-COMPLAINTS X-CAMPAIGN X-CAMPAIGNID X-MAILIN-CAMPAIGN X-MAILJET-CAMPAIGN";
const PREVIEW_BYTES: u32 = 2048;
/// Without partial fetches, previews come from whole texts, so only small messages get one.
const WHOLE_TEXT_PREVIEW_MAX_SIZE: u32 = 16 * 1024;

type Session = async_imap::Session<TlsStream<TcpStream>>;

/// Hosts whose FETCH responses for partial sections (`BODY[TEXT]<0>`) cannot be parsed.
static HOSTS_WITHOUT_PARTIAL_FETCH: LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    LazyLock::new(Default::default);

static TLS_CONNECTOR: LazyLock<TlsConnector> = LazyLock::new(|| {
    #[allow(unused_mut)]
    let mut roots = tokio_rustls::rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    #[cfg(feature = "test-ca")]
    if let Some(pem) = option_env!("OPENMAILBOX_TEST_CA") {
        use tokio_rustls::rustls::pki_types::{CertificateDer, pem::PemObject};
        for certificate in CertificateDer::pem_slice_iter(pem.as_bytes()).flatten() {
            let _ = roots.add(certificate);
        }
    }
    let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
    let config = tokio_rustls::rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("ring supports the default protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    TlsConnector::from(Arc::new(config))
});

#[derive(Debug, Clone, Copy, Default)]
pub struct Capabilities {
    pub condstore: bool,
    pub idle: bool,
    pub move_command: bool,
    pub uidplus: bool,
    pub preview: bool,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct MailboxStatus {
    pub messages: u32,
    pub unseen: u32,
    pub uid_next: Option<u32>,
    pub uid_validity: Option<u32>,
    pub highest_modseq: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct FetchedSummary {
    pub uid: u32,
    pub flags: Flags,
    pub internal_date: Option<i64>,
    pub size: u32,
    pub header: Vec<u8>,
    pub text: Vec<u8>,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct FlagUpdate {
    pub uid: u32,
    pub flags: Flags,
}

pub struct ImapConnection {
    session: Session,
    host: String,
    pub capabilities: Capabilities,
    selected: Option<String>,
}

async fn timed<T>(
    future: impl Future<Output = std::result::Result<T, async_imap::error::Error>>,
) -> Result<T> {
    timed_within(NETWORK_TIMEOUT, future).await
}

fn transfer_timeout(bytes: usize) -> Duration {
    NETWORK_TIMEOUT + Duration::from_secs(bytes as u64 / SLOW_UPLINK_BYTES_PER_SECOND)
}

async fn timed_within<T>(
    timeout: Duration,
    future: impl Future<Output = std::result::Result<T, async_imap::error::Error>>,
) -> Result<T> {
    match tokio::time::timeout(timeout, future).await {
        Ok(result) => result.map_err(map_error),
        Err(_) => Err(Error::Network("timed out".into())),
    }
}

fn map_error(error: async_imap::error::Error) -> Error {
    use async_imap::error::Error as ImapError;
    match error {
        ImapError::Io(error) => Error::Network(readable(error.to_string())),
        ImapError::ConnectionLost => Error::Network("connection lost".into()),
        other => Error::Server(readable(other.to_string())),
    }
}

fn readable(message: String) -> String {
    match message.find("during parsing") {
        Some(position) => format!(
            "unreadable server response ({})",
            message[position..].chars().take(120).collect::<String>()
        ),
        None => message.chars().take(300).collect(),
    }
}

fn network(error: std::io::Error) -> Error {
    Error::Network(error.to_string())
}

pub fn xoauth2(username: &str, token: &str) -> String {
    format!("user={username}\x01auth=Bearer {token}\x01\x01")
}

pub fn oauthbearer(username: &str, endpoint: &ServerEndpoint, token: &str) -> String {
    format!(
        "n,a={username},\x01host={}\x01port={}\x01auth=Bearer {token}\x01\x01",
        endpoint.host, endpoint.port
    )
}

struct OAuthBearer {
    payload: Option<String>,
    challenge: Arc<std::sync::Mutex<Option<Vec<u8>>>>,
}

impl async_imap::Authenticator for OAuthBearer {
    type Response = Vec<u8>;

    fn process(&mut self, challenge: &[u8]) -> Vec<u8> {
        match self.payload.take() {
            Some(payload) => payload.into_bytes(),
            None => {
                *self
                    .challenge
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(challenge.to_vec());
                b"\x01".to_vec()
            }
        }
    }
}

fn oauth_configuration_in(challenge: &[u8]) -> Option<String> {
    serde_json::from_slice::<serde_json::Value>(challenge)
        .ok()?
        .get("openid-configuration")?
        .as_str()
        .map(str::to_owned)
}

async fn probe<T>(
    client: async_imap::Client<T>,
    endpoint: &ServerEndpoint,
    username: &str,
) -> Option<String>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send,
{
    let challenge = Arc::new(std::sync::Mutex::new(None));
    let attempt = client.authenticate(
        "OAUTHBEARER",
        OAuthBearer {
            payload: Some(oauthbearer(username, endpoint, "invalid")),
            challenge: challenge.clone(),
        },
    );
    if let Ok(Ok(mut session)) = tokio::time::timeout(NETWORK_TIMEOUT, attempt).await {
        let _ = session.logout().await;
    }
    let bytes = challenge
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()?;
    oauth_configuration_in(&bytes)
}

pub async fn oauth_configuration(
    endpoint: &ServerEndpoint,
    username: &str,
) -> Result<Option<String>> {
    let client = open_client(endpoint).await?;
    Ok(probe(client, endpoint, username).await)
}

struct XOAuth2(Option<String>);

impl async_imap::Authenticator for XOAuth2 {
    type Response = String;

    fn process(&mut self, _: &[u8]) -> String {
        self.0.take().unwrap_or_default()
    }
}

async fn log_in<T>(
    client: async_imap::Client<T>,
    endpoint: &ServerEndpoint,
    username: &str,
    credential: &Credential,
) -> Result<async_imap::Session<T>>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send,
{
    let attempt = async {
        match credential {
            Credential::Password(password) => client.login(username, password).await,
            Credential::AccessToken(token) => {
                client
                    .authenticate("XOAUTH2", XOAuth2(Some(xoauth2(username, token))))
                    .await
            }
            Credential::OAuthBearer(token) => {
                client
                    .authenticate(
                        "OAUTHBEARER",
                        OAuthBearer {
                            payload: Some(oauthbearer(username, endpoint, token)),
                            challenge: Arc::default(),
                        },
                    )
                    .await
            }
        }
    };
    match tokio::time::timeout(NETWORK_TIMEOUT, attempt).await {
        Ok(Ok(session)) => Ok(session),
        Ok(Err((async_imap::error::Error::No(_) | async_imap::error::Error::Bad(_), _))) => {
            Err(Error::Auth)
        }
        Ok(Err((error, _))) => Err(map_error(error)),
        Err(_) => Err(Error::Network("timed out".into())),
    }
}

async fn open_client(
    endpoint: &ServerEndpoint,
) -> Result<async_imap::Client<TlsStream<TcpStream>>> {
    let stream = tokio::time::timeout(NETWORK_TIMEOUT, open_tls_stream(endpoint))
        .await
        .map_err(|_| Error::Network("timed out".into()))??;
    let mut client = async_imap::Client::new(stream);
    if endpoint.security == Security::Tls {
        timed(async {
            client
                .read_response()
                .await
                .map_err(async_imap::error::Error::Io)
        })
        .await?;
    }
    Ok(client)
}

pub async fn connect(
    endpoint: &ServerEndpoint,
    username: &str,
    credential: &Credential,
) -> Result<ImapConnection> {
    let client = open_client(endpoint).await?;
    let mut session = log_in(client, endpoint, username, credential).await?;
    let capabilities = timed(session.capabilities()).await?;
    let capabilities = Capabilities {
        condstore: capabilities.has_str("CONDSTORE") || capabilities.has_str("QRESYNC"),
        idle: capabilities.has_str("IDLE"),
        move_command: capabilities.has_str("MOVE"),
        uidplus: capabilities.has_str("UIDPLUS"),
        preview: capabilities.has_str("PREVIEW"),
    };
    Ok(ImapConnection {
        session,
        host: endpoint.host.clone(),
        capabilities,
        selected: None,
    })
}

async fn open_tls_stream(endpoint: &ServerEndpoint) -> Result<TlsStream<TcpStream>> {
    let mut tcp = TcpStream::connect((endpoint.host.as_str(), endpoint.port))
        .await
        .map_err(network)?;
    tcp.set_nodelay(true).map_err(network)?;
    if endpoint.security == Security::StartTls {
        read_line(&mut tcp).await?;
        tcp.write_all(b"a0 STARTTLS\r\n").await.map_err(network)?;
        loop {
            let line = read_line(&mut tcp).await?;
            if let Some(status) = line.strip_prefix("a0 ") {
                if !status.to_ascii_uppercase().starts_with("OK") {
                    return Err(Error::Server(format!("STARTTLS refused: {status}")));
                }
                break;
            }
        }
    }
    let server_name = ServerName::try_from(endpoint.host.clone())
        .map_err(|error| Error::InvalidInput(error.to_string()))?;
    TLS_CONNECTOR
        .connect(server_name, tcp)
        .await
        .map_err(network)
}

async fn read_line(tcp: &mut TcpStream) -> Result<String> {
    let mut line = Vec::new();
    while !line.ends_with(b"\r\n") {
        line.push(tcp.read_u8().await.map_err(network)?);
        if line.len() > 8192 {
            return Err(Error::Server("response line too long".into()));
        }
    }
    Ok(String::from_utf8_lossy(&line).trim_end().to_owned())
}

pub fn uid_set(uids: &[u32]) -> String {
    let mut sorted = uids.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut ranges: Vec<String> = Vec::new();
    let mut index = 0;
    while index < sorted.len() {
        let start = sorted[index];
        let mut end = start;
        while index + 1 < sorted.len() && sorted[index + 1] == end + 1 {
            index += 1;
            end = sorted[index];
        }
        ranges.push(if start == end {
            start.to_string()
        } else {
            format!("{start}:{end}")
        });
        index += 1;
    }
    ranges.join(",")
}

fn flags_of(fetch: &Fetch) -> Flags {
    flags_from(fetch.flags())
}

fn flags_from<'a>(names: impl Iterator<Item = Flag<'a>>) -> Flags {
    let mut flags = Flags::default();
    for flag in names {
        match flag {
            Flag::Seen => flags.seen = true,
            Flag::Flagged => flags.flagged = true,
            Flag::Answered => flags.answered = true,
            Flag::Draft => flags.draft = true,
            Flag::Deleted => flags.deleted = true,
            _ => {}
        }
    }
    flags
}

fn declared_role(attributes: &[NameAttribute]) -> Option<MailboxRole> {
    attributes.iter().find_map(|attribute| match attribute {
        NameAttribute::Sent => Some(MailboxRole::Sent),
        NameAttribute::Drafts => Some(MailboxRole::Drafts),
        NameAttribute::Trash => Some(MailboxRole::Trash),
        NameAttribute::Junk => Some(MailboxRole::Junk),
        NameAttribute::Archive => Some(MailboxRole::Archive),
        NameAttribute::All => Some(MailboxRole::All),
        NameAttribute::Flagged => Some(MailboxRole::Flagged),
        _ => None,
    })
}

/// Keeps each role on one mailbox: the one the server declares (SPECIAL-USE) over a name guess,
/// then the shallowest, so a stray `INBOX.INBOX.Sent` listed first cannot take Sent from `INBOX.Sent`.
fn keep_one_mailbox_per_role(mailboxes: &mut [RemoteMailbox], declared: &[bool]) {
    let mut best: std::collections::HashMap<MailboxRole, usize> = Default::default();
    for (index, mailbox) in mailboxes.iter().enumerate() {
        let Some(role) = mailbox.role else { continue };
        let rank = |position: usize| (!declared[position], mailboxes[position].depth);
        if best
            .get(&role)
            .is_none_or(|&current| rank(index) < rank(current))
        {
            best.insert(role, index);
        }
    }
    for (index, mailbox) in mailboxes.iter_mut().enumerate() {
        if mailbox
            .role
            .is_some_and(|role| best.get(&role) != Some(&index))
        {
            mailbox.role = None;
        }
    }
}

fn role_of(remote_name: &str, attributes: &[NameAttribute]) -> Option<MailboxRole> {
    if let Some(role) = declared_role(attributes) {
        return Some(role);
    }
    if remote_name.eq_ignore_ascii_case("INBOX") {
        return Some(MailboxRole::Inbox);
    }
    let leaf = remote_name.rsplit(['/', '.']).next().unwrap_or(remote_name);
    let decoded = utf7_imap::decode_utf7_imap(leaf.to_owned()).to_lowercase();
    match decoded.as_str() {
        "sent"
        | "sent items"
        | "sent messages"
        | "sent mail"
        | "envoyés"
        | "éléments envoyés"
        | "messages envoyés" => Some(MailboxRole::Sent),
        "drafts" | "draft" | "brouillons" => Some(MailboxRole::Drafts),
        "trash"
        | "deleted items"
        | "deleted messages"
        | "bin"
        | "corbeille"
        | "éléments supprimés" => Some(MailboxRole::Trash),
        "junk" | "spam" | "junk e-mail" | "courrier indésirable" | "indésirables" => {
            Some(MailboxRole::Junk)
        }
        "archive" | "archives" => Some(MailboxRole::Archive),
        _ => None,
    }
}

impl ImapConnection {
    pub async fn list_mailboxes(&mut self) -> Result<Vec<RemoteMailbox>> {
        let names: Vec<_> = timed(async {
            self.session
                .list(Some(""), Some("*"))
                .await?
                .try_collect()
                .await
        })
        .await?;
        let listed: Vec<_> = names
            .iter()
            .filter(|name| {
                !name.attributes().iter().any(|attribute| {
                    matches!(attribute, NameAttribute::Extension(value) if value.eq_ignore_ascii_case("\\NonExistent"))
                })
            })
            .collect();
        let declared: Vec<bool> = listed
            .iter()
            .map(|name| declared_role(name.attributes()).is_some())
            .collect();
        let mut mailboxes: Vec<RemoteMailbox> = listed
            .into_iter()
            .map(|name| {
                let remote_name = name.name().to_owned();
                let delimiter = name.delimiter().unwrap_or("/");
                let segments: Vec<&str> = remote_name.split(delimiter).collect();
                RemoteMailbox {
                    name: utf7_imap::decode_utf7_imap(
                        segments.last().copied().unwrap_or_default().to_owned(),
                    ),
                    depth: segments.len().saturating_sub(1) as u32,
                    role: role_of(&remote_name, name.attributes()),
                    selectable: !name
                        .attributes()
                        .iter()
                        .any(|attribute| matches!(attribute, NameAttribute::NoSelect)),
                    remote_name,
                }
            })
            .collect();
        keep_one_mailbox_per_role(&mut mailboxes, &declared);
        Ok(mailboxes)
    }

    pub async fn status(&mut self, remote_name: &str) -> Result<MailboxStatus> {
        let items = if self.capabilities.condstore {
            "(MESSAGES UNSEEN UIDNEXT UIDVALIDITY HIGHESTMODSEQ)"
        } else {
            "(MESSAGES UNSEEN UIDNEXT UIDVALIDITY)"
        };
        let selected = self.selected.as_deref() == Some(remote_name);
        let mailbox = status_complete(&mut self.session, remote_name, items, selected).await?;
        Ok(MailboxStatus {
            messages: mailbox.exists,
            unseen: mailbox.unseen.unwrap_or_default(),
            uid_next: mailbox.uid_next,
            uid_validity: mailbox.uid_validity,
            highest_modseq: mailbox.highest_modseq,
        })
    }

    pub async fn select(&mut self, remote_name: &str) -> Result<MailboxStatus> {
        let mailbox =
            select_complete(&mut self.session, remote_name, self.capabilities.condstore).await?;
        self.selected = Some(remote_name.to_owned());
        Ok(MailboxStatus {
            messages: mailbox.exists,
            unseen: mailbox.unseen.unwrap_or_default(),
            uid_next: mailbox.uid_next,
            uid_validity: mailbox.uid_validity,
            highest_modseq: mailbox.highest_modseq,
        })
    }

    pub async fn ensure_selected(&mut self, remote_name: &str) -> Result<()> {
        if self.selected.as_deref() != Some(remote_name) {
            self.select(remote_name).await?;
        }
        Ok(())
    }

    /// Whether the connection still answers, within a few seconds.
    pub async fn noop(&mut self) -> Result<()> {
        timed_within(NOOP_TIMEOUT, self.session.noop()).await
    }

    /// The INTERNALDATE of the message at `sequence` in the selected mailbox.
    pub async fn internal_date(&mut self, sequence: u32) -> Result<Option<i64>> {
        let fetches: Vec<Fetch> = timed(async {
            self.session
                .fetch(sequence.to_string(), "(INTERNALDATE)")
                .await?
                .try_collect()
                .await
        })
        .await?;
        Ok(fetches
            .iter()
            .find_map(|fetch| fetch.internal_date())
            .map(|date| date.timestamp_millis()))
    }

    pub async fn search_message_id(&mut self, message_id: &str) -> Result<Vec<u32>> {
        let quoted = message_id.replace('\\', "\\\\").replace('"', "\\\"");
        let uids = search_complete(
            &mut self.session,
            format!("HEADER Message-ID \"<{quoted}>\""),
        )
        .await?;
        Ok(uids.into_iter().collect())
    }

    pub async fn search_since(&mut self, since_millis: i64) -> Result<Vec<u32>> {
        let date = chrono::DateTime::from_timestamp_millis(since_millis)
            .unwrap_or_default()
            .format("%d-%b-%Y");
        let uids = search_complete(&mut self.session, format!("SINCE {date}")).await?;
        Ok(uids.into_iter().collect())
    }

    pub async fn fetch_summaries(&mut self, uids: &[u32]) -> Result<Vec<FetchedSummary>> {
        if self.capabilities.preview {
            return timed(fetch_summaries_with_preview(&mut self.session, uids)).await;
        }
        let hosts_without_partial_fetch = || {
            HOSTS_WITHOUT_PARTIAL_FETCH
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        };
        let partial_fetch = !hosts_without_partial_fetch().contains(&self.host);
        let preview = if partial_fetch {
            format!(" BODY.PEEK[TEXT]<0.{PREVIEW_BYTES}>")
        } else {
            String::new()
        };
        let query = format!(
            "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS ({SUMMARY_HEADER_FIELDS})]{preview})"
        );
        let set = uid_set(uids);
        let fetches: Vec<Fetch> = match timed(async {
            self.session
                .uid_fetch(&set, &query)
                .await?
                .try_collect()
                .await
        })
        .await
        {
            Err(Error::Network(message)) if partial_fetch && message.contains("during parsing") => {
                hosts_without_partial_fetch().insert(self.host.clone());
                return Err(Error::Network(message));
            }
            result => result?,
        };
        let mut summaries: Vec<FetchedSummary> = fetches
            .iter()
            .filter_map(|fetch| {
                Some(FetchedSummary {
                    uid: fetch.uid?,
                    flags: flags_of(fetch),
                    internal_date: fetch.internal_date().map(|date| date.timestamp_millis()),
                    size: fetch.size.unwrap_or_default(),
                    header: fetch.header().unwrap_or_default().to_vec(),
                    text: fetch.text().unwrap_or_default().to_vec(),
                    preview: None,
                })
            })
            .collect();
        if !partial_fetch {
            self.fetch_whole_texts(&mut summaries).await?;
        }
        Ok(summaries)
    }

    async fn fetch_whole_texts(&mut self, summaries: &mut [FetchedSummary]) -> Result<()> {
        let small: Vec<u32> = summaries
            .iter()
            .filter(|summary| summary.size <= WHOLE_TEXT_PREVIEW_MAX_SIZE)
            .map(|summary| summary.uid)
            .collect();
        if small.is_empty() {
            return Ok(());
        }
        let set = uid_set(&small);
        let fetches: Vec<Fetch> = timed(async {
            self.session
                .uid_fetch(&set, "(UID BODY.PEEK[TEXT])")
                .await?
                .try_collect()
                .await
        })
        .await?;
        let mut texts: std::collections::HashMap<u32, Vec<u8>> = fetches
            .iter()
            .filter_map(|fetch| Some((fetch.uid?, fetch.text()?.to_vec())))
            .collect();
        for summary in summaries {
            if let Some(text) = texts.remove(&summary.uid) {
                summary.text = text;
            }
        }
        Ok(())
    }

    pub async fn fetch_flags(
        &mut self,
        uids: &str,
        changed_since: Option<u64>,
    ) -> Result<Vec<FlagUpdate>> {
        let query = match changed_since {
            Some(modseq) => format!("(UID FLAGS) (CHANGEDSINCE {modseq})"),
            None => "(UID FLAGS)".to_owned(),
        };
        let fetches: Vec<Fetch> = timed(async {
            self.session
                .uid_fetch(uids, &query)
                .await?
                .try_collect()
                .await
        })
        .await?;
        Ok(fetches
            .iter()
            .filter_map(|fetch| {
                Some(FlagUpdate {
                    uid: fetch.uid?,
                    flags: flags_of(fetch),
                })
            })
            .collect())
    }

    pub async fn fetch_raw(&mut self, uid: u32) -> Result<Vec<u8>> {
        let fetches: Vec<Fetch> = timed(async {
            self.session
                .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
                .await?
                .try_collect()
                .await
        })
        .await?;
        fetches
            .iter()
            .find_map(|fetch| fetch.body().map(<[u8]>::to_vec))
            .ok_or(Error::NotFound)
    }

    pub async fn store_flags(&mut self, uids: &[u32], add: bool, flags: &[&str]) -> Result<()> {
        let command = format!(
            "{}FLAGS.SILENT ({})",
            if add { "+" } else { "-" },
            flags.join(" ")
        );
        let set = uid_set(uids);
        timed(async {
            self.session
                .uid_store(&set, &command)
                .await?
                .try_collect::<Vec<_>>()
                .await
        })
        .await?;
        Ok(())
    }

    pub async fn move_messages(&mut self, uids: &[u32], target: &str) -> Result<()> {
        let set = uid_set(uids);
        if self.capabilities.move_command {
            return timed(self.session.uid_mv(&set, target)).await;
        }
        timed(self.session.uid_copy(&set, target)).await?;
        self.delete_messages(uids).await
    }

    pub async fn delete_messages(&mut self, uids: &[u32]) -> Result<()> {
        self.store_flags(uids, true, &["\\Deleted"]).await?;
        let set = uid_set(uids);
        if self.capabilities.uidplus {
            timed(async {
                self.session
                    .uid_expunge(&set)
                    .await?
                    .try_collect::<Vec<_>>()
                    .await
            })
            .await?;
        } else {
            timed(async { self.session.expunge().await?.try_collect::<Vec<_>>().await }).await?;
        }
        Ok(())
    }

    pub async fn create_mailbox(&mut self, remote_name: &str) -> Result<()> {
        timed(self.session.create(remote_name)).await
    }

    pub async fn append(&mut self, remote_name: &str, raw: &[u8]) -> Result<()> {
        timed_within(
            transfer_timeout(raw.len()),
            append_seen(&mut self.session, remote_name, raw),
        )
        .await
    }

    pub async fn wait_for_changes(
        mut self,
        remote_name: &str,
        timeout: Duration,
    ) -> Result<(ImapConnection, bool)> {
        self.ensure_selected(remote_name).await?;
        let ImapConnection {
            session,
            host,
            capabilities,
            selected,
        } = self;
        let mut idle = session.idle();
        timed(idle.init()).await?;
        let (wait, _stop) = idle.wait_with_timeout(timeout);
        let changed = matches!(wait.await.map_err(map_error)?, IdleResponse::NewData(_));
        let session = timed(idle.done()).await?;
        Ok((
            ImapConnection {
                session,
                host,
                capabilities,
                selected,
            },
            changed,
        ))
    }

    pub async fn logout(mut self) {
        let _ = tokio::time::timeout(Duration::from_secs(5), self.session.logout()).await;
    }
}

/// async-imap ends SELECT, STATUS and SEARCH replies at the end of the stream without an error, so
/// a connection the server closed half-way reads as an empty mailbox: synced as is, that empties it
/// on the phone. Every complete SELECT, and the STATUS we send, carries UIDVALIDITY.
fn complete(mailbox: async_imap::types::Mailbox) -> Result<async_imap::types::Mailbox> {
    match mailbox.uid_validity {
        Some(_) => Ok(mailbox),
        None => Err(Error::Network("connection lost".into())),
    }
}

async fn select_complete<T>(
    session: &mut async_imap::Session<T>,
    remote_name: &str,
    condstore: bool,
) -> Result<async_imap::types::Mailbox>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send,
{
    let mailbox = if condstore {
        timed(session.select_condstore(remote_name)).await?
    } else {
        timed(session.select(remote_name)).await?
    };
    complete(mailbox)
}

/// Dovecot answers STATUS on the selected mailbox from the session's own view, which only takes
/// in mail delivered since on a NOOP: without one, a new message stays unseen until the
/// connection idles long enough to be checked.
async fn status_complete<T>(
    session: &mut async_imap::Session<T>,
    remote_name: &str,
    items: &str,
    selected: bool,
) -> Result<async_imap::types::Mailbox>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send,
{
    if selected {
        timed_within(NOOP_TIMEOUT, session.noop()).await?;
    }
    complete(timed(session.status(remote_name, items)).await?)
}

/// UID SEARCH, where an empty result is confirmed with a NOOP: a closed connection answers
/// "nothing found" too (see [`complete`]), and NOOP does fail on one.
async fn search_complete<T>(
    session: &mut async_imap::Session<T>,
    query: String,
) -> Result<std::collections::HashSet<u32>>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send,
{
    let uids = timed(session.uid_search(query)).await?;
    if uids.is_empty() {
        timed_within(NOOP_TIMEOUT, session.noop()).await?;
    }
    Ok(uids)
}

async fn fetch_summaries_with_preview<T>(
    session: &mut async_imap::Session<T>,
    uids: &[u32],
) -> std::result::Result<Vec<FetchedSummary>, async_imap::error::Error>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send,
{
    use async_imap::error::Error as ImapError;
    use async_imap::imap_proto::{Response, Status};

    let tag = session
        .run_command(format!(
            "UID FETCH {} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS ({SUMMARY_HEADER_FIELDS})] PREVIEW)",
            uid_set(uids)
        ))
        .await?;
    let mut summaries = Vec::new();
    loop {
        let response = session
            .read_response()
            .await?
            .ok_or(ImapError::ConnectionLost)?;
        match response.parsed() {
            Response::Fetch(_, attributes) => {
                add_to_summaries(&mut summaries, uids, attributes, response.borrow_owner());
            }
            Response::Done {
                tag: done,
                status,
                outcome,
            } if *done == tag => {
                let information = outcome
                    .information
                    .as_deref()
                    .unwrap_or_default()
                    .to_owned();
                return match status {
                    Status::Ok => Ok(summaries),
                    Status::No => Err(ImapError::No(information)),
                    _ => Err(ImapError::Bad(information)),
                };
            }
            _ => {}
        }
    }
}

fn add_to_summaries(
    summaries: &mut Vec<FetchedSummary>,
    uids: &[u32],
    attributes: &[async_imap::imap_proto::AttributeValue<'_>],
    raw: &[u8],
) {
    use async_imap::imap_proto::{AttributeValue, MessageSection, SectionPath};

    let Some(uid) = attributes.iter().find_map(|attribute| match attribute {
        AttributeValue::Uid(uid) => Some(*uid),
        _ => None,
    }) else {
        return;
    };
    if !uids.contains(&uid) {
        return;
    }
    let index = match summaries.iter().position(|summary| summary.uid == uid) {
        Some(index) => index,
        None => {
            summaries.push(FetchedSummary {
                uid,
                flags: Flags::default(),
                internal_date: None,
                size: 0,
                header: Vec::new(),
                text: Vec::new(),
                preview: None,
            });
            summaries.len() - 1
        }
    };
    let summary = &mut summaries[index];
    if let Some(preview) = preview_in(raw) {
        summary.preview = Some(preview);
    }
    for attribute in attributes {
        match attribute {
            AttributeValue::Flags(names) => {
                summary.flags = flags_from(names.iter().map(|name| Flag::from(name.as_ref())));
            }
            AttributeValue::InternalDate(date) => {
                summary.internal_date =
                    chrono::DateTime::parse_from_str(date, "%d-%b-%Y %H:%M:%S %z")
                        .ok()
                        .map(|date| date.timestamp_millis());
            }
            AttributeValue::Rfc822Size(size) => summary.size = *size,
            AttributeValue::BodySection {
                section: Some(SectionPath::Full(MessageSection::Header)),
                data: Some(data),
                ..
            }
            | AttributeValue::Rfc822Header(Some(data)) => summary.header = data.to_vec(),
            _ => {}
        }
    }
}

fn preview_in(raw: &[u8]) -> Option<String> {
    let mut at = raw
        .windows(7)
        .position(|window| window.eq_ignore_ascii_case(b"FETCH ("))?
        + 7;
    loop {
        while raw.get(at) == Some(&b' ') {
            at += 1;
        }
        if raw.get(at).is_none_or(|byte| *byte == b')') {
            return None;
        }
        let name_start = at;
        let mut in_section = false;
        while let Some(&byte) = raw.get(at) {
            match byte {
                b'[' => in_section = true,
                b']' => in_section = false,
                b' ' | b')' if !in_section => break,
                _ => {}
            }
            at += 1;
        }
        let name = &raw[name_start..at];
        while raw.get(at) == Some(&b' ') {
            at += 1;
        }
        let (value, end) = item_value(raw, at)?;
        if name.eq_ignore_ascii_case(b"PREVIEW") {
            return value.map(|value| String::from_utf8_lossy(&value).into_owned());
        }
        at = end;
    }
}

fn item_value(raw: &[u8], at: usize) -> Option<(Option<Vec<u8>>, usize)> {
    match raw.get(at)? {
        b'"' => {
            let mut value = Vec::new();
            let mut at = at + 1;
            loop {
                match *raw.get(at)? {
                    b'\\' => {
                        value.push(*raw.get(at + 1)?);
                        at += 2;
                    }
                    b'"' => return Some((Some(value), at + 1)),
                    byte => {
                        value.push(byte);
                        at += 1;
                    }
                }
            }
        }
        b'{' => {
            let close = at + raw[at..].iter().position(|byte| *byte == b'}')?;
            let length: usize = std::str::from_utf8(&raw[at + 1..close])
                .ok()?
                .trim_end_matches('+')
                .parse()
                .ok()?;
            let start = close + 3;
            let value = raw.get(start..start + length)?;
            Some((Some(value.to_vec()), start + length))
        }
        b'(' => {
            let mut depth = 0;
            let mut at = at;
            loop {
                match *raw.get(at)? {
                    b'(' => {
                        depth += 1;
                        at += 1;
                    }
                    b')' => {
                        depth -= 1;
                        at += 1;
                        if depth == 0 {
                            return Some((None, at));
                        }
                    }
                    b'"' | b'{' => at = item_value(raw, at)?.1,
                    _ => at += 1,
                }
            }
        }
        _ => {
            let end = at
                + raw[at..]
                    .iter()
                    .position(|byte| *byte == b' ' || *byte == b')')
                    .unwrap_or(raw.len() - at);
            let atom = &raw[at..end];
            Some((
                (!atom.eq_ignore_ascii_case(b"NIL")).then(|| atom.to_vec()),
                end,
            ))
        }
    }
}

/// APPEND as async-imap does it, except that untagged responses arriving before the continuation
/// (an EXISTS for a message just delivered to the selected mailbox) are skipped instead of failing.
async fn append_seen<T>(
    session: &mut async_imap::Session<T>,
    remote_name: &str,
    raw: &[u8],
) -> std::result::Result<(), async_imap::error::Error>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send,
{
    use async_imap::error::Error as ImapError;
    use async_imap::imap_proto::{Response, Status};

    let mailbox = format!(
        "\"{}\"",
        remote_name.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let tag = session
        .run_command(format!("APPEND {mailbox} (\\Seen) {{{}}}", raw.len()))
        .await?;
    let mut literal_sent = false;
    loop {
        let response = session
            .read_response()
            .await?
            .ok_or(ImapError::ConnectionLost)?;
        match response.parsed() {
            Response::Continue { .. } if !literal_sent => {
                let stream = session.get_mut();
                stream.write_all(raw).await?;
                stream.write_all(b"\r\n").await?;
                stream.flush().await?;
                literal_sent = true;
            }
            Response::Done {
                tag: done,
                status,
                outcome,
            } if *done == tag => {
                let information = outcome
                    .information
                    .as_deref()
                    .unwrap_or_default()
                    .to_owned();
                return match status {
                    Status::Ok => Ok(()),
                    Status::No => Err(ImapError::No(information)),
                    _ => Err(ImapError::Bad(information)),
                };
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xoauth2_payload() {
        assert_eq!(
            xoauth2("alice@outlook.com", "tok"),
            "user=alice@outlook.com\x01auth=Bearer tok\x01\x01"
        );
    }

    async fn xoauth2_server(accept: bool) -> tokio::io::DuplexStream {
        use base64::Engine;
        use tokio::io::{AsyncBufReadExt, BufReader};

        let (client, server) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let (read, mut write) = tokio::io::split(server);
            let mut lines = BufReader::new(read).lines();
            let command = lines.next_line().await.unwrap().unwrap();
            let (tag, rest) = command.split_once(' ').unwrap();
            assert_eq!(rest, "AUTHENTICATE XOAUTH2");
            write.write_all(b"+ \r\n").await.unwrap();
            let response = lines.next_line().await.unwrap().unwrap();
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(response.trim())
                .unwrap();
            assert_eq!(decoded, xoauth2("alice@outlook.com", "tok").as_bytes());
            if accept {
                write
                    .write_all(format!("{tag} OK AUTHENTICATE completed\r\n").as_bytes())
                    .await
                    .unwrap();
            } else {
                let error = base64::engine::general_purpose::STANDARD
                    .encode(r#"{"status":"401","schemes":"bearer","scope":"https://outlook.office.com/IMAP.AccessAsUser.All"}"#);
                write
                    .write_all(format!("+ {error}\r\n").as_bytes())
                    .await
                    .unwrap();
                assert_eq!(lines.next_line().await.unwrap().unwrap().trim(), "");
                write
                    .write_all(format!("{tag} NO AUTHENTICATE failed.\r\n").as_bytes())
                    .await
                    .unwrap();
            }
            let _ = lines.next_line().await;
        });
        client
    }

    fn stalwart() -> ServerEndpoint {
        ServerEndpoint {
            host: "mail.example.org".into(),
            port: 993,
            security: Security::Tls,
        }
    }

    #[test]
    fn oauthbearer_payload() {
        assert_eq!(
            oauthbearer("alice@example.org", &stalwart(), "tok"),
            "n,a=alice@example.org,\x01host=mail.example.org\x01port=993\x01auth=Bearer tok\x01\x01"
        );
    }

    async fn oauthbearer_server(error: Option<&'static str>) -> tokio::io::DuplexStream {
        use base64::Engine;
        use tokio::io::{AsyncBufReadExt, BufReader};

        let (client, server) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let (read, mut write) = tokio::io::split(server);
            let mut lines = BufReader::new(read).lines();
            let command = lines.next_line().await.unwrap().unwrap();
            let (tag, rest) = command.split_once(' ').unwrap();
            assert_eq!(rest, "AUTHENTICATE OAUTHBEARER");
            write.write_all(b"+ \r\n").await.unwrap();
            let response = lines.next_line().await.unwrap().unwrap();
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(response.trim())
                .unwrap();
            assert!(decoded.starts_with(b"n,a=alice@example.org,"));
            match error {
                None => write
                    .write_all(format!("{tag} OK AUTHENTICATE completed\r\n").as_bytes())
                    .await
                    .unwrap(),
                Some(json) => {
                    let challenge = base64::engine::general_purpose::STANDARD.encode(json);
                    write
                        .write_all(format!("+ {challenge}\r\n").as_bytes())
                        .await
                        .unwrap();
                    let answer = lines.next_line().await.unwrap().unwrap();
                    assert_eq!(
                        base64::engine::general_purpose::STANDARD
                            .decode(answer.trim())
                            .unwrap(),
                        b"\x01"
                    );
                    write
                        .write_all(format!("{tag} NO [AUTHENTICATIONFAILED] failed\r\n").as_bytes())
                        .await
                        .unwrap();
                }
            }
            let _ = lines.next_line().await;
        });
        client
    }

    #[tokio::test]
    async fn connect_authenticates_with_oauthbearer() {
        let token = Credential::OAuthBearer("tok".into());
        let client = async_imap::Client::new(oauthbearer_server(None).await);
        assert!(
            log_in(client, &stalwart(), "alice@example.org", &token)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn a_failed_oauthbearer_attempt_tells_where_the_oauth_server_is() {
        let error = r#"{"status":"invalid_token","scope":"urn:ietf:params:oauth:scope:mail","openid-configuration":"https://mail.example.org/.well-known/openid-configuration"}"#;
        let client = async_imap::Client::new(oauthbearer_server(Some(error)).await);
        assert_eq!(
            probe(client, &stalwart(), "alice@example.org")
                .await
                .as_deref(),
            Some("https://mail.example.org/.well-known/openid-configuration")
        );
        let client = async_imap::Client::new(
            oauthbearer_server(Some(r#"{"status":"invalid_token"}"#)).await,
        );
        assert_eq!(probe(client, &stalwart(), "alice@example.org").await, None);
    }

    #[tokio::test]
    async fn connect_authenticates_with_xoauth2() {
        let token = Credential::AccessToken("tok".into());
        let client = async_imap::Client::new(xoauth2_server(true).await);
        assert!(
            log_in(client, &stalwart(), "alice@outlook.com", &token)
                .await
                .is_ok()
        );
        let client = async_imap::Client::new(xoauth2_server(false).await);
        assert!(matches!(
            log_in(client, &stalwart(), "alice@outlook.com", &token).await,
            Err(Error::Auth)
        ));
    }

    #[test]
    fn uid_set_collapses_consecutive_uids() {
        assert_eq!(uid_set(&[7, 1, 2, 3, 5, 9, 8]), "1:3,5,7:9");
    }

    #[test]
    fn roles_fall_back_to_localized_names() {
        assert_eq!(role_of("INBOX", &[]), Some(MailboxRole::Inbox));
        assert_eq!(role_of("INBOX.Envoy&AOk-s", &[]), Some(MailboxRole::Sent));
        assert_eq!(
            role_of("[Gmail]/Tous les messages", &[NameAttribute::All]),
            Some(MailboxRole::All)
        );
        assert_eq!(role_of("Projets", &[]), None);
    }

    #[test]
    fn declared_and_shallow_mailboxes_win_a_role() {
        let mailbox = |remote_name: &str, depth| RemoteMailbox {
            remote_name: remote_name.into(),
            name: remote_name.into(),
            depth,
            role: role_of(remote_name, &[]),
            selectable: true,
        };
        let mut mailboxes = vec![
            mailbox("INBOX", 0),
            mailbox("INBOX.INBOX.Sent", 2),
            mailbox("INBOX.INBOX.Trash", 2),
            mailbox("INBOX.Sent Messages", 1),
            mailbox("INBOX.Trash", 1),
            mailbox("INBOX.Deleted Messages", 1),
        ];
        mailboxes[5].role = Some(MailboxRole::Trash);
        keep_one_mailbox_per_role(&mut mailboxes, &[false, false, false, false, false, true]);
        let roles: Vec<_> = mailboxes.iter().map(|mailbox| mailbox.role).collect();
        assert_eq!(
            roles,
            vec![
                Some(MailboxRole::Inbox),
                None,
                None,
                Some(MailboxRole::Sent),
                None,
                Some(MailboxRole::Trash),
            ]
        );
    }

    #[test]
    fn large_appends_get_time_for_a_slow_uplink() {
        assert_eq!(transfer_timeout(0), NETWORK_TIMEOUT);
        assert!(transfer_timeout(34_000_000) >= Duration::from_secs(17 * 60));
    }

    /// A fake server that logs in, then answers the next command with `reply` and hangs up when
    /// `hang_up` (as a server closing an idle connection does), or keeps answering NOOPs.
    async fn scripted_session(
        reply: &'static str,
        hang_up: bool,
    ) -> async_imap::Session<tokio::io::DuplexStream> {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let (client, server) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let (read, mut write) = tokio::io::split(server);
            let mut read = BufReader::new(read);
            let mut line = String::new();
            let mut answered = false;
            while read.read_line(&mut line).await.unwrap_or(0) > 0 {
                let tag = line.split(' ').next().unwrap_or_default().to_owned();
                let answer = if line.contains("LOGIN") {
                    format!("{tag} OK LOGIN completed\r\n")
                } else if line.contains("NOOP") {
                    format!("{tag} OK NOOP completed\r\n")
                } else if !answered {
                    answered = true;
                    reply.replace("{tag}", &tag)
                } else {
                    format!("{tag} BAD unexpected\r\n")
                };
                write.write_all(answer.as_bytes()).await.unwrap();
                if answered && hang_up {
                    return;
                }
                line.clear();
            }
        });
        async_imap::Client::new(client)
            .login("alice", "secret")
            .await
            .map_err(|(error, _)| error)
            .unwrap()
    }

    #[tokio::test]
    async fn a_select_cut_off_by_the_server_is_a_lost_connection_not_an_empty_mailbox() {
        let mut session = scripted_session("* 147 EXISTS\r\n", true).await;
        let result = select_complete(&mut session, "INBOX", false).await;
        assert!(matches!(result, Err(Error::Network(_))), "{result:?}");
    }

    #[tokio::test]
    async fn a_complete_select_reports_its_uidvalidity() {
        let reply = "* 147 EXISTS\r\n* OK [UIDVALIDITY 1794294172] UIDs valid\r\n* OK [UIDNEXT 148] next\r\n{tag} OK [READ-WRITE] SELECT completed\r\n";
        let mut session = scripted_session(reply, false).await;
        let mailbox = select_complete(&mut session, "INBOX", false).await.unwrap();
        assert_eq!(
            (mailbox.exists, mailbox.uid_validity),
            (147, Some(1_794_294_172))
        );
    }

    #[tokio::test]
    async fn the_selected_mailbox_status_includes_mail_delivered_since_it_was_selected() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        // Like Dovecot: STATUS on the selected mailbox answers from the session's view, which
        // only takes in the message delivered meanwhile on the next NOOP.
        let (client, server) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let (read, mut write) = tokio::io::split(server);
            let mut read = BufReader::new(read);
            let mut line = String::new();
            let mut uid_next = 16;
            while read.read_line(&mut line).await.unwrap_or(0) > 0 {
                let tag = line.split(' ').next().unwrap_or_default().to_owned();
                let answer = if line.contains("NOOP") {
                    uid_next = 17;
                    format!("* 16 EXISTS\r\n{tag} OK NOOP completed\r\n")
                } else if line.contains("STATUS") {
                    format!(
                        "* STATUS INBOX (MESSAGES {} UIDNEXT {uid_next} UIDVALIDITY 1)\r\n{tag} OK STATUS completed\r\n",
                        uid_next - 1
                    )
                } else {
                    format!("{tag} OK completed\r\n")
                };
                write.write_all(answer.as_bytes()).await.unwrap();
                line.clear();
            }
        });
        let mut session = async_imap::Client::new(client)
            .login("alice", "secret")
            .await
            .map_err(|(error, _)| error)
            .unwrap();
        let mailbox = status_complete(
            &mut session,
            "INBOX",
            "(MESSAGES UIDNEXT UIDVALIDITY)",
            true,
        )
        .await
        .unwrap();
        assert_eq!((mailbox.exists, mailbox.uid_next), (16, Some(17)));
    }

    #[tokio::test]
    async fn a_search_cut_off_by_the_server_is_a_lost_connection_not_an_empty_result() {
        let mut session = scripted_session("", true).await;
        let result = search_complete(&mut session, "SINCE 01-Oct-2026".into()).await;
        assert!(matches!(result, Err(Error::Network(_))), "{result:?}");
    }

    #[tokio::test]
    async fn a_search_that_found_nothing_stays_empty() {
        let mut session =
            scripted_session("* SEARCH\r\n{tag} OK SEARCH completed\r\n", false).await;
        let uids = search_complete(&mut session, "SINCE 01-Oct-2026".into())
            .await
            .unwrap();
        assert!(uids.is_empty());
    }

    #[tokio::test]
    async fn append_waits_past_untagged_responses_for_the_continuation() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let (client, server) = tokio::io::duplex(4096);
        let server = tokio::spawn(async move {
            let (read, mut write) = tokio::io::split(server);
            let mut read = BufReader::new(read);
            let mut line = String::new();
            read.read_line(&mut line).await.unwrap();
            let tag = line.split(' ').next().unwrap().to_owned();
            write
                .write_all(format!("{tag} OK LOGIN completed\r\n").as_bytes())
                .await
                .unwrap();
            line.clear();
            read.read_line(&mut line).await.unwrap();
            let tag = line.split(' ').next().unwrap().to_owned();
            assert!(line.ends_with("APPEND \"Sent\" (\\Seen) {5}\r\n"), "{line}");
            write
                .write_all(b"* 146 EXISTS\r\n* 1 RECENT\r\n+ Ready\r\n")
                .await
                .unwrap();
            let mut literal = [0u8; 7];
            read.read_exact(&mut literal).await.unwrap();
            write
                .write_all(format!("{tag} OK APPEND completed\r\n").as_bytes())
                .await
                .unwrap();
            literal
        });
        let mut session = async_imap::Client::new(client)
            .login("alice", "secret")
            .await
            .map_err(|(error, _)| error)
            .unwrap();

        append_seen(&mut session, "Sent", b"hello").await.unwrap();

        assert_eq!(&server.await.unwrap(), b"hello\r\n");
    }

    #[test]
    fn a_server_preview_is_read_past_a_header_literal_that_mentions_it() {
        let header = "Subject: PREVIEW \"fake\"\r\n\r\n";
        let raw = format!(
            "* 1 FETCH (UID 7 FLAGS (\\Seen) BODY[HEADER.FIELDS (SUBJECT DATE)] {{{}}}\r\n{header} PREVIEW \"Hello \\\"Carol\\\" \\\\o/\")\r\n",
            header.len()
        );
        assert_eq!(
            preview_in(raw.as_bytes()).as_deref(),
            Some("Hello \"Carol\" \\o/")
        );
    }

    #[test]
    fn a_server_preview_can_come_as_a_literal_or_be_nil() {
        let text = "Déjà vu";
        let literal = format!("* 2 FETCH (PREVIEW {{{}}}\r\n{text} UID 8)\r\n", text.len());
        assert_eq!(preview_in(literal.as_bytes()).as_deref(), Some(text));
        assert_eq!(preview_in(b"* 3 FETCH (UID 9 PREVIEW NIL)\r\n"), None);
        assert_eq!(preview_in(b"* 4 FETCH (UID 10 FLAGS ())\r\n"), None);
    }

    #[tokio::test]
    async fn summaries_take_the_preview_the_server_made() {
        let reply = "* 1 FETCH (UID 7 FLAGS (\\Seen) INTERNALDATE \"24-Nov-2026 10:00:00 +0000\" RFC822.SIZE 2900 BODY[HEADER.FIELDS (SUBJECT)] {21}\r\nSubject: Hi there\r\n\r\n PREVIEW \"Lunch at noon?\")\r\n* 2 FETCH (UID 99 FLAGS (\\Flagged))\r\n{tag} OK FETCH completed\r\n";
        let mut session = scripted_session(reply, false).await;
        let summaries = timed(fetch_summaries_with_preview(&mut session, &[7]))
            .await
            .unwrap();
        assert_eq!(summaries.len(), 1);
        let summary = &summaries[0];
        assert_eq!((summary.uid, summary.size), (7, 2900));
        assert!(summary.flags.seen && !summary.flags.flagged);
        assert_eq!(summary.internal_date, Some(1_795_514_400_000));
        assert_eq!(summary.header, b"Subject: Hi there\r\n\r\n");
        assert!(summary.text.is_empty());
        assert_eq!(summary.preview.as_deref(), Some("Lunch at noon?"));
    }

    #[tokio::test]
    async fn a_message_answered_in_several_fetch_responses_makes_one_summary() {
        let reply = "* 1 FETCH (UID 7 RFC822.SIZE 2900 BODY[HEADER.FIELDS (SUBJECT)] {21}\r\nSubject: Hi there\r\n\r\n)\r\n* 1 FETCH (UID 7 FLAGS (\\Seen) PREVIEW \"Lunch at noon?\")\r\n{tag} OK FETCH completed\r\n";
        let mut session = scripted_session(reply, false).await;
        let summaries = timed(fetch_summaries_with_preview(&mut session, &[7]))
            .await
            .unwrap();
        assert_eq!(summaries.len(), 1);
        assert!(summaries[0].flags.seen);
        assert_eq!(summaries[0].header, b"Subject: Hi there\r\n\r\n");
        assert_eq!(summaries[0].preview.as_deref(), Some("Lunch at noon?"));
    }

    #[tokio::test]
    async fn a_refused_preview_fetch_is_a_server_error() {
        let mut session = scripted_session("{tag} NO [SERVERBUG] preview failed\r\n", false).await;
        let result = timed(fetch_summaries_with_preview(&mut session, &[7])).await;
        assert!(matches!(result, Err(Error::Server(_))), "{result:?}");
    }
}
