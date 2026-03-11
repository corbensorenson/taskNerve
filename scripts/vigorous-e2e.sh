#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[vigorous-e2e] native workspace install"
cd "$REPO_ROOT/codex-native"
npm install >/dev/null

echo "[vigorous-e2e] typecheck"
npm run typecheck >/dev/null

echo "[vigorous-e2e] tests"
npm test >/dev/null

cd "$REPO_ROOT"

echo "[vigorous-e2e] no patch/injection runtime artifacts"
test ! -f "$REPO_ROOT/codex-native/scripts/sync-codex-tasknerve.mjs"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_PANEL.js"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_MAIN_BRIDGE_RUNTIME.cjs"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_PANEL_RUNTIME.js"

echo "[vigorous-e2e] complete"
