#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
SRC_SKILL_DIR="$REPO_ROOT/skills/tasknerve"
DST_SKILL_DIR="$CODEX_HOME_DIR/skills/tasknerve"
BIN_PATH="${TASKNERVE_BIN_PATH:-${TASKNERVE_INSTALL_DIR:-$HOME/.local/bin}/tasknerve}"
OVERWRITE="${OVERWRITE:-1}"

if [[ ! -d "$SRC_SKILL_DIR" ]]; then
  echo "missing source skill directory: $SRC_SKILL_DIR" >&2
  exit 1
fi

if [[ -x "$BIN_PATH" ]]; then
  ARGS=(skill install-codex)
  if [[ "$OVERWRITE" == "1" ]]; then
    ARGS+=(--overwrite)
  fi
  "$BIN_PATH" "${ARGS[@]}"
  echo "Installed tasknerve Codex skill via binary: $BIN_PATH"
  exit 0
fi

mkdir -p "$CODEX_HOME_DIR/skills"
if [[ "$OVERWRITE" == "1" ]]; then
  rm -rf "$DST_SKILL_DIR"
fi
cp -R "$SRC_SKILL_DIR" "$DST_SKILL_DIR"

echo "Installed tasknerve Codex skill to: $DST_SKILL_DIR"
