#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BUILD_ROOT="$REPO_ROOT/target/codex-tasknerve-app-build/$TIMESTAMP"
INTEGRATION_OUT="$BUILD_ROOT/integration"
SKILL_OUT="$BUILD_ROOT/skill"

mkdir -p "$INTEGRATION_OUT" "$SKILL_OUT"

cd "$REPO_ROOT/codex-native"
npm install
npm run build
npm test

PACK_FILE="$(npm pack --silent | tail -n 1)"

cp -R dist "$INTEGRATION_OUT/dist"
cp package.json package-lock.json README.md tsconfig.build.json "$INTEGRATION_OUT/"
cp "$PACK_FILE" "$INTEGRATION_OUT/"
rm -f "$PACK_FILE"
rm -rf dist

cp -R "$REPO_ROOT/skills/tasknerve" "$SKILL_OUT/tasknerve"

GIT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
cat > "$BUILD_ROOT/build-manifest.json" <<MANIFEST
{
  "build_timestamp_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_commit": "$GIT_COMMIT",
  "build_type": "codex-native-integration-bundle",
  "no_patching": true,
  "integration_entrypoints": [
    "codex-native/src/integration/taskNerveService.ts",
    "codex-native/src/integration/codexTaskNerveHostRuntime.ts"
  ],
  "artifact_paths": {
    "integration": "$INTEGRATION_OUT",
    "skill": "$SKILL_OUT/tasknerve"
  }
}
MANIFEST

printf '%s\n' "$BUILD_ROOT"
