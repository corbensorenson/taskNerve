#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[release-check] native workspace install"
cd "$REPO_ROOT/codex-native"
npm install

echo "[release-check] typecheck"
npm run typecheck

echo "[release-check] tests"
npm test

cd "$REPO_ROOT"

echo "[release-check] template syntax"
node --check "$REPO_ROOT/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js"
node --check "$REPO_ROOT/templates/TASKNERVE_CODEX_PANEL.js"

echo "[release-check] shell syntax"
bash -n "$REPO_ROOT/install-macos.sh"
bash -n "$REPO_ROOT/scripts/install-unix.sh"
bash -n "$REPO_ROOT/scripts/auto-install-dev.sh"
bash -n "$REPO_ROOT/scripts/install-dev-hooks.sh"
bash -n "$REPO_ROOT/scripts/install_codex_skill.sh"

echo "[release-check] skill install smoke"
TMP_CODEX_HOME="$(mktemp -d /tmp/tasknerve-codex-home-XXXXXX)"
CODEX_HOME="$TMP_CODEX_HOME" bash "$REPO_ROOT/scripts/install_codex_skill.sh" >/dev/null
test -f "$TMP_CODEX_HOME/skills/tasknerve/SKILL.md"

echo "[release-check] complete"
