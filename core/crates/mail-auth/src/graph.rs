use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use mail_model::{Error, Result};
use serde::Deserialize;

const SEND_MAIL_URL: &str = "https://graph.microsoft.com/v1.0/me/sendMail";
const TIMEOUT: Duration = Duration::from_secs(120);

fn request_body(mime: &[u8]) -> String {
    STANDARD.encode(mime)
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Deserialize)]
struct ErrorDetail {
    message: String,
}

fn send_result(status: u16, body: &str) -> Result<()> {
    match status {
        200..=299 => Ok(()),
        429 | 500.. => Err(Error::Network(format!(
            "Microsoft Graph unavailable ({status})"
        ))),
        _ => Err(Error::Server(
            serde_json::from_str::<ErrorResponse>(body)
                .map(|response| response.error.message)
                .unwrap_or_else(|_| format!("Microsoft Graph refused the message ({status})")),
        )),
    }
}

pub async fn send_mail(access_token: &str, mime: &[u8]) -> Result<()> {
    let authorization = format!("Bearer {access_token}");
    let body = request_body(mime);
    let (status, answer) = tokio::task::spawn_blocking(move || {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            .http_status_as_error(false)
            .build()
            .into();
        let mut response = agent
            .post(SEND_MAIL_URL)
            .header("Authorization", &authorization)
            .content_type("text/plain")
            .send(&body)
            .map_err(|error| Error::Network(error.to_string()))?;
        let status = response.status().as_u16();
        let answer = response.body_mut().read_to_string().unwrap_or_default();
        Ok::<_, Error>((status, answer))
    })
    .await
    .map_err(|error| Error::Network(error.to_string()))??;
    send_result(status, &answer)
}

#[cfg(test)]
mod tests {
    use mail_model::Error;

    use super::*;

    #[test]
    fn graph_takes_the_message_as_base64_mime() {
        assert_eq!(
            request_body(b"Subject: Hi\r\n\r\nBody"),
            "U3ViamVjdDogSGkNCg0KQm9keQ=="
        );
    }

    #[test]
    fn graph_answers_become_sent_temporary_or_final() {
        assert!(send_result(202, "").is_ok());
        assert!(matches!(send_result(503, "<html>"), Err(Error::Network(_))));
        assert!(matches!(send_result(429, "{}"), Err(Error::Network(_))));
        let denied = r#"{"error":{"code":"ErrorAccessDenied","message":"Access is denied."}}"#;
        assert!(
            matches!(send_result(403, denied), Err(Error::Server(message)) if message == "Access is denied.")
        );
        assert!(
            matches!(send_result(413, "too big"), Err(Error::Server(message)) if message.contains("413"))
        );
    }
}
