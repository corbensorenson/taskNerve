#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Backward-compatible entrypoint; delegates to root installer.
exec bash "$REPO_ROOT/install.sh" "$@"
