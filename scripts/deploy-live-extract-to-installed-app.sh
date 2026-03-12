#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_EXTRACT_DIR="${TASKNERVE_LIVE_EXTRACT_DIR:-$REPO_ROOT/target/codex-tasknerve-app-live-extract}"
APP_PATH="${1:-${TASKNERVE_APP_PATH:-/Applications/Codex TaskNerve.app}}"

RESOURCES_DIR="$APP_PATH/Contents/Resources"
ASAR_PATH="$RESOURCES_DIR/app.asar"
PLIST_PATH="$APP_PATH/Contents/Info.plist"
ASAR_BIN="$REPO_ROOT/codex-native/node_modules/@electron/asar/bin/asar.mjs"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="$REPO_ROOT/target/install-backups/$TIMESTAMP"
TMP_DIR="$REPO_ROOT/target/tmp-deploy-$TIMESTAMP"
TMP_ASAR="$TMP_DIR/app.asar"

if [[ ! -d "$LIVE_EXTRACT_DIR" ]]; then
  echo "missing live extract: $LIVE_EXTRACT_DIR" >&2
  echo "expected canonical extract at target/codex-tasknerve-app-live-extract" >&2
  exit 1
fi

if [[ ! -f "$ASAR_BIN" ]]; then
  echo "missing @electron/asar at: $ASAR_BIN" >&2
  echo "run: cd $REPO_ROOT/codex-native && npm install" >&2
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "app not found: $APP_PATH" >&2
  exit 1
fi

if [[ ! -f "$ASAR_PATH" ]]; then
  echo "missing app.asar: $ASAR_PATH" >&2
  exit 1
fi

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "missing Info.plist: $PLIST_PATH" >&2
  exit 1
fi

if [[ ! -x "/usr/libexec/PlistBuddy" ]]; then
  echo "PlistBuddy is required at /usr/libexec/PlistBuddy" >&2
  exit 1
fi

if ! command -v codesign >/dev/null 2>&1; then
  echo "codesign is required to re-sign the app bundle" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR" "$TMP_DIR"

cp "$ASAR_PATH" "$BACKUP_DIR/app.asar.backup"
cp "$PLIST_PATH" "$BACKUP_DIR/Info.plist.backup"

node "$ASAR_BIN" pack "$LIVE_EXTRACT_DIR" "$TMP_ASAR"

ASAR_HEADER_HASH="$(
  node - "$TMP_ASAR" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");

const asarPath = process.argv[2];
const file = fs.readFileSync(asarPath);
if (file.length < 16) {
  throw new Error("asar is too short");
}
const headerLength = file.readUInt32LE(12);
const headerStart = 16;
const headerEnd = headerStart + headerLength;
if (headerEnd > file.length) {
  throw new Error("asar header length is out of bounds");
}
const header = file.subarray(headerStart, headerEnd);
process.stdout.write(crypto.createHash("sha256").update(header).digest("hex"));
NODE
)"

if pgrep -f "Codex TaskNerve.app/Contents/MacOS" >/dev/null 2>&1; then
  osascript -e 'tell application "Codex TaskNerve" to quit' >/dev/null 2>&1 || true
  sleep 1
fi

cp "$TMP_ASAR" "$ASAR_PATH"

/usr/libexec/PlistBuddy -c "Add :ElectronAsarIntegrity dict" "$PLIST_PATH" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :ElectronAsarIntegrity:Resources/app.asar dict" "$PLIST_PATH" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:Resources/app.asar:algorithm SHA256" "$PLIST_PATH" >/dev/null 2>&1 \
  || /usr/libexec/PlistBuddy -c "Add :ElectronAsarIntegrity:Resources/app.asar:algorithm string SHA256" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:Resources/app.asar:hash $ASAR_HEADER_HASH" "$PLIST_PATH" >/dev/null 2>&1 \
  || /usr/libexec/PlistBuddy -c "Add :ElectronAsarIntegrity:Resources/app.asar:hash string $ASAR_HEADER_HASH" "$PLIST_PATH"

codesign --force --deep --sign - "$APP_PATH"
codesign --verify --deep "$APP_PATH"

VERIFY_DIR="$BACKUP_DIR/verify-installed"
mkdir -p "$VERIFY_DIR"
MAIN_VERIFY_FILE="$VERIFY_DIR/main.js"
INDEX_VERIFY_FILE=""

pushd "$VERIFY_DIR" >/dev/null
node "$ASAR_BIN" extract-file "$ASAR_PATH" ".vite/build/main.js"
INDEX_JS_PATH="$(
  node "$ASAR_BIN" list "$ASAR_PATH" \
    | awk '/^\/webview\/assets\/index-.*\.js$/ { print substr($0, 2); exit }'
)"
if [[ -n "$INDEX_JS_PATH" ]]; then
  node "$ASAR_BIN" extract-file "$ASAR_PATH" "$INDEX_JS_PATH"
  INDEX_VERIFY_FILE="$VERIFY_DIR/$(basename "$INDEX_JS_PATH")"
fi
popd >/dev/null

ASAR_SHA256="$(shasum -a 256 "$ASAR_PATH" | awk '{print $1}')"

echo "deployed live extract to installed app"
echo "app: $APP_PATH"
echo "asar sha256: $ASAR_SHA256"
echo "asar header hash: $ASAR_HEADER_HASH"
echo "backup dir: $BACKUP_DIR"
echo "verify files:"
echo "  $MAIN_VERIFY_FILE"
if [[ -n "$INDEX_VERIFY_FILE" ]]; then
  echo "  $INDEX_VERIFY_FILE"
fi
