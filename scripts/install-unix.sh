#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
tasknerve native installer

Usage:
  bash scripts/install-unix.sh

Notes:
  - On macOS: runs deterministic source->app->dmg deploy.
  - On non-macOS Unix: builds Codex TaskNerve integration bundle only.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)" == "Darwin" ]]; then
  bash "$REPO_ROOT/scripts/deploy-tasknerve-from-source.sh"
else
  bash "$REPO_ROOT/scripts/build-codex-tasknerve-app.sh"
fi
