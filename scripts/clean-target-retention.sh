#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$REPO_ROOT/target"

DRY_RUN=0
KEEP_TMP_DEPLOY=2
KEEP_TMP_VERIFY=1
KEEP_GENERIC_TMP=0
KEEP_RECOVER_EXTRACT=1
KEEP_INSTALL_BACKUPS=3
KEEP_BUILD_OUTPUTS=5
KEEP_ROOT_ASAR=1
KEEP_APP_ASAR_BACKUPS=2
KEEP_PLIST_BACKUPS=2
KEEP_INSTALLER_DMGS=2
DROP_DEBUG_RELEASE=0

usage() {
  cat <<'USAGE'
Usage: clean-target-retention.sh [options]

Deterministically prunes heavyweight target artifacts while keeping a small
recent history by lexicographic timestamp ordering.

Options:
  --dry-run                    Show what would be deleted without deleting.
  --keep-tmp-deploy N          Keep newest N target/tmp-deploy-* dirs (default: 2).
  --keep-tmp-verify N          Keep newest N target/tmp-verify-* dirs (default: 1).
  --keep-generic-tmp N         Keep newest N remaining target/tmp-* dirs (default: 0).
  --keep-recover-extract N     Keep newest N target/recover-extract-current-* dirs (default: 1).
  --keep-install-backups N     Keep newest N target/install-backups/* dirs (default: 5).
  --keep-build-outputs N       Keep newest N target/codex-tasknerve-app-build/* dirs (default: 5).
  --keep-root-asar N           Keep newest N target/codex-tasknerve-app-*.asar files (default: 1).
  --keep-app-backups N         Keep newest N target/app.asar.backup.* files (default: 2).
  --keep-plist-backups N       Keep newest N target/Info.plist.backup.* files (default: 2).
  --keep-installer-dmgs N      Keep newest N timestamped target/installers/*.dmg (default: 2).
  --drop-debug-release         Remove target/debug and target/release directories.
  -h, --help                   Show this help.
USAGE
}

require_int() {
  local value="$1"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "Expected non-negative integer, got: $value" >&2
    exit 1
  fi
}

while (($# > 0)); do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --keep-tmp-deploy)
      require_int "${2:-}"
      KEEP_TMP_DEPLOY="$2"
      shift 2
      ;;
    --keep-tmp-verify)
      require_int "${2:-}"
      KEEP_TMP_VERIFY="$2"
      shift 2
      ;;
    --keep-generic-tmp)
      require_int "${2:-}"
      KEEP_GENERIC_TMP="$2"
      shift 2
      ;;
    --keep-recover-extract)
      require_int "${2:-}"
      KEEP_RECOVER_EXTRACT="$2"
      shift 2
      ;;
    --keep-install-backups)
      require_int "${2:-}"
      KEEP_INSTALL_BACKUPS="$2"
      shift 2
      ;;
    --keep-build-outputs)
      require_int "${2:-}"
      KEEP_BUILD_OUTPUTS="$2"
      shift 2
      ;;
    --keep-root-asar)
      require_int "${2:-}"
      KEEP_ROOT_ASAR="$2"
      shift 2
      ;;
    --keep-app-backups)
      require_int "${2:-}"
      KEEP_APP_ASAR_BACKUPS="$2"
      shift 2
      ;;
    --keep-plist-backups)
      require_int "${2:-}"
      KEEP_PLIST_BACKUPS="$2"
      shift 2
      ;;
    --keep-installer-dmgs)
      require_int "${2:-}"
      KEEP_INSTALLER_DMGS="$2"
      shift 2
      ;;
    --drop-debug-release)
      DROP_DEBUG_RELEASE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "No target directory at: $TARGET_DIR"
  exit 0
fi

echo "[target-clean] repo: $REPO_ROOT"
echo "[target-clean] target: $TARGET_DIR"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[target-clean] mode: dry-run"
fi

delete_path() {
  local path="$1"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[target-clean] would delete: $path"
    return
  fi
  rm -rf -- "$path"
  echo "[target-clean] deleted: $path"
}

prune_dirs_in_root() {
  local pattern="$1"
  local keep="$2"
  local label="$3"
  local list_file
  list_file="$(mktemp)"
  find "$TARGET_DIR" -maxdepth 1 -mindepth 1 -type d -name "$pattern" -print | LC_ALL=C sort >"$list_file"
  local total
  total="$(grep -c . "$list_file" || true)"
  local remove_count=$((total - keep))
  if ((remove_count <= 0)); then
    echo "[target-clean] keep ($label): total=$total keep=$keep"
    rm -f "$list_file"
    return
  fi
  echo "[target-clean] prune ($label): total=$total keep=$keep remove=$remove_count"
  local index=0
  while IFS= read -r path; do
    if ((index >= remove_count)); then
      break
    fi
    delete_path "$path"
    index=$((index + 1))
  done <"$list_file"
  rm -f "$list_file"
}

prune_child_dirs() {
  local parent="$1"
  local keep="$2"
  local label="$3"
  if [[ ! -d "$parent" ]]; then
    echo "[target-clean] skip ($label): missing $parent"
    return
  fi
  local list_file
  list_file="$(mktemp)"
  find "$parent" -maxdepth 1 -mindepth 1 -type d -print | LC_ALL=C sort >"$list_file"
  local total
  total="$(grep -c . "$list_file" || true)"
  local remove_count=$((total - keep))
  if ((remove_count <= 0)); then
    echo "[target-clean] keep ($label): total=$total keep=$keep"
    rm -f "$list_file"
    return
  fi
  echo "[target-clean] prune ($label): total=$total keep=$keep remove=$remove_count"
  local index=0
  while IFS= read -r path; do
    if ((index >= remove_count)); then
      break
    fi
    delete_path "$path"
    index=$((index + 1))
  done <"$list_file"
  rm -f "$list_file"
}

prune_root_asar_files() {
  local keep="$1"
  local list_file
  list_file="$(mktemp)"
  find "$TARGET_DIR" -maxdepth 1 -type f -name "codex-tasknerve-app-*.asar" -print | LC_ALL=C sort >"$list_file"
  local total
  total="$(grep -c . "$list_file" || true)"
  local remove_count=$((total - keep))
  if ((remove_count <= 0)); then
    echo "[target-clean] keep (root-asar): total=$total keep=$keep"
    rm -f "$list_file"
    return
  fi
  echo "[target-clean] prune (root-asar): total=$total keep=$keep remove=$remove_count"
  local index=0
  while IFS= read -r path; do
    if ((index >= remove_count)); then
      break
    fi
    delete_path "$path"
    index=$((index + 1))
  done <"$list_file"
  rm -f "$list_file"
}

prune_root_files_by_pattern() {
  local pattern="$1"
  local keep="$2"
  local label="$3"
  local list_file
  list_file="$(mktemp)"
  find "$TARGET_DIR" -maxdepth 1 -type f -name "$pattern" -print | LC_ALL=C sort >"$list_file"
  local total
  total="$(grep -c . "$list_file" || true)"
  local remove_count=$((total - keep))
  if ((remove_count <= 0)); then
    echo "[target-clean] keep ($label): total=$total keep=$keep"
    rm -f "$list_file"
    return
  fi
  echo "[target-clean] prune ($label): total=$total keep=$keep remove=$remove_count"
  local index=0
  while IFS= read -r path; do
    if ((index >= remove_count)); then
      break
    fi
    delete_path "$path"
    index=$((index + 1))
  done <"$list_file"
  rm -f "$list_file"
}

prune_installer_dmgs() {
  local keep="$1"
  local installers_dir="$TARGET_DIR/installers"
  if [[ ! -d "$installers_dir" ]]; then
    echo "[target-clean] skip (installer-dmgs): missing $installers_dir"
    return
  fi
  local list_file
  list_file="$(mktemp)"
  find "$installers_dir" -maxdepth 1 -type f -name "Codex-TaskNerve-[0-9]*.dmg" -print | LC_ALL=C sort >"$list_file"
  local total
  total="$(grep -c . "$list_file" || true)"
  local remove_count=$((total - keep))
  if ((remove_count <= 0)); then
    echo "[target-clean] keep (installer-dmgs): total=$total keep=$keep"
    rm -f "$list_file"
    return
  fi
  echo "[target-clean] prune (installer-dmgs): total=$total keep=$keep remove=$remove_count"
  local index=0
  while IFS= read -r dmg; do
    if ((index >= remove_count)); then
      break
    fi
    delete_path "$dmg"
    delete_path "${dmg}.sha256"
    index=$((index + 1))
  done <"$list_file"
  rm -f "$list_file"
}

before_kb="$(du -sk "$TARGET_DIR" | awk '{print $1}')"

prune_dirs_in_root "tmp-deploy-*" "$KEEP_TMP_DEPLOY" "tmp-deploy"
prune_dirs_in_root "tmp-verify-*" "$KEEP_TMP_VERIFY" "tmp-verify"
prune_dirs_in_root "tmp-*" "$KEEP_GENERIC_TMP" "generic-tmp"
prune_dirs_in_root "recover-extract-current-*" "$KEEP_RECOVER_EXTRACT" "recover-extract"
prune_root_asar_files "$KEEP_ROOT_ASAR"
prune_root_files_by_pattern "app.asar.backup.*" "$KEEP_APP_ASAR_BACKUPS" "app-backups"
prune_root_files_by_pattern "Info.plist.backup.*" "$KEEP_PLIST_BACKUPS" "plist-backups"
prune_child_dirs "$TARGET_DIR/install-backups" "$KEEP_INSTALL_BACKUPS" "install-backups"
prune_child_dirs "$TARGET_DIR/codex-tasknerve-app-build" "$KEEP_BUILD_OUTPUTS" "build-outputs"
prune_installer_dmgs "$KEEP_INSTALLER_DMGS"

if [[ "$DROP_DEBUG_RELEASE" == "1" ]]; then
  if [[ -d "$TARGET_DIR/debug" ]]; then
    delete_path "$TARGET_DIR/debug"
  fi
  if [[ -d "$TARGET_DIR/release" ]]; then
    delete_path "$TARGET_DIR/release"
  fi
fi

if [[ "$DRY_RUN" != "1" ]]; then
  find "$TARGET_DIR" -name ".DS_Store" -delete
fi

after_kb="$(du -sk "$TARGET_DIR" | awk '{print $1}')"
freed_kb=$((before_kb - after_kb))
if ((freed_kb < 0)); then
  freed_kb=0
fi

echo "[target-clean] size before: ${before_kb} KB"
echo "[target-clean] size after:  ${after_kb} KB"
echo "[target-clean] freed:       ${freed_kb} KB"
