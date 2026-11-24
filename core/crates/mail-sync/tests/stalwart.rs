use mail_model::{Security, ServerEndpoint};

#[tokio::test]
#[ignore = "needs tools/mail-server/mail-server.sh oauth"]
async fn stalwart_offers_what_an_open_mail_client_needs() {
    let imap = ServerEndpoint {
        host: "localhost".into(),
        port: 993,
        security: Security::Tls,
    };
    let configuration = proto_imap::oauth_configuration(&imap, "carol@example.com")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        configuration,
        "https://localhost/.well-known/openid-configuration"
    );
    let metadata = mail_auth::server::discover(&configuration).await.unwrap();
    assert_eq!(metadata.issuer, "https://localhost");
    let server = mail_auth::server::register(&metadata).await.unwrap();
    assert!(server.client_id.starts_with("swc1."));
    let (request, _) =
        mail_auth::oauth::begin_server(&server, "carol@example.com", &["localhost"]).unwrap();
    assert!(request.url.starts_with("https://localhost/login?"));
}
