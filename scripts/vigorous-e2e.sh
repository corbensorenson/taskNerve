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

echo "[vigorous-e2e] template syntax"
node --check "$REPO_ROOT/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js" >/dev/null
node --check "$REPO_ROOT/templates/TASKNERVE_CODEX_PANEL.js" >/dev/null

echo "[vigorous-e2e] native bridge health"
if curl -sf "http://127.0.0.1:7791/tasknerve/health" >/dev/null; then
  echo "[vigorous-e2e] native bridge healthy"
else
  echo "[vigorous-e2e] warning: native bridge is not currently serving on 127.0.0.1:7791" >&2
fi

echo "[vigorous-e2e] complete"
