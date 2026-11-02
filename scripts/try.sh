#!/bin/sh
# Opens CiteFox straight from the source for quick test-and-fix rounds.
# Run from the citefox folder: sh scripts/try.sh
# - Screen changes show in the open window within seconds; main-process
#   changes restart the window by themselves (electron-vite dev --watch).
# - Uses its own data folder, "CiteFox Dev", so the installed app's projects
#   and settings are never touched. Keys you add here are new keychain items.
#   Set CITEFOX_USER_DATA to another folder to run a second copy beside it
#   (also set CITEFOX_TRY_DEBUG_PORT, since two copies cannot share a port).
# - The build menu's Reset and Test as a new user do the real thing here
#   (CITEFOX_E2E_APP_TOOLS=real). Reset exits with code 75 and this script
#   starts the window again, because electron-vite dev stops with Electron.
# - Opens a local Chromium debug port (127.0.0.1:9333, override with
#   CITEFOX_TRY_DEBUG_PORT) so a helper can screenshot and inspect the window
#   without taking over the mouse. Only programs on this computer can reach it.
# - Switches to the Node version in .nvmrc with nvm, or with mise when nvm is
#   missing (Linux).
# - Data folder: ~/Library/Application Support/CiteFox Dev on a Mac,
#   ~/.config/CiteFox Dev elsewhere.
set -e
cd "$(dirname "$0")/.."

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null || nvm install
fi

RUN=""
if ! command -v nvm >/dev/null 2>&1 && command -v mise >/dev/null 2>&1 && [ -s .nvmrc ]; then
  RUN="mise exec node@$(cat .nvmrc) --"
fi

if [ ! -d node_modules ]; then
  $RUN npm ci
fi

if [ "$(uname)" = "Darwin" ]; then
  DEFAULT_DATA="$HOME/Library/Application Support/CiteFox Dev"
else
  DEFAULT_DATA="${XDG_CONFIG_HOME:-$HOME/.config}/CiteFox Dev"
fi

export CITEFOX_E2E_APP_TOOLS=real
export CITEFOX_DEV_RESTART_EXIT_CODE=75
while :; do
  status=0
  $RUN npx electron-vite dev --watch --remoteDebuggingPort "${CITEFOX_TRY_DEBUG_PORT:-9333}" -- "--user-data-dir=${CITEFOX_USER_DATA:-$DEFAULT_DATA}" || status=$?
  [ "$status" -eq 75 ] || exit "$status"
  echo "[try] restarting CiteFox after a reset"
done
