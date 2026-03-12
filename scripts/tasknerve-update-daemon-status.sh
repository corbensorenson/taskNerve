#!/usr/bin/env bash
set -euo pipefail

PLIST_ID="${TASKNERVE_UPDATE_DAEMON_ID:-com.tasknerve.update-interceptor}"
launchctl print "gui/$(id -u)/$PLIST_ID"
