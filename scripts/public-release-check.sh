#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE_DIR="$REPO_ROOT/codex-native"
REQUIRE_FULL_NATIVE_CHECKS="${TASKNERVE_REQUIRE_FULL_NATIVE_CHECKS:-0}"
NATIVE_PACKAGE_MANAGER=""
NATIVE_TYPECHECK_SCRIPT=""
NATIVE_TEST_SCRIPT=""
cd "$REPO_ROOT"

native_has_workspace_deps() {
  node - "$NATIVE_DIR/package.json" <<'NODE'
const fs = require("node:fs");
const pkgPath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const hasWorkspace = Object.values(deps).some(
  (value) => typeof value === "string" && value.startsWith("workspace:"),
);
process.exit(hasWorkspace ? 0 : 1);
NODE
}

native_workspace_deps_resolved() {
  node - "$NATIVE_DIR/package.json" "$REPO_ROOT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const pkgPath = process.argv[2];
const repoRoot = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const workspaceDeps = Object.entries(deps)
  .filter(([, value]) => typeof value === "string" && value.startsWith("workspace:"))
  .map(([name]) => name);

const missing = [];
for (const depName of workspaceDeps) {
  const candidatePaths = [
    path.join(repoRoot, depName, "package.json"),
    path.join(repoRoot, "packages", depName, "package.json"),
    path.join(repoRoot, "codex-native", depName, "package.json"),
    path.join(repoRoot, "..", depName, "package.json"),
    path.join(repoRoot, "..", "packages", depName, "package.json"),
  ];
  const found = candidatePaths.some((candidate) => {
    if (!fs.existsSync(candidate)) {
      return false;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return parsed && parsed.name === depName;
    } catch {
      return false;
    }
  });
  if (!found) {
    missing.push(depName);
  }
}

if (missing.length > 0) {
  console.error(`[release-check] unresolved workspace dependencies: ${missing.join(", ")}`);
  process.exit(1);
}
NODE
}

resolve_native_check_runtime() {
  eval "$(
    node - "$NATIVE_DIR/package.json" <<'NODE'
const fs = require("node:fs");
const pkgPath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const scripts = pkg.scripts || {};
const packageManagerRaw = String(pkg.packageManager || "").toLowerCase().trim();
const packageManager = packageManagerRaw.startsWith("pnpm")
  ? "pnpm"
  : packageManagerRaw.startsWith("npm")
    ? "npm"
    : "npm";
const typecheckScript = typeof scripts.typecheck === "string"
  ? "typecheck"
  : typeof scripts.tsc === "string"
    ? "tsc"
    : "";
const testScript = typeof scripts["test:quiet"] === "string"
  ? "test:quiet"
  : typeof scripts.test === "string"
    ? "test"
    : "";
process.stdout.write(`NATIVE_PACKAGE_MANAGER=${JSON.stringify(packageManager)}\n`);
process.stdout.write(`NATIVE_TYPECHECK_SCRIPT=${JSON.stringify(typecheckScript)}\n`);
process.stdout.write(`NATIVE_TEST_SCRIPT=${JSON.stringify(testScript)}\n`);
NODE
  )"
}

resolve_native_check_runtime

run_native_checks_full=1
declare -a native_check_skip_reasons=()

if [[ "$NATIVE_PACKAGE_MANAGER" == "pnpm" ]] && ! command -v pnpm >/dev/null 2>&1; then
  run_native_checks_full=0
  native_check_skip_reasons+=("pnpm is not installed")
fi

if native_has_workspace_deps && ! native_workspace_deps_resolved; then
  run_native_checks_full=0
  native_check_skip_reasons+=("workspace dependencies for codex-native are not available in this checkout")
fi

if [[ -z "$NATIVE_TYPECHECK_SCRIPT" ]]; then
  run_native_checks_full=0
  native_check_skip_reasons+=("codex-native package is missing a typecheck/tsc script")
fi

if [[ -z "$NATIVE_TEST_SCRIPT" ]]; then
  run_native_checks_full=0
  native_check_skip_reasons+=("codex-native package is missing a test script")
fi

