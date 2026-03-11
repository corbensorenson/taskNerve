#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
tasknerve native installer

Usage:
  bash scripts/install-unix.sh

Notes:
  - Builds a Codex TaskNerve integration bundle for A/B testing.
  - App-bundle patching/injection is not supported.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$REPO_ROOT/scripts/build-codex-tasknerve-app.sh"
