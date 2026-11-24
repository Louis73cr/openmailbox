use mail_model::SyncStatus;

use super::*;

#[test]
fn coalesce_keeps_the_latest_secret_of_each_account() {
    let changed = |account_id: &str, secret: &str| CoreEvent::SecretChanged {
        account_id: account_id.into(),
        secret: secret.into(),
    };
    assert_eq!(
        coalesce(vec![
            changed("a", "1"),
            changed("b", "1"),
            changed("a", "2")
        ]),
        vec![changed("b", "1"), changed("a", "2")]
    );
}

#[test]
fn coalesce_merges_mailbox_changes_and_keeps_the_latest_sync_state() {
    let syncing = |status| CoreEvent::SyncState {
        account_id: "a".into(),
        status,
    };
    let merged = coalesce(vec![
        CoreEvent::MailboxesChanged {
            mailbox_ids: vec![2],
        },
        syncing(SyncStatus::Syncing),
        CoreEvent::AccountsChanged,
        CoreEvent::MailboxesChanged {
            mailbox_ids: vec![1, 2],
        },
        syncing(SyncStatus::Idle {
            last_synced_at: Some(5),
        }),
        CoreEvent::AccountsChanged,
    ]);
    assert_eq!(
        merged,
        vec![
            CoreEvent::MailboxesChanged {
                mailbox_ids: vec![1, 2]
            },
            CoreEvent::AccountsChanged,
            syncing(SyncStatus::Idle {
                last_synced_at: Some(5)
            }),
        ]
    );
}
