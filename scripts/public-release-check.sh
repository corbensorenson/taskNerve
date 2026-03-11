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

echo "[release-check] no patch/injection runtime artifacts"
test ! -f "$REPO_ROOT/codex-native/scripts/sync-codex-tasknerve.mjs"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_PANEL.js"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_MAIN_BRIDGE_RUNTIME.cjs"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_PANEL_RUNTIME.js"

if rg -n --glob '!deprecated/**' --glob '!**/node_modules/**' \
  "sync-codex-tasknerve\\.mjs|allow-legacy-patching|legacy:sync:app|TASKNERVE_CODEX_MAIN_BRIDGE|TASKNERVE_CODEX_PANEL" \
  "$REPO_ROOT/README.md" \
  "$REPO_ROOT/CONTRIBUTING.md" \
  "$REPO_ROOT/project_goals.md" \
  "$REPO_ROOT/project_manifest.md" \
  "$REPO_ROOT/docs" \
  "$REPO_ROOT/codex-native/README.md" \
  "$REPO_ROOT/codex-native/package.json" \
  "$REPO_ROOT/skills/tasknerve"; then
  echo "Found disallowed patch/injection references in active files." >&2
  exit 1
fi

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
