# Toolchain for the desktop app (WebKitGTK headers); bookworm's glibc keeps the binary portable.
FROM rust:1.99-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
    && rm -rf /var/lib/apt/lists/* && cargo install cargo-deb --locked
