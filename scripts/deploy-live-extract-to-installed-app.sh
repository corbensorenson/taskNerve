#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cat <<'MSG' >&2
[DEPRECATED] scripts/deploy-live-extract-to-installed-app.sh
This legacy direct-extract entrypoint has been deprecated.
Use source-first deterministic deploy instead:
  bash /Users/adimus/Documents/taskNerve/scripts/deploy-tasknerve-from-source.sh
Low-level replacement (if absolutely needed):
  bash /Users/adimus/Documents/taskNerve/scripts/deploy-installed-app-from-canonical-build.sh
Historical legacy script moved to:
  /Users/adimus/Documents/taskNerve/deprecated/legacy-scripts/deploy-live-extract-to-installed-app.sh
MSG

exec bash "$REPO_ROOT/scripts/deploy-installed-app-from-canonical-build.sh" "$@"
