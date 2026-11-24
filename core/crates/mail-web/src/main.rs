#[tokio::main]
async fn main() {
    let env = |key: &str, default: &str| std::env::var(key).unwrap_or_else(|_| default.into());
    let router = mail_web::router(mail_web::Options {
        data_dir: env("DATA_DIR", "/data").into(),
        web_dir: env("WEB_DIR", "/web").into(),
        user_header: env("USER_HEADER", "x-authentik-username"),
        single_user: std::env::var("SINGLE_USER").ok(),
        access_token: None,
    });
    let address = env("LISTEN", "0.0.0.0:8080");
    let listener = tokio::net::TcpListener::bind(&address).await.unwrap();
    println!("open mailbox web on {address}");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap();
}
