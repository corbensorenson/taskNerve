#!/usr/bin/env bash
set -euo pipefail

PLIST_ID="${TASKNERVE_UPDATE_DAEMON_ID:-com.tasknerve.update-interceptor}"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_ID.plist"

launchctl bootout "gui/$(id -u)/$PLIST_ID" >/dev/null 2>&1 || true
launchctl disable "gui/$(id -u)/$PLIST_ID" >/dev/null 2>&1 || true

if [[ -f "$PLIST_PATH" ]]; then
  rm -f "$PLIST_PATH"
fi

echo "Uninstalled TaskNerve update daemon: $PLIST_ID"
