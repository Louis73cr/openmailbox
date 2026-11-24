use std::collections::HashSet;

use mail_model::{CLASSIFIER_VERSION, Category, ParsedHeaders, Result, SendingSignals, classify};
use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::threads::refresh_threads;
use crate::{StorageResult, Store};

/// The most important category among a mailbox's messages of a thread (see [`Category`]). Sums
/// rather than MIN: `refresh_threads` relies on its single MAX to pick the latest email's row.
pub(crate) const THREAD_CATEGORY: &str = "CASE
       WHEN SUM(COALESCE(e.category, 0) = 0) > 0 THEN 0
       WHEN SUM(e.category = 1) > 0 THEN 1
       WHEN SUM(e.category = 2) > 0 THEN 2
       ELSE 3 END";

fn domain(address: &str) -> Option<&str> {
    address.rsplit_once('@').map(|(_, domain)| domain)
}

/// Senders the user moved come first, then the user's own mail and their colleagues', then people
/// the user writes to, then the header rules.
fn decide(
    connection: &Connection,
    account_email: &str,
    sender: Option<&str>,
    subject: Option<&str>,
    signals: SendingSignals,
) -> Result<Category> {
    let Some(sender) = sender else {
        return Ok(classify(None, subject, signals));
    };
    let chosen: Option<i64> = connection
        .prepare_cached("SELECT category FROM sender_category WHERE email = ?1")
        .storage()?
        .query_row([sender], |row| row.get(0))
        .optional()
        .storage()?;
    if let Some(code) = chosen {
        return Ok(Category::from_code(code));
    }
    // Colleagues' newsletters stay with their mail, as in Mail; programs sending in the user's
    // name or from the user's domain (a GitLab, a form, a no-reply) still say so.
    let colleague = domain(sender).is_some_and(|theirs| {
        domain(account_email).is_some_and(|ours| theirs.eq_ignore_ascii_case(ours))
    });
    if colleague
        && !signals.automated
        && classify(Some(sender), subject, SendingSignals::default()) == Category::Primary
    {
        return Ok(Category::Primary);
    }
    let written_to: bool = connection
        .prepare_cached("SELECT sent > 0 FROM correspondent WHERE email = ?1")
        .storage()?
        .query_row([sender], |row| row.get(0))
        .optional()
        .storage()?
        .unwrap_or(false);
    // The user's own address is no correspondent: writing to oneself says nothing of the
    // programs that send in one's name.
    Ok(
        if written_to && !sender.eq_ignore_ascii_case(account_email) {
            Category::Primary
        } else {
            classify(Some(sender), subject, signals)
        },
    )
}

pub(crate) fn category_of(
    transaction: &Transaction,
    account_email: &str,
    headers: &ParsedHeaders,
) -> Result<Category> {
    let sender = headers.from.first().map(|address| address.email.as_str());
    decide(
        transaction,
        account_email,
        sender,
        headers.subject.as_deref(),
        headers.signals,
    )
}

/// When the rules changed since the mail was classified, or for mail stored before categories,
/// classifies it again from what is stored. Messages whose headers were never fetched keep their
/// category: the inbox ones are classified again once their headers are (see
/// [`Store::uids_with_unknown_signals`]).
pub(crate) fn classify_again(connection: &Connection) -> Result<()> {
    let classified_with: Option<i64> = connection
        .query_row(
            "SELECT value FROM store_setting WHERE key = 'classifier'",
            [],
            |row| row.get(0),
        )
        .optional()
        .storage()?;
    if classified_with == Some(CLASSIFIER_VERSION) {
        return Ok(());
    }
    let transaction = connection.unchecked_transaction().storage()?;
    let stored: Vec<(
        i64,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        String,
    )> = transaction
        .prepare(
            "SELECT e.id, e.sender, e.subject, e.signals, e.category, a.email
                 FROM email e JOIN account a ON a.id = e.account_id
                 WHERE e.signals IS NOT NULL OR e.category IS NULL",
        )
        .storage()?
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .storage()?
        .collect::<rusqlite::Result<_>>()
        .storage()?;
    {
        let mut update = transaction
            .prepare("UPDATE email SET category = ?2 WHERE id = ?1")
            .storage()?;
        for (email_id, sender, subject, signals, previous, account_email) in &stored {
            let category = decide(
                &transaction,
                account_email,
                sender.as_deref(),
                subject.as_deref(),
                signals.map(SendingSignals::from_bits).unwrap_or_default(),
            )?;
            if *previous != Some(category.code()) {
                update
                    .execute(params![email_id, category.code()])
                    .storage()?;
            }
        }
    }
    // CROSS JOIN keeps SQLite on the thread's own messages rather than every message of the
    // mailbox, for each thread: 30 times faster on a real inbox.
    transaction
        .execute_batch(&format!(
            "UPDATE mailbox_thread SET category = (
               SELECT {THREAD_CATEGORY} FROM email e CROSS JOIN email_mailbox em ON em.email_id = e.id
               WHERE e.thread_id = mailbox_thread.thread_id AND em.mailbox_id = mailbox_thread.mailbox_id);
             INSERT INTO store_setting (key, value) VALUES ('classifier', {CLASSIFIER_VERSION})
               ON CONFLICT (key) DO UPDATE SET value = excluded.value;"
        ))
        .storage()?;
    transaction.commit().storage()
}

