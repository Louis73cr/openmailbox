use std::collections::HashSet;

use mail_model::{
    Category, EmailSummary, Result, ThreadFilter, ThreadPage, ThreadScope, ThreadSummary,
};
use rusqlite::{ToSql, Transaction, params, params_from_iter};

use crate::categories::THREAD_CATEGORY;
use crate::{EMAIL_COLUMNS, StorageResult, Store, email_from_row};

const NO_MAILBOX: i64 = -1;

pub(crate) fn refresh_threads(transaction: &Transaction, thread_ids: &HashSet<i64>) -> Result<()> {
    let mut remove_stale = transaction
        .prepare_cached(
            "DELETE FROM mailbox_thread WHERE thread_id = ?1 AND mailbox_id NOT IN (
               SELECT em.mailbox_id FROM email_mailbox em JOIN email e ON e.id = em.email_id WHERE e.thread_id = ?1)",
        )
        .storage()?;
    let mut upsert = transaction
        .prepare_cached(&format!(
            "INSERT INTO mailbox_thread (mailbox_id, thread_id, account_id, unified, latest_email_id,
               last_received_at, message_count, unread_count, is_flagged, has_attachment, category)
             SELECT em.mailbox_id, e.thread_id, e.account_id, COALESCE(m.role = 'inbox', 0), e.id,
               MAX(e.received_at), COUNT(*), SUM(1 - e.is_seen), SUM(e.is_flagged) > 0, SUM(e.has_attachment) > 0,
               {THREAD_CATEGORY}
             FROM email e
             JOIN email_mailbox em ON em.email_id = e.id
             JOIN mailbox m ON m.id = em.mailbox_id
             WHERE e.thread_id = ?1
             GROUP BY em.mailbox_id
             ON CONFLICT (mailbox_id, thread_id) DO UPDATE SET
               unified = excluded.unified,
               latest_email_id = excluded.latest_email_id,
               last_received_at = excluded.last_received_at,
               message_count = excluded.message_count,
               unread_count = excluded.unread_count,
               is_flagged = excluded.is_flagged,
               has_attachment = excluded.has_attachment,
               category = excluded.category"
        ))
        .storage()?;
    let mut remove_empty = transaction
        .prepare_cached("DELETE FROM thread WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM email WHERE thread_id = ?1)")
        .storage()?;
    for thread_id in thread_ids {
        remove_stale.execute([thread_id]).storage()?;
        upsert.execute([thread_id]).storage()?;
        remove_empty.execute([thread_id]).storage()?;
    }
    Ok(())
}

fn parse_cursor(cursor: Option<&str>) -> (i64, i64) {
    cursor
        .and_then(|value| value.split_once(':'))
        .and_then(|(received_at, row_id)| Some((received_at.parse().ok()?, row_id.parse().ok()?)))
        .unwrap_or((i64::MAX, i64::MAX))
}

// ponytail: scans the JSON recipients of each candidate thread; add a recipients table if
// `benchmark:store` shows it.
fn addressed_to_account(column: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM email x JOIN email_mailbox xm ON xm.email_id = x.id
           JOIN account a ON a.id = x.account_id, json_each(x.{column}) j
           WHERE x.thread_id = mt.thread_id AND xm.mailbox_id = mt.mailbox_id
             AND lower(json_extract(j.value, '$.email')) = lower(a.email))"
    )
}

