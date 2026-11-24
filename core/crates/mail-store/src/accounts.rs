use mail_model::{Account, Authentication, Error, Result, Security, ServerEndpoint};
use rusqlite::{OptionalExtension, Row, params};

use crate::{StorageResult, Store};

const ACCOUNT_COLUMNS: &str = "id, email, display_name, username, imap_host, imap_port, imap_security, \
     smtp_host, smtp_port, smtp_security, color, created_at, authentication, oauth_server";

fn account_from_row(row: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        email: row.get(1)?,
        display_name: row.get(2)?,
        username: row.get(3)?,
        imap: ServerEndpoint {
            host: row.get(4)?,
            port: row.get(5)?,
            security: Security::parse(&row.get::<_, String>(6)?),
        },
        smtp: ServerEndpoint {
            host: row.get(7)?,
            port: row.get(8)?,
            security: Security::parse(&row.get::<_, String>(9)?),
        },
        color: row.get(10)?,
        created_at: row.get(11)?,
        authentication: Authentication::parse(&row.get::<_, String>(12)?),
        oauth_server: row
            .get::<_, Option<String>>(13)?
            .and_then(|json| serde_json::from_str(&json).ok()),
    })
}

impl Store {
    /// The notification watermark: messages received at or after this time, and stored after this
    /// email id, have not been notified. Dates from servers often have one-second precision, so the
    /// time alone cannot tell apart two messages received in the same second.
    pub fn notified_until(&self, account_id: &str) -> Result<(i64, i64)> {
        self.read()
            .query_row(
                "SELECT notified_until, notified_email_id FROM account WHERE id = ?1",
                [account_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .storage()?
            .ok_or(Error::NotFound)
    }

    pub fn set_notified_until(&self, account_id: &str, at: i64) -> Result<()> {
        self.write(|transaction| {
            transaction
                .execute(
                    "UPDATE account SET notified_until = max(notified_until, ?2),
                       notified_email_id = max(notified_email_id, coalesce((SELECT max(id) FROM email WHERE account_id = ?1), 0))
                     WHERE id = ?1",
                    params![account_id, at],
                )
                .storage()?;
            Ok(())
        })
    }

    /// Moves the notification watermark past every message already in the account's inbox.
    pub fn advance_notified_until(&self, account_id: &str) -> Result<()> {
        self.write(|transaction| {
            transaction
                .execute(
                    "UPDATE account SET
                       notified_until = max(notified_until, coalesce((
                         SELECT max(e.received_at) FROM email e
                         JOIN email_mailbox em ON em.email_id = e.id
                         JOIN mailbox m ON m.id = em.mailbox_id
                         WHERE m.account_id = ?1 AND m.role = 'inbox'), 0)),
                       notified_email_id = max(notified_email_id, coalesce((
                         SELECT max(e.id) FROM email e
                         JOIN email_mailbox em ON em.email_id = e.id
                         JOIN mailbox m ON m.id = em.mailbox_id
                         WHERE m.account_id = ?1 AND m.role = 'inbox'), 0))
                     WHERE id = ?1",
                    [account_id],
                )
                .storage()?;
            Ok(())
        })
    }

    pub fn insert_account(&self, account: &Account) -> Result<()> {
        self.write(|transaction| {
            transaction
                .execute(
                    &format!("INSERT INTO account ({ACCOUNT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"),
                    params![
                        account.id,
                        account.email,
                        account.display_name,
                        account.username,
                        account.imap.host,
                        account.imap.port,
                        account.imap.security.as_str(),
                        account.smtp.host,
                        account.smtp.port,
                        account.smtp.security.as_str(),
                        account.color,
                        account.created_at,
                        account.authentication.as_str(),
                        account
                            .oauth_server
                            .as_ref()
                            .and_then(|server| serde_json::to_string(server).ok()),
                    ],
                )
                .storage()?;
            Ok(())
        })
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>> {
        let connection = self.read();
        let mut statement = connection
            .prepare_cached(&format!(
                "SELECT {ACCOUNT_COLUMNS} FROM account ORDER BY created_at"
            ))
            .storage()?;
        statement
            .query_map([], account_from_row)
            .storage()?
            .collect::<rusqlite::Result<_>>()
            .storage()
    }

    pub fn account(&self, account_id: &str) -> Result<Account> {
        let connection = self.read();
        connection
            .query_row(
                &format!("SELECT {ACCOUNT_COLUMNS} FROM account WHERE id = ?1"),
                [account_id],
                account_from_row,
            )
            .optional()
            .storage()?
            .ok_or(Error::NotFound)
    }

    pub fn has_account_for(&self, email: &str) -> Result<bool> {
        self.read()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM account WHERE lower(email) = lower(trim(?1)))",
                [email],
                |row| row.get(0),
            )
            .storage()
    }

    pub fn next_account_color(&self) -> Result<u32> {
        let connection = self.read();
        connection
            .query_row(
                "SELECT COALESCE(MAX(color) + 1, 0) FROM account",
                [],
                |row| row.get(0),
            )
            .storage()
    }

    pub fn rename_account(&self, account_id: &str, display_name: &str) -> Result<()> {
        self.write(|transaction| {
            transaction
                .execute(
                    "UPDATE account SET display_name = ?2 WHERE id = ?1",
                    params![account_id, display_name],
                )
                .storage()?;
            Ok(())
        })
    }

    pub fn delete_account(&self, account_id: &str) -> Result<()> {
        self.write(|transaction| {
            transaction
                .execute("DELETE FROM account WHERE id = ?1", [account_id])
                .storage()?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use mail_model::Authentication;

    use crate::test_support::{account, store};

    #[test]
    fn an_address_is_known_whatever_its_case() {
        let (store, directory) = store();
        store.insert_account(&account("alice")).unwrap();
        assert!(store.has_account_for("ALICE@example.com").unwrap());
        assert!(!store.has_account_for("bob@example.com").unwrap());
        std::fs::remove_dir_all(directory).ok();
    }

    #[test]
    fn an_account_keeps_its_oauth_server() {
        let (store, directory) = store();
        let mut server = account("s");
        server.authentication = Authentication::Server;
        server.oauth_server = Some(mail_model::OAuthServer {
            issuer: "https://mail.example.org".into(),
            authorization_endpoint: "https://mail.example.org/login".into(),
            token_endpoint: "https://mail.example.org/auth/token".into(),
            client_id: "swc1.abc".into(),
        });
        store.insert_account(&server).unwrap();
        store.insert_account(&account("p")).unwrap();
        let stored = store.account("s").unwrap();
        assert_eq!(stored.authentication, Authentication::Server);
        assert_eq!(stored.oauth_server, server.oauth_server);
        assert_eq!(store.account("p").unwrap().oauth_server, None);
        std::fs::remove_dir_all(directory).ok();
    }

    #[test]
    fn an_account_keeps_how_it_signs_in() {
        let (store, directory) = store();
        let mut microsoft = account("m");
        microsoft.authentication = Authentication::Microsoft;
        store.insert_account(&microsoft).unwrap();
        store.insert_account(&account("p")).unwrap();
        assert_eq!(
            store.account("m").unwrap().authentication,
            Authentication::Microsoft
        );
        assert_eq!(
            store.account("p").unwrap().authentication,
            Authentication::Password
        );
        std::fs::remove_dir_all(directory).ok();
    }
}