if \
  node - "$NATIVE_DIR/package.json" <<'NODE'
const fs = require("node:fs");
const pkgPath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const scripts = pkg.scripts || {};
const values = Object.values(scripts)
  .filter((entry) => typeof entry === "string")
  .map((entry) => entry.toLowerCase());
const needsRebuildScript = values.some((entry) =>
  entry.includes("scripts/rebuild-sqlite.mjs") || entry.includes("rebuild:sqlite"),
);
process.exit(needsRebuildScript ? 0 : 1);
NODE
then
  if [[ ! -f "$NATIVE_DIR/scripts/rebuild-sqlite.mjs" ]]; then
    run_native_checks_full=0
    native_check_skip_reasons+=("codex-native/scripts/rebuild-sqlite.mjs is missing, but package scripts reference it")
  fi
fi

if \
  node - "$NATIVE_DIR/package.json" <<'NODE'
const fs = require("node:fs");
const pkgPath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const scripts = pkg.scripts || {};
const values = Object.values(scripts)
  .filter((entry) => typeof entry === "string")
  .map((entry) => entry.toLowerCase());
const needsEnsureElectron = values.some((entry) => entry.includes("scripts/ensure-electron-binary.mjs"));
process.exit(needsEnsureElectron ? 0 : 1);
NODE
then
  if [[ ! -f "$NATIVE_DIR/scripts/ensure-electron-binary.mjs" ]]; then
    run_native_checks_full=0
    native_check_skip_reasons+=("codex-native/scripts/ensure-electron-binary.mjs is missing, but package scripts reference it")
  fi
fi

if [[ "$NATIVE_PACKAGE_MANAGER" == "pnpm" ]] && ! command -v pnpm >/dev/null 2>&1; then
  run_native_checks_full=0
  native_check_skip_reasons+=("pnpm is required by codex-native/packageManager")
fi

if [[ "$run_native_checks_full" -eq 1 ]]; then
  echo "[release-check] native workspace install"
  cd "$NATIVE_DIR"
  if [[ "$NATIVE_PACKAGE_MANAGER" == "pnpm" ]]; then
    if [[ ! -d "$NATIVE_DIR/node_modules" || "${TASKNERVE_FORCE_NATIVE_INSTALL:-0}" == "1" ]]; then
      pnpm install --frozen-lockfile || pnpm install
    fi
    echo "[release-check] typecheck"
    pnpm run "$NATIVE_TYPECHECK_SCRIPT"
    echo "[release-check] tests"
    pnpm run "$NATIVE_TEST_SCRIPT"
  else
    if [[ ! -d "$NATIVE_DIR/node_modules" || "${TASKNERVE_FORCE_NATIVE_INSTALL:-0}" == "1" ]]; then
      npm install
    fi
    echo "[release-check] typecheck"
    npm run "$NATIVE_TYPECHECK_SCRIPT"
    echo "[release-check] tests"
    npm run "$NATIVE_TEST_SCRIPT"
  fi

  cd "$REPO_ROOT"
else
  if [[ "$REQUIRE_FULL_NATIVE_CHECKS" == "1" ]]; then
    printf '[release-check] cannot run full native checks:\n' >&2
    for reason in "${native_check_skip_reasons[@]}"; do
      printf '  - %s\n' "$reason" >&2
    done
    exit 1
  fi

  printf '[release-check] skipping full native checks in this checkout:\n'
  for reason in "${native_check_skip_reasons[@]}"; do
    printf '  - %s\n' "$reason"
  done

  echo "[release-check] native integration smoke"
  test -f "$NATIVE_DIR/src/integration/taskNerveService.ts"
  test -f "$NATIVE_DIR/src/integration/codexTaskNerveHostRuntime.ts"
  node - "$NATIVE_DIR/package.json" <<'NODE'
const fs = require("node:fs");
const pkgPath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const scripts = pkg.scripts || {};
const hasTypecheck = typeof scripts.typecheck === "string" || typeof scripts.tsc === "string";
const hasTest = typeof scripts["test:quiet"] === "string" || typeof scripts.test === "string";
if (!hasTypecheck || !hasTest) {
  throw new Error("Missing required codex-native scripts: need typecheck/tsc and test/test:quiet");
}
NODE
fi

