#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat <<MSG
Building Codex TaskNerve integration bundle (no patching/injection)...
MSG

bash "$REPO_ROOT/scripts/build-codex-tasknerve-app.sh"
