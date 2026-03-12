#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_ID="${TASKNERVE_UPDATE_DAEMON_ID:-com.tasknerve.update-interceptor}"
INTERVAL_SECONDS="${TASKNERVE_UPDATE_INTERVAL_SECONDS:-900}"
PYTHON_BIN="${TASKNERVE_UPDATE_PYTHON_BIN:-$(command -v python3 || true)}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$PLIST_ID.plist"
LOG_DIR="$HOME/Library/Logs"
OUT_LOG="$LOG_DIR/tasknerve-update-interceptor.log"
ERR_LOG="$LOG_DIR/tasknerve-update-interceptor.err.log"
ISSUE_REPO="${TASKNERVE_UPDATE_ISSUE_REPO:-adimus/taskNerve}"
DAEMON_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -z "$PYTHON_BIN" ]]; then
  echo "python3 not found in PATH" >&2
  exit 1
fi

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_ID</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON_BIN</string>
    <string>$REPO_ROOT/scripts/codex-update-interceptor.py</string>
    <string>--repo-root</string>
    <string>$REPO_ROOT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$DAEMON_PATH</string>
    <key>TASKNERVE_UPDATE_ISSUE_REPO</key>
    <string>$ISSUE_REPO</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>$INTERVAL_SECONDS</integer>
  <key>StandardOutPath</key>
  <string>$OUT_LOG</string>
  <key>StandardErrorPath</key>
  <string>$ERR_LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$PLIST_ID" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/$PLIST_ID" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$(id -u)/$PLIST_ID" >/dev/null 2>&1 || true

echo "Installed TaskNerve update daemon:"
echo "  id: $PLIST_ID"
echo "  plist: $PLIST_PATH"
echo "  interval seconds: $INTERVAL_SECONDS"
echo "  issue repo: $ISSUE_REPO"
echo "  stdout log: $OUT_LOG"
echo "  stderr log: $ERR_LOG"
