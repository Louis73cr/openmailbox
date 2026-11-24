#!/usr/bin/env bash
# Builds the Ubuntu package: web/desktop/build-deb.sh → core/target/debian/openmailbox_*.deb
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
npx expo export -p web
docker build -q -t omw-desktop-build -f web/desktop/build.Dockerfile web/desktop >/dev/null
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e CARGO_HOME=/tmp/cargo -e RUSTUP_TOOLCHAIN=1.99.1 \
  -v "$root":/repo -w /repo/core omw-desktop-build \
  cargo deb -p mail-desktop
ls -1 core/target/debian/*.deb