echo "[release-check] no patch/injection runtime artifacts"
test ! -f "$REPO_ROOT/codex-native/scripts/sync-codex-tasknerve.mjs"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_MAIN_BRIDGE.js"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_PANEL.js"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_MAIN_BRIDGE_RUNTIME.cjs"
test ! -f "$REPO_ROOT/templates/TASKNERVE_CODEX_PANEL_RUNTIME.js"
test ! -f "$REPO_ROOT/index-CMu6BCpo.js"
test ! -f "$REPO_ROOT/skills-page-DeBxXSaK.js"
test ! -f "$REPO_ROOT/codex-native/main.js"
test ! -f "$REPO_ROOT/codex-native/index.html"
test ! -f "$REPO_ROOT/codex-native/index-CMu6BCpo.js"
test ! -f "$REPO_ROOT/codex-native/tasknerve-settings-native.js"

if git -C "$REPO_ROOT" ls-files | rg -q '^codex-native/node_modules/'; then
  echo "Tracked dependency output found under codex-native/node_modules." >&2
  exit 1
fi

if git -C "$REPO_ROOT" ls-files | rg -q '^codex-native/dist/'; then
  echo "Tracked compiled output found under codex-native/dist." >&2
  exit 1
fi

if git -C "$REPO_ROOT" ls-files | rg -q '\.DS_Store$'; then
  echo "Tracked .DS_Store artifacts detected." >&2
  exit 1
fi

if rg -n --glob '!**/node_modules/**' \
  "sync-codex-tasknerve\\.mjs|allow-legacy-patching|legacy:sync:app|TASKNERVE_CODEX_MAIN_BRIDGE|TASKNERVE_CODEX_PANEL|runtime patch deploy|patched runtime JS" \
  "$REPO_ROOT/README.md" \
  "$REPO_ROOT/CONTRIBUTING.md" \
  "$REPO_ROOT/project_goals.md" \
  "$REPO_ROOT/project_manifest.md" \
  "$REPO_ROOT/docs" \
  "$REPO_ROOT/codex-native/README.md" \
  "$REPO_ROOT/codex-native/package.json" \
  "$REPO_ROOT/skills/tasknerve"; then
  echo "Found disallowed patch/injection references in active files." >&2
  exit 1
fi

echo "[release-check] shell syntax"
bash -n "$REPO_ROOT/install-macos.sh"
bash -n "$REPO_ROOT/scripts/install-unix.sh"
bash -n "$REPO_ROOT/scripts/auto-install-dev.sh"
bash -n "$REPO_ROOT/scripts/build-codex-tasknerve-app.sh"
bash -n "$REPO_ROOT/scripts/install-dev-hooks.sh"
bash -n "$REPO_ROOT/scripts/install_codex_skill.sh"
bash -n "$REPO_ROOT/scripts/install-tasknerve-update-daemon.sh"
bash -n "$REPO_ROOT/scripts/uninstall-tasknerve-update-daemon.sh"
bash -n "$REPO_ROOT/scripts/tasknerve-update-daemon-status.sh"

python3 -m py_compile "$REPO_ROOT/scripts/codex-update-interceptor.py"
python3 -m py_compile "$REPO_ROOT/scripts/tasknerve-approve-phase2-update.py"

if rg -n "persistent\\.oaistatic\\.com/codex-app-prod/appcast\\.xml" "$REPO_ROOT/codex-native/package.json"; then
  echo "codex-native package is still pointing at upstream Codex appcast feed." >&2
  exit 1
fi

echo "[release-check] skill install smoke"
TMP_CODEX_HOME="$(mktemp -d /tmp/tasknerve-codex-home-XXXXXX)"
CODEX_HOME="$TMP_CODEX_HOME" bash "$REPO_ROOT/scripts/install_codex_skill.sh" >/dev/null
test -f "$TMP_CODEX_HOME/skills/tasknerve/SKILL.md"

echo "[release-check] complete"
