#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$REPO_ROOT/scripts/install-unix.sh" --platform macos "$@"
