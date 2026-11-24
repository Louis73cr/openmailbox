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