impl Store {
    /// Inbox messages stored before their sending headers were fetched, newest first.
    pub fn uids_with_unknown_signals(&self, mailbox_id: i64, limit: usize) -> Result<Vec<u32>> {
        let connection = self.read();
        let mut statement = connection
            .prepare_cached(
                "SELECT em.uid FROM email e JOIN email_mailbox em ON em.email_id = e.id
                 WHERE e.signals IS NULL AND em.mailbox_id = ?1 AND em.uid IS NOT NULL
                 ORDER BY em.uid DESC LIMIT ?2",
            )
            .storage()?;
        statement
            .query_map(params![mailbox_id, limit as i64], |row| row.get(0))
            .storage()?
            .collect::<rusqlite::Result<_>>()
            .storage()
    }

    /// Classifies again, from their headers fetched anew, the messages `asked` for; those the
    /// server no longer has keep their guess. Returns whether a thread changed category or a
    /// message got the sender behind its alias.
    pub fn reclassify(
        &self,
        account_id: &str,
        mailbox_id: i64,
        asked: &[u32],
        fetched: &[mail_model::FetchedMessage],
    ) -> Result<bool> {
        self.write(|transaction| {
            let account_email: String = transaction
                .query_row("SELECT email FROM account WHERE id = ?1", [account_id], |row| row.get(0))
                .storage()?;
            let mut find = transaction
                .prepare_cached(
                    "SELECT e.id, e.thread_id, e.category FROM email e JOIN email_mailbox em ON em.email_id = e.id
                     WHERE em.mailbox_id = ?1 AND em.uid = ?2",
                )
                .storage()?;
            let mut update = transaction
                .prepare_cached(
                    "UPDATE email SET category = ?2, signals = ?3,
                       original_sender = COALESCE(?4, original_sender) WHERE id = ?1",
                )
                .storage()?;
            let mut touched = HashSet::new();
            let mut senders_found = false;
            for message in fetched {
                let Some((email_id, thread_id, previous)) = find
                    .query_row(params![mailbox_id, message.uid], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, Option<i64>>(2)?))
                    })
                    .optional()
                    .storage()?
                else {
                    continue;
                };
                let category = category_of(transaction, &account_email, &message.headers)?;
                update
                    .execute(params![
                        email_id,
                        category.code(),
                        message.headers.signals.bits(),
                        message.headers.original_sender
                    ])
                    .storage()?;
                senders_found |= message.headers.original_sender.is_some();
                if previous != Some(category.code()) {
                    touched.insert(thread_id);
                }
            }
            let mut forget = transaction
                .prepare_cached(
                    "UPDATE email SET signals = COALESCE(signals, 0) WHERE id IN (
                       SELECT email_id FROM email_mailbox WHERE mailbox_id = ?1 AND uid = ?2)",
                )
                .storage()?;
            for uid in asked {
                forget.execute(params![mailbox_id, uid]).storage()?;
            }
            refresh_threads(transaction, &touched)?;
            Ok(senders_found || !touched.is_empty())
        })
    }

    /// Puts every message from `sender`, past and future, in `category`. Returns the mailboxes
    /// whose threads changed.
    pub fn set_sender_category(&self, sender: &str, category: Category) -> Result<Vec<i64>> {
        let sender = sender.trim().to_lowercase();
        self.write(|transaction| {
            transaction
                .execute(
                    "INSERT INTO sender_category (email, category) VALUES (?1, ?2)
                     ON CONFLICT (email) DO UPDATE SET category = excluded.category",
                    params![sender, category.code()],
                )
                .storage()?;
            transaction
                .execute(
                    "UPDATE email SET category = ?2 WHERE sender = ?1",
                    params![sender, category.code()],
                )
                .storage()?;
            let thread_ids: HashSet<i64> = transaction
                .prepare("SELECT DISTINCT thread_id FROM email WHERE sender = ?1")
                .storage()?
                .query_map([&sender], |row| row.get(0))
                .storage()?
                .collect::<rusqlite::Result<_>>()
                .storage()?;
            refresh_threads(transaction, &thread_ids)?;
            transaction
                .prepare(
                    "SELECT DISTINCT mt.mailbox_id FROM mailbox_thread mt
                     JOIN email e ON e.thread_id = mt.thread_id WHERE e.sender = ?1",
                )
                .storage()?
                .query_map([&sender], |row| row.get(0))
                .storage()?
                .collect::<rusqlite::Result<_>>()
                .storage()
        })
    }
}

#[cfg(test)]
#[path = "../../../tests/mail_store/categories.rs"]
mod tests;
