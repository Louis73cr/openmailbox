#!/usr/bin/env bash
# One-time setup: creates the key that signs the APT repository and gives it to GitHub Actions
# (secret APT_GPG_PRIVATE_KEY). A backup of the private key stays in ~/.local/share/openmailbox-apt-key.
set -euo pipefail
repo=Louis73cr/openmailbox
backup="$HOME/.local/share/openmailbox-apt-key"
export GNUPGHOME="$(mktemp -d)"
trap 'rm -rf "$GNUPGHOME"' EXIT
gpg --batch --quiet --passphrase '' --quick-gen-key "Open Mailbox APT ($repo) <louis73cr@users.noreply.github.com>" rsa4096 sign never
fingerprint=$(gpg --list-keys --with-colons | awk -F: '/^fpr/ {print $10; exit}')
install -d -m 700 "$backup"
(umask 077; gpg --batch --armor --export-secret-keys "$fingerprint" > "$backup/private.asc")
gpg --batch --armor --export-secret-keys "$fingerprint" | gh secret set APT_GPG_PRIVATE_KEY --repo "$repo"
echo "Key $fingerprint stored as GitHub secret; backup in $backup/private.asc"
gh workflow run desktop-apt.yml --repo "$repo" --ref web
echo "Build started: gh run watch --repo $repo"
