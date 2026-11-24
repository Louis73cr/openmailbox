//! Open Mailbox for the Linux desktop: the mail core and the web UI in one native window.
//! The core is served on 127.0.0.1 behind a per-launch token cookie; WebKitGTK shows the UI.

use std::path::PathBuf;
use std::process::Command;

use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::platform::unix::{EventLoopBuilderExtUnix, WindowExtUnix};
use tao::window::WindowBuilder;
use wry::{NewWindowResponse, WebViewBuilder, WebViewBuilderExtUnix};

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| "/tmp".into())
}

fn data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".local/share"))
        .join("openmailbox")
}

/// The exported web UI: `$OPENMAILBOX_WEB`, else `<prefix>/share/openmailbox/web` next to the binary.
fn web_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("OPENMAILBOX_WEB") {
        return dir.into();
    }
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().and_then(|bin| bin.parent()).unwrap_or(&exe).join("share/openmailbox/web")
}

fn downloads_dir() -> PathBuf {
    Command::new("xdg-user-dir")
        .arg("DOWNLOAD")
        .output()
        .ok()
        .map(|output| PathBuf::from(String::from_utf8_lossy(&output.stdout).trim()))
        .filter(|dir| dir.is_dir())
        .unwrap_or_else(|| home().join("Downloads"))
}

fn open_externally(target: &str) {
    let _ = Command::new("xdg-open").arg(target).spawn();
}

/// `filename*=UTF-8''name%20x.pdf` as sent by mail-web.
fn attachment_name(disposition: &str) -> Option<String> {
    let encoded = disposition.split("filename*=UTF-8''").nth(1)?.split(';').next()?;
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?, 16) {
                decoded.push(byte);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    let name = String::from_utf8_lossy(&decoded).replace(['/', '\\', '\0'], "_");
    (!name.is_empty() && !name.starts_with('.')).then_some(name)
}

/// Attachments open with `window.open`: fetch them with the token, save to Downloads, open.
fn save_attachment(url: String, cookie: String) {
    std::thread::spawn(move || {
        let Ok(mut response) = ureq::get(&url).header("cookie", &cookie).call() else { return };
        let name = response
            .headers()
            .get("content-disposition")
            .and_then(|value| value.to_str().ok())
            .and_then(attachment_name)
            .unwrap_or_else(|| "piece-jointe".into());
        let Ok(bytes) = response.body_mut().with_config().limit(200 * 1024 * 1024).read_to_vec() else { return };
        let directory = downloads_dir();
        let (stem, extension) = match name.rsplit_once('.') {
            Some((stem, extension)) => (stem.to_owned(), format!(".{extension}")),
            None => (name.clone(), String::new()),
        };
        let mut path = directory.join(&name);
        for copy in 1.. {
            if !path.exists() {
                break;
            }
            path = directory.join(format!("{stem} ({copy}){extension}"));
        }
        if std::fs::write(&path, bytes).is_ok() {
            open_externally(&path.to_string_lossy());
        }
    });
}

fn main() {
    let token = uuid::Uuid::new_v4().simple().to_string();
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
        .expect("bind 127.0.0.1");
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let router = mail_web::router(mail_web::Options {
        data_dir: data_dir(),
        web_dir: web_dir(),
        user_header: "x-openmailbox-unused".into(),
        single_user: Some("local".into()),
        access_token: Some(token.clone()),
    });
    runtime.spawn(async move { axum_serve(listener, router).await });

    // Same id as the .desktop file, so the dock shows the app icon (Wayland app_id).
    let event_loop = EventLoopBuilder::new().with_app_id("fr.croci.openmailbox").build();
    let window = WindowBuilder::new()
        .with_title("Open Mailbox")
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(480.0, 500.0))
        .build(&event_loop)
        .expect("window");

    let cookie = format!("omw_token={token}");
    let own = origin.clone();
    let own_window = origin.clone();
    let _webview = WebViewBuilder::new()
        .with_url(format!("{origin}/desktop-login?token={token}"))
        .with_navigation_handler(move |url| {
            let inside = url.starts_with(&own) || url.starts_with("about:");
            if !inside {
                open_externally(&url);
            }
            inside
        })
        .with_new_window_req_handler(move |url, _features| {
            if url.starts_with(&format!("{own_window}/api/attachment/")) {
                save_attachment(url, cookie.clone());
            } else if url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:") {
                open_externally(&url);
            }
            NewWindowResponse::Deny
        })
        .build_gtk(window.default_vbox().expect("tao vbox"))
        .expect("webview");

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            *control_flow = ControlFlow::Exit;
        }
    });
}

async fn axum_serve(listener: tokio::net::TcpListener, router: mail_web::Router) {
    if let Err(error) = mail_web::serve(listener, router).await {
        eprintln!("mail server stopped: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::attachment_name;

    #[test]
    fn decodes_attachment_names() {
        assert_eq!(attachment_name("inline; filename*=UTF-8''facture%20n%C2%B01.pdf").as_deref(), Some("facture n°1.pdf"));
        assert_eq!(attachment_name("inline; filename*=UTF-8''..%2F..%2Fetc").as_deref(), None);
        assert_eq!(attachment_name("inline; filename*=UTF-8''a%2Fb").as_deref(), Some("a_b"));
        assert_eq!(attachment_name("inline").as_deref(), None);
    }
}
