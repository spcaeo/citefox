#!/usr/bin/env bash
# CiteFox installer for macOS and Linux.
#
#   curl -fsSL https://spcaeo.github.io/citefox/install.sh | bash
#
# Downloads the latest CiteFox release from GitHub (https://github.com/spcaeo/citefox/releases),
# checks its SHA-256 against the release's SHA256SUMS.txt, and installs it:
#   macOS  → /Applications/CiteFox.app (or ~/Applications if /Applications is not writable)
#   Linux  → ~/Applications/CiteFox.AppImage, plus a menu entry
# Nothing else on your computer is changed. Source: site/install.sh in the repo.
set -euo pipefail

REPO="spcaeo/citefox"
API="https://api.github.com/repos/${REPO}/releases/latest"

say() { printf '\033[1;33m›\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is needed."

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) pattern='mac-universal\.zip$' ;;
  Linux)
    case "$arch" in
      x86_64 | amd64) pattern='linux-x86_64\.AppImage$' ;;
      aarch64 | arm64) pattern='linux-arm64\.AppImage$' ;;
      *) fail "Unsupported processor: $arch" ;;
    esac
    ;;
  *) fail "This installer is for macOS and Linux. On Windows, download the installer from https://spcaeo.github.io/citefox/" ;;
esac

say "Finding the latest CiteFox release…"
release="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API")" || fail "Could not reach GitHub."
tag="$(printf '%s' "$release" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
url="$(printf '%s' "$release" | grep '"browser_download_url"' | sed -E 's/.*"(https:[^"]+)".*/\1/' | grep -E "$pattern" | head -1)"
sums_url="$(printf '%s' "$release" | grep '"browser_download_url"' | sed -E 's/.*"(https:[^"]+)".*/\1/' | grep -E 'SHA256SUMS\.txt$' | head -1)"
[ -n "$url" ] || fail "No download for this computer in release ${tag:-latest}."
file="${url##*/}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "Downloading ${file} (${tag})…"
curl -fL --progress-bar -o "$tmp/$file" "$url" || fail "Download failed."

if [ -n "$sums_url" ]; then
  say "Checking the file…"
  expected="$(curl -fsSL "$sums_url" | grep " ${file}\$" | awk '{print $1}')"
  if [ -n "$expected" ]; then
    if command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$tmp/$file" | awk '{print $1}')"
    else actual="$(sha256sum "$tmp/$file" | awk '{print $1}')"; fi
    [ "$expected" = "$actual" ] || fail "Checksum mismatch: the download is not the published file."
  fi
fi

if [ "$os" = "Darwin" ]; then
  dest="/Applications"
  [ -w "$dest" ] || dest="$HOME/Applications"
  mkdir -p "$dest"
  say "Installing to ${dest}…"
  ditto -x -k "$tmp/$file" "$tmp/app"
  rm -rf "$dest/CiteFox.app"
  mv "$tmp/app/CiteFox.app" "$dest/CiteFox.app"
  # Installed from the command line, so macOS does not ask before the first start.
  xattr -dr com.apple.quarantine "$dest/CiteFox.app" 2>/dev/null || true
  say "Done. Opening CiteFox…"
  open "$dest/CiteFox.app"
else
  dest="$HOME/Applications"
  mkdir -p "$dest"
  install -m 755 "$tmp/$file" "$dest/CiteFox.AppImage"
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$apps"
  cat >"$apps/citefox.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=CiteFox
Comment=Free AI visibility tracker
Exec=$dest/CiteFox.AppImage
Terminal=false
Categories=Office;Utility;
EOF
  say "Done. CiteFox is in your app menu, or run: $dest/CiteFox.AppImage"
fi
