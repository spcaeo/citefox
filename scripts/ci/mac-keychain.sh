#!/usr/bin/env bash
# Imports the Developer ID Application certificate into a temporary keychain that
# electron-builder can find, and prints the certificate's name as `CSC_NAME=...`.
#
# Why this exists: electron-builder creates its own temporary keychain with a random
# password, then unlocks it with the .p12 file's password (set-key-partition-list -k).
# That fails ("SecKeychainUnlock: The user name or passphrase you entered is not
# correct") for any .p12 that has a password. Here the keychain password is ours.
#
# Input (environment, never printed):
#   P12_BASE64   the .p12 file as base64 text (the MAC_CSC_LINK secret), or
#   P12_FILE     a path to the .p12 file
#   P12_PASSWORD the .p12 password (the MAC_CSC_KEY_PASSWORD secret)
#   KEYCHAIN_PATH  optional, where to create the keychain
# Output: `CSC_NAME=<certificate common name>` on stdout; in GitHub Actions also appended
# to $GITHUB_ENV. Then run electron-builder with CSC_NAME set and CSC_LINK unset.
# Remove the keychain afterwards with: security delete-keychain "$KEYCHAIN_PATH"
set -euo pipefail

: "${P12_PASSWORD:?P12_PASSWORD is not set}"
KC="${KEYCHAIN_PATH:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/citefox-signing.keychain-db}"
KCP="$(openssl rand -base64 24)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [ -n "${P12_BASE64:-}" ]; then
  P12="$WORK/cert.p12"
  printf '%s' "$P12_BASE64" | base64 --decode >"$P12"
elif [ -n "${P12_FILE:-}" ]; then
  P12="$P12_FILE"
else
  echo "mac-keychain: set P12_BASE64 or P12_FILE" >&2
  exit 1
fi

security delete-keychain "$KC" 2>/dev/null || true
security create-keychain -p "$KCP" "$KC"
security set-keychain-settings -lut 21600 "$KC"
security unlock-keychain -p "$KCP" "$KC"

# Apple's intermediate certificates, so the Developer ID chain is trusted on a clean runner.
# A failed download is not fatal: most runners already have them.
for cert in DeveloperIDG2CA AppleWWDRCAG3; do
  if curl -fsSL --max-time 30 "https://www.apple.com/certificateauthority/${cert}.cer" -o "$WORK/${cert}.cer"; then
    security import "$WORK/${cert}.cer" -k "$KC" -T /usr/bin/codesign >/dev/null 2>&1 || true
  fi
done

security import "$P12" -k "$KC" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KCP" "$KC" >/dev/null

# Put it first in the user's keychain search list so codesign finds the identity.
EXISTING="$(security list-keychains -d user | tr -d '"' | tr '\n' ' ')"
# shellcheck disable=SC2086
security list-keychains -d user -s "$KC" $EXISTING

NAME="$(security find-identity -v -p codesigning "$KC" | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n1)"
if [ -z "$NAME" ]; then
  echo "mac-keychain: no valid 'Developer ID Application' identity in the certificate" >&2
  security find-identity -v -p codesigning "$KC" >&2 || true
  exit 1
fi
# electron-builder wants the name without the "Developer ID Application:" prefix.
NAME="${NAME#Developer ID Application: }"
echo "CSC_NAME=${NAME}"
if [ -n "${GITHUB_ENV:-}" ]; then echo "CSC_NAME=${NAME}" >>"$GITHUB_ENV"; fi
