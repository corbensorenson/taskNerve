#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_DIR="$REPO_ROOT/target/codex-tasknerve-app-live-extract"
ALIAS_DIR="$REPO_ROOT/target/codex-tasknerve-app-src"
ALIAS_TARGET="codex-tasknerve-app-live-extract"

if [ ! -d "$LIVE_DIR" ]; then
  echo "Missing live extract directory: $LIVE_DIR" >&2
  echo "Extract/build the runtime bundle first, then rerun this script." >&2
  exit 1
fi

if [ -L "$ALIAS_DIR" ]; then
  CURRENT_TARGET="$(readlink "$ALIAS_DIR" || true)"
  if [ "$CURRENT_TARGET" = "$ALIAS_TARGET" ]; then
    echo "Single runtime extract already enforced: $ALIAS_DIR -> $ALIAS_TARGET"
    exit 0
  fi
  rm -f "$ALIAS_DIR"
elif [ -e "$ALIAS_DIR" ]; then
  rm -rf "$ALIAS_DIR"
fi

ln -s "$ALIAS_TARGET" "$ALIAS_DIR"
echo "Single runtime extract enforced: $ALIAS_DIR -> $ALIAS_TARGET"
