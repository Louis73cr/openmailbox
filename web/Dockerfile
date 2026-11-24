# Open Mailbox web: Expo web build + Rust mail core behind an HTTP bridge (core/crates/mail-web).
# docker build -f web/Dockerfile -t openmailbox-web .
FROM node:22-bookworm AS front
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
COPY modules/mail-core/package.json modules/mail-core/
COPY patches patches
RUN corepack enable && yarn install --immutable
COPY . .
RUN npx expo export -p web

FROM rust:1.99-bookworm AS core
WORKDIR /src
COPY core .
RUN RUSTUP_TOOLCHAIN=1.99.1 cargo build --release -p mail-web

FROM debian:bookworm-slim
RUN useradd -r -u 1000 mail-web && mkdir /data && chown mail-web /data
COPY --from=core /src/target/release/mail-web /usr/local/bin/mail-web
COPY --from=front /app/dist /web
USER mail-web
VOLUME /data
EXPOSE 8080
CMD ["mail-web"]