fn bound_list<T: ToSql + Clone + 'static>(items: &[T], values: &mut Vec<Box<dyn ToSql>>) -> String {
    let start = values.len() + 1;
    values.extend(
        items
            .iter()
            .map(|item| Box::new(item.clone()) as Box<dyn ToSql>),
    );
    (start..start + items.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn filter_sql(filter: &ThreadFilter, values: &mut Vec<Box<dyn ToSql>>) -> String {
    let any =
        |clauses: Vec<String>| (!clauses.is_empty()).then(|| format!("({})", clauses.join(" OR ")));
    let include = any([
        filter.unread.then(|| "mt.unread_count > 0".to_owned()),
        filter.flagged.then(|| "mt.is_flagged".to_owned()),
    ]
    .into_iter()
    .flatten()
    .collect());
    let addressed = any([
        filter.to_me.then(|| addressed_to_account("to_json")),
        filter.cc_me.then(|| addressed_to_account("cc_json")),
    ]
    .into_iter()
    .flatten()
    .collect());
    let accounts = (!filter.account_ids.is_empty()).then(|| {
        format!(
            "mt.account_id IN ({})",
            bound_list(&filter.account_ids, values)
        )
    });
    let criteria: Vec<String> = [
        include,
        addressed,
        filter
            .with_attachment
            .then(|| "mt.has_attachment".to_owned()),
        filter
            .since
            .map(|since| format!("mt.last_received_at >= {}", bound_list(&[since], values))),
        accounts,
    ]
    .into_iter()
    .flatten()
    .collect();
    let criteria = if criteria.is_empty() {
        "1".to_owned()
    } else {
        criteria.join(" AND ")
    };
    if filter.keep_thread_ids.is_empty() {
        format!("({criteria})")
    } else {
        format!(
            "(mt.thread_id IN ({}) OR ({criteria}))",
            bound_list(&filter.keep_thread_ids, values)
        )
    }
}

impl Store {
    pub fn list_threads(
        &self,
        scope: ThreadScope,
        filter: &ThreadFilter,
        category: Option<Category>,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<ThreadPage> {
        let (cursor_received_at, cursor_row_id) = parse_cursor(cursor);
        let (scope_filter, scope_value) = match scope {
            ThreadScope::Unified => ("mt.unified = 1", 0),
            ThreadScope::Mailbox(mailbox_id) => ("mt.mailbox_id = ?1", mailbox_id),
        };
        let mut values: Vec<Box<dyn ToSql>> = vec![
            Box::new(scope_value),
            Box::new(cursor_received_at),
            Box::new(cursor_row_id),
            Box::new(limit),
            Box::new(category.map(Category::code)),
        ];
        let filter_sql = filter_sql(filter, &mut values);
        let connection = self.read();
        let mut statement = connection
            .prepare_cached(&format!(
                "SELECT mt.rowid, mt.thread_id, mt.mailbox_id, mt.message_count, mt.unread_count, mt.is_flagged,
                   mt.has_attachment, mt.last_received_at, mt.category, {EMAIL_COLUMNS}
                 FROM mailbox_thread mt JOIN email e ON e.id = mt.latest_email_id
                 WHERE {scope_filter}
                   AND {filter_sql}
                   AND (?5 IS NULL OR mt.category = ?5)
                   AND (mt.last_received_at < ?2 OR (mt.last_received_at = ?2 AND mt.rowid < ?3))
                 ORDER BY mt.last_received_at DESC, mt.rowid DESC
                 LIMIT ?4"
            ))
            .storage()?;
        let mut last_position = None;
        let threads: Vec<ThreadSummary> = statement
            .query_map(params_from_iter(values.iter()), |row| {
                let row_id: i64 = row.get(0)?;
                let last_received_at: i64 = row.get(7)?;
                last_position = Some((last_received_at, row_id));
                let latest = email_from_row(row, 9)?;
                Ok(ThreadSummary {
                    thread_id: row.get(1)?,
                    mailbox_id: row.get(2)?,
                    account_id: latest.account_id.clone(),
                    message_count: row.get(3)?,
                    unread_count: row.get(4)?,
                    is_flagged: row.get(5)?,
                    has_attachment: row.get(6)?,
                    last_received_at,
                    category: Category::from_code(row.get(8)?),
                    latest,
                })
            })
            .storage()?
            .collect::<rusqlite::Result<_>>()
            .storage()?;
        let next_cursor = (threads.len() as u32 == limit)
            .then_some(last_position)
            .flatten()
            .map(|(received_at, row_id)| format!("{received_at}:{row_id}"));
        Ok(ThreadPage {
            threads,
            next_cursor,
        })
    }

    pub fn thread_emails(
        &self,
        thread_id: i64,
        context_mailbox_id: Option<i64>,
    ) -> Result<Vec<EmailSummary>> {
        let connection = self.read();
        let mut statement = connection
            .prepare_cached(&format!(
                "SELECT {EMAIL_COLUMNS} FROM email e
                 WHERE e.thread_id = ?1 AND EXISTS (
                   SELECT 1 FROM email_mailbox em JOIN mailbox m ON m.id = em.mailbox_id
                   WHERE em.email_id = e.id
                     AND (em.mailbox_id = ?2 OR m.role IS NULL OR m.role NOT IN ('trash', 'junk')))
                 ORDER BY e.received_at"
            ))
            .storage()?;
        statement
            .query_map(
                params![thread_id, context_mailbox_id.unwrap_or(NO_MAILBOX)],
                |row| email_from_row(row, 0),
            )
            .storage()?
            .collect::<rusqlite::Result<_>>()
            .storage()
    }
}

#[cfg(test)]
mod tests {
    use mail_model::{
        Address, FetchedMessage, Flags, Keyword, MailboxRole, ParsedHeaders, RemoteMailbox,
        RenderedBody, ThreadFilter,
    };

    use super::*;
    use crate::test_support;

    fn message(
        uid: u32,
        message_id: &str,
        references: &[&str],
        received_at: i64,
        seen: bool,
    ) -> FetchedMessage {
        FetchedMessage {
            uid,
            flags: Flags {
                seen,
                ..Flags::default()
            },
            internal_date: Some(received_at),
            size: 100,
            headers: ParsedHeaders {
                message_id: Some(message_id.into()),
                references: references.iter().map(|value| value.to_string()).collect(),
                subject: Some(format!("Subject {uid}")),
                from: vec![Address {
                    name: Some("Bob".into()),
                    email: "bob@example.com".into(),
                }],
                preview: Some(format!("preview of {message_id}")),
                ..ParsedHeaders::default()
            },
        }
    }

    fn setup() -> (Store, std::path::PathBuf, i64, i64) {
        let (store, directory) = test_support::store();
        store
            .insert_account(&test_support::account("alice"))
            .unwrap();
        let mailbox = |name: &str, role| RemoteMailbox {
            remote_name: name.into(),
            name: name.into(),
            depth: 0,
            role: Some(role),
            selectable: true,
        };
        store
            .replace_mailboxes(
                "alice",
                &[
                    mailbox("INBOX", MailboxRole::Inbox),
                    mailbox("Trash", MailboxRole::Trash),
                ],
            )
            .unwrap();
        let inbox = store
            .mailbox_by_role("alice", MailboxRole::Inbox)
            .unwrap()
            .unwrap()
            .id;
        let trash = store
            .mailbox_by_role("alice", MailboxRole::Trash)
            .unwrap()
            .unwrap()
            .id;
        (store, directory, inbox, trash)
    }

    #[test]
    fn replies_are_grouped_in_one_thread_and_pages_follow_the_cursor() {
        let (store, _directory, inbox, _) = setup();
        store
            .insert_messages(
                "alice",
                inbox,
                &[
                    message(1, "root@x", &[], 1_000, true),
                    message(2, "reply@x", &["root@x"], 3_000, false),
                    message(3, "other@x", &[], 2_000, false),
                ],
            )
            .unwrap();

        let first_page = store
            .list_threads(
                ThreadScope::Unified,
                &ThreadFilter::default(),
                None,
                None,
                1,
            )
            .unwrap();
        assert_eq!(first_page.threads.len(), 1);
        assert_eq!(first_page.threads[0].message_count, 2);
        assert_eq!(first_page.threads[0].unread_count, 1);
        assert_eq!(
            first_page.threads[0].latest.preview.as_deref(),
            Some("preview of reply@x")
        );

        let second_page = store
            .list_threads(
                ThreadScope::Unified,
                &ThreadFilter::default(),
                None,
                first_page.next_cursor.as_deref(),
                1,
            )
            .unwrap();
        assert_eq!(
            second_page.threads[0].latest.subject.as_deref(),
            Some("Subject 3")
        );
        let third_page = store
            .list_threads(
                ThreadScope::Unified,
                &ThreadFilter::default(),
                None,
                second_page.next_cursor.as_deref(),
                1,
            )
            .unwrap();
        assert!(third_page.threads.is_empty());
    }

    #[test]
    fn keywords_and_moves_update_thread_aggregates_and_counts() {
        let (store, _directory, inbox, trash) = setup();
        store
            .insert_messages("alice", inbox, &[message(1, "a@x", &[], 1_000, false)])
            .unwrap();
        store.set_mailbox_counts(inbox, 1, 1).unwrap();
        let thread = store
            .list_threads(ThreadScope::Mailbox(inbox), &unread_only(), None, None, 10)
            .unwrap()
            .threads[0]
            .clone();

        store
            .set_keywords(&[thread.latest.id], &[Keyword::Seen], &[])
            .unwrap();
        assert!(
            store
                .list_threads(ThreadScope::Mailbox(inbox), &unread_only(), None, None, 10)
                .unwrap()
                .threads
                .is_empty()
        );
        assert_eq!(store.mailbox(inbox).unwrap().unread_count, 0);

        let sources = store
            .move_emails(&[thread.latest.id], inbox, Some(trash))
            .unwrap();
        assert_eq!(sources[0].uid, Some(1));
        assert!(
            store
                .list_threads(
                    ThreadScope::Unified,
                    &ThreadFilter::default(),
                    None,
                    None,
                    10
                )
                .unwrap()
                .threads
                .is_empty()
        );
        assert_eq!(
            store
                .list_threads(
                    ThreadScope::Mailbox(trash),
                    &ThreadFilter::default(),
                    None,
                    None,
                    10
                )
                .unwrap()
                .threads
                .len(),
            1
        );
        assert!(
            store
                .thread_emails(thread.thread_id, None)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            store
                .thread_emails(thread.thread_id, Some(trash))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_flag_set_on_any_copy_of_a_message_is_kept() {
        let (store, _directory, inbox, trash) = setup();
        store
            .insert_messages("alice", inbox, &[message(1, "self@x", &[], 1_000, false)])
            .unwrap();
        store
            .insert_messages("alice", trash, &[message(9, "self@x", &[], 1_000, true)])
            .unwrap();
        store.update_flags(inbox, &[(1, Flags::default())]).unwrap();
        let unread = |store: &Store| {
            store
                .list_threads(
                    ThreadScope::Mailbox(inbox),
                    &ThreadFilter::default(),
                    None,
                    None,
                    1,
                )
                .unwrap()
                .threads[0]
                .unread_count
        };
        assert_eq!(unread(&store), 0);

        store.remove_uids(trash, &[9]).unwrap();
        store.update_flags(inbox, &[(1, Flags::default())]).unwrap();
        assert_eq!(unread(&store), 1);
    }

    #[test]
    fn removed_uids_delete_orphan_emails_and_search_finds_the_rest() {
        let (store, _directory, inbox, _) = setup();
        store
            .insert_messages(
                "alice",
                inbox,
                &[
                    message(1, "a@x", &[], 1_000, false),
                    message(2, "b@x", &[], 2_000, false),
                ],
            )
            .unwrap();
        store.remove_uids(inbox, &[1]).unwrap();
        assert_eq!(store.local_uids(inbox).unwrap(), vec![2]);
        assert_eq!(store.search("subj", 10, &[]).unwrap().len(), 1);
        assert_eq!(store.search("b@x", 10, &[]).unwrap().len(), 1);
    }

    #[test]
    fn search_keeps_to_the_mailboxes_asked_and_says_where_each_hit_is() {
        let (store, _directory, inbox, trash) = setup();
        store
            .insert_messages("alice", inbox, &[message(1, "a@x", &[], 1_000, false)])
            .unwrap();
        store
            .insert_messages("alice", trash, &[message(2, "b@x", &[], 2_000, false)])
            .unwrap();

        let everywhere = store.search("subj", 10, &[]).unwrap();
        assert_eq!(everywhere.len(), 2);
        assert_eq!(everywhere[0].mailbox_id, trash);

        let in_inbox = store.search("subj", 10, &[inbox]).unwrap();
        assert_eq!(in_inbox.len(), 1);
        assert_eq!(in_inbox[0].mailbox_id, inbox);
    }

    #[test]
    fn search_finds_words_inside_text_written_without_spaces() {
        let (store, _directory, inbox, _) = setup();
        let with = |uid: u32, subject: &str, name: &str, preview: &str| {
            let mut message = message(uid, &format!("{uid}@x"), &[], uid as i64 * 1_000, false);
            message.headers.subject = Some(subject.into());
            message.headers.from[0].name = Some(name.into());
            message.headers.preview = Some(preview.into());
            message
        };
        store
            .insert_messages(
                "alice",
                inbox,
                &[
                    with(1, "会議のお知らせ", "山田太郎", "明日は10時です"),
                    with(2, "你好，世界。会议通知", "王伟", "ＰＤＦ資料を送ります"),
                    with(3, "다음 회의를 시작합니다", "김민수", "안녕하세요"),
                    with(4, "สวัสดีชาวโลก", "Somchai", "Résumé du projet"),
                ],
            )
            .unwrap();
        let found = |query: &str| -> Vec<u32> {
            let mut uids: Vec<u32> = store
                .search(query, 10, &[])
                .unwrap()
                .iter()
                .map(|hit| hit.email.received_at as u32 / 1_000)
                .collect();
            uids.sort_unstable();
            uids
        };
        assert_eq!(found("お知らせ"), [1]);
        assert_eq!(found("会議"), [1]);
        assert_eq!(found("太郎"), [1]);
        assert_eq!(found("10時"), [1]);
        assert_eq!(found("知会"), [0u32; 0]);
        assert_eq!(found("会议通知"), [2]);
        assert_eq!(found("世界"), [2]);
        assert_eq!(found("pdf"), [2]);
        assert_eq!(found("資料"), [2]);
        assert_eq!(found("의를"), [3]);
        assert_eq!(found("회의"), [3]);
        assert_eq!(found("ชาวโลก"), [4]);
        assert_eq!(found("โลก"), [4]);
        assert_eq!(found("resu proj"), [4]);
        assert_eq!(found("bob@ex"), [1, 2, 3, 4]);

        let id = store.search("お知らせ", 1, &[]).unwrap()[0].email.id;
        store
            .save_body(
                id,
                &RenderedBody {
                    html: None,
                    text: "年末年始の営業日についてご案内します".into(),
                    has_remote_content: false,
                    attachments: Vec::new(),
                    unsubscribe: None,
                },
            )
            .unwrap();
        assert_eq!(found("営業日"), [1]);
        assert_eq!(found("お知らせ"), [1]);
    }

    fn unread_only() -> ThreadFilter {
        ThreadFilter {
            unread: true,
            ..ThreadFilter::default()
        }
    }

    fn address(email: &str) -> Address {
        Address {
            name: None,
            email: email.into(),
        }
    }

    fn subjects(store: &Store, scope: ThreadScope, filter: &ThreadFilter) -> Vec<String> {
        store
            .list_threads(scope, filter, None, None, 10)
            .unwrap()
            .threads
            .into_iter()
            .map(|thread| thread.latest.subject.unwrap())
            .collect()
    }

    #[test]
    fn filter_combines_include_criteria_with_or() {
        let (store, _directory, inbox, _) = setup();
        let mut flagged = message(2, "b@x", &[], 2_000, true);
        flagged.flags.flagged = true;
        store
            .insert_messages(
                "alice",
                inbox,
                &[
                    message(1, "a@x", &[], 3_000, false),
                    flagged,
                    message(3, "c@x", &[], 1_000, true),
                ],
            )
            .unwrap();
        let scope = ThreadScope::Mailbox(inbox);

        let unread_or_flagged = ThreadFilter {
            unread: true,
            flagged: true,
            ..ThreadFilter::default()
        };
        assert_eq!(
            subjects(&store, scope, &unread_or_flagged),
            ["Subject 1", "Subject 2"]
        );
        let unread = ThreadFilter {
            unread: true,
            ..ThreadFilter::default()
        };
        assert_eq!(subjects(&store, scope, &unread), ["Subject 1"]);
        assert_eq!(subjects(&store, scope, &ThreadFilter::default()).len(), 3);
    }

    #[test]
    fn filter_ands_sections() {
        let (store, _directory, inbox, _) = setup();
        let mut with_attachment = message(1, "a@x", &[], 2_000, false);
        with_attachment.headers.has_attachment = true;
        store
            .insert_messages(
                "alice",
                inbox,
                &[with_attachment, message(2, "b@x", &[], 1_000, false)],
            )
            .unwrap();

        let filter = ThreadFilter {
            unread: true,
            with_attachment: true,
            ..ThreadFilter::default()
        };
        assert_eq!(
            subjects(&store, ThreadScope::Mailbox(inbox), &filter),
            ["Subject 1"]
        );
    }

    #[test]
    fn to_me_and_cc_me_match_the_account_address_case_insensitively() {
        let (store, _directory, inbox, _) = setup();
        let mut to_me = message(1, "a@x", &[], 3_000, true);
        to_me.headers.to = vec![address("Alice@Example.com")];
        let mut cc_me = message(2, "b@x", &[], 2_000, true);
        cc_me.headers.to = vec![address("team@example.com")];
        cc_me.headers.cc = vec![address("alice@example.com")];
        let mut other = message(3, "c@x", &[], 1_000, true);
        other.headers.to = vec![address("team@example.com")];
        store
            .insert_messages("alice", inbox, &[to_me, cc_me, other])
            .unwrap();
        let scope = ThreadScope::Mailbox(inbox);

        let to = ThreadFilter {
            to_me: true,
            ..ThreadFilter::default()
        };
        assert_eq!(subjects(&store, scope, &to), ["Subject 1"]);
        let cc = ThreadFilter {
            cc_me: true,
            ..ThreadFilter::default()
        };
        assert_eq!(subjects(&store, scope, &cc), ["Subject 2"]);
        let either = ThreadFilter {
            to_me: true,
            cc_me: true,
            ..ThreadFilter::default()
        };
        assert_eq!(subjects(&store, scope, &either), ["Subject 1", "Subject 2"]);
    }

    #[test]
    fn since_keeps_threads_received_from_then() {
        let (store, _directory, inbox, _) = setup();
        store
            .insert_messages(
                "alice",
                inbox,
                &[
                    message(1, "a@x", &[], 1_000, true),
                    message(2, "b@x", &[], 3_000, true),
                ],
            )
            .unwrap();

        let filter = ThreadFilter {
            since: Some(2_000),
            ..ThreadFilter::default()
        };
        assert_eq!(
            subjects(&store, ThreadScope::Mailbox(inbox), &filter),
            ["Subject 2"]
        );
    }

    #[test]
    fn account_ids_limit_the_unified_list() {
        let (store, _directory, inbox, _) = setup();
        store.insert_account(&test_support::account("bob")).unwrap();
        store
            .replace_mailboxes(
                "bob",
                &[RemoteMailbox {
                    remote_name: "INBOX".into(),
                    name: "INBOX".into(),
                    depth: 0,
                    role: Some(MailboxRole::Inbox),
                    selectable: true,
                }],
            )
            .unwrap();
        let bob_inbox = store
            .mailbox_by_role("bob", MailboxRole::Inbox)
            .unwrap()
            .unwrap()
            .id;
        store
            .insert_messages("alice", inbox, &[message(1, "a@x", &[], 2_000, true)])
            .unwrap();
        store
            .insert_messages("bob", bob_inbox, &[message(2, "b@x", &[], 1_000, true)])
            .unwrap();

        let alice_only = ThreadFilter {
            account_ids: vec!["alice".into()],
            ..ThreadFilter::default()
        };
        assert_eq!(
            subjects(&store, ThreadScope::Unified, &alice_only),
            ["Subject 1"]
        );
        assert_eq!(
            subjects(&store, ThreadScope::Unified, &ThreadFilter::default()).len(),
            2
        );
    }

    #[test]
    fn kept_threads_bypass_criteria_but_not_category() {
        let (store, _directory, inbox, _) = setup();
        store
            .insert_messages(
                "alice",
                inbox,
                &[
                    message(1, "a@x", &[], 2_000, true),
                    message(2, "b@x", &[], 1_000, true),
                ],
            )
            .unwrap();
        let scope = ThreadScope::Mailbox(inbox);
        let read = store
            .list_threads(scope, &ThreadFilter::default(), None, None, 10)
            .unwrap()
            .threads[1]
            .thread_id;

        let filter = ThreadFilter {
            unread: true,
            keep_thread_ids: vec![read],
            ..ThreadFilter::default()
        };
        assert_eq!(subjects(&store, scope, &filter), ["Subject 2"]);
        assert!(
            store
                .list_threads(scope, &filter, Some(Category::Updates), None, 10)
                .unwrap()
                .threads
                .is_empty()
        );
    }

    #[test]
    fn kept_threads_page_in_date_order() {
        let (store, _directory, inbox, _) = setup();
        store
            .insert_messages(
                "alice",
                inbox,
                &[
                    message(1, "a@x", &[], 3_000, false),
                    message(2, "b@x", &[], 2_000, true),
                    message(3, "c@x", &[], 1_000, false),
                ],
            )
            .unwrap();
        let scope = ThreadScope::Mailbox(inbox);
        let read = store
            .list_threads(scope, &ThreadFilter::default(), None, None, 10)
            .unwrap()
            .threads[1]
            .thread_id;
        let filter = ThreadFilter {
            unread: true,
            keep_thread_ids: vec![read],
            ..ThreadFilter::default()
        };

        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = store
                .list_threads(scope, &filter, None, cursor.as_deref(), 1)
                .unwrap();
            seen.extend(
                page.threads
                    .into_iter()
                    .map(|thread| thread.latest.subject.unwrap()),
            );
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        assert_eq!(seen, ["Subject 1", "Subject 2", "Subject 3"]);
    }
}
