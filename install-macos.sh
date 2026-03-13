#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat <<MSG
Running deterministic TaskNerve source->app->dmg deploy...
MSG

bash "$REPO_ROOT/scripts/deploy-tasknerve-from-source.sh" "$@"
