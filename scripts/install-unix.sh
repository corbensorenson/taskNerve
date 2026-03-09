#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
fugit-alpha unix installer

Usage:
  bash scripts/install-unix.sh [options]

Options:
  --platform <linux|macos>   Target platform check (auto-detected if omitted)
  --install-dir <path>       Install directory (default: \$FUGIT_INSTALL_DIR or \$HOME/.local/bin)
  --with-skill               Install bundled Codex skill after binary install
  --overwrite-skill          Overwrite existing Codex skill files when used with --with-skill
  --skip-rust-install        Fail instead of auto-installing Rust toolchain when cargo is missing
  -h, --help                 Show this help
USAGE
}

PLATFORM=""
INSTALL_DIR="${FUGIT_INSTALL_DIR:-$HOME/.local/bin}"
WITH_SKILL=0
OVERWRITE_SKILL=0
SKIP_RUST_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --with-skill)
      WITH_SKILL=1
      shift
      ;;
    --overwrite-skill)
      OVERWRITE_SKILL=1
      shift
      ;;
    --skip-rust-install)
      SKIP_RUST_INSTALL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PLATFORM" ]]; then
  case "$(uname -s)" in
    Darwin) PLATFORM="macos" ;;
    Linux) PLATFORM="linux" ;;
    *)
      echo "Unsupported Unix platform: $(uname -s)" >&2
      exit 1
      ;;
  esac
fi

case "$PLATFORM" in
  linux)
    if [[ "$(uname -s)" != "Linux" ]]; then
      echo "This installer is for Linux. Use the correct platform installer." >&2
      exit 1
    fi
    ;;
  macos)
    if [[ "$(uname -s)" != "Darwin" ]]; then
      echo "This installer is for macOS. Use the correct platform installer." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported platform value: $PLATFORM" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_NAME="fugit"

ensure_cargo() {
  if command -v cargo >/dev/null 2>&1; then
    return 0
  fi

  if [[ "$SKIP_RUST_INSTALL" -eq 1 ]]; then
    echo "cargo is required but not installed (and --skip-rust-install was set)." >&2
    exit 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "cargo is missing and curl is unavailable. Install Rust manually: https://rustup.rs" >&2
    exit 1
  fi

  echo "[installer] cargo not found; installing Rust toolchain via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable

  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
  fi

  if ! command -v cargo >/dev/null 2>&1; then
    echo "Rust install completed but cargo is still unavailable in PATH." >&2
    echo "Try: source \$HOME/.cargo/env" >&2
    exit 1
  fi
}

ensure_cargo

echo "[installer] building fugit-alpha (binary: fugit)"
cargo build --release --manifest-path "$REPO_ROOT/Cargo.toml"

BIN_SRC="$REPO_ROOT/target/release/$BIN_NAME"
if [[ ! -x "$BIN_SRC" ]]; then
  echo "build succeeded but binary not found at $BIN_SRC" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
install -m 0755 "$BIN_SRC" "$INSTALL_DIR/$BIN_NAME"

echo "[installer] installed $BIN_NAME to: $INSTALL_DIR/$BIN_NAME"

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo
  echo "[installer] add this directory to PATH to use '$BIN_NAME' everywhere:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  if [[ "$PLATFORM" == "macos" ]]; then
    echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc"
  else
    echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.bashrc"
  fi
fi

if [[ "$WITH_SKILL" -eq 1 ]]; then
  echo "[installer] installing bundled Codex skill..."
  SKILL_ARGS=(skill install-codex)
  if [[ "$OVERWRITE_SKILL" -eq 1 ]]; then
    SKILL_ARGS+=(--overwrite)
  fi
  "$INSTALL_DIR/$BIN_NAME" "${SKILL_ARGS[@]}"
fi

echo
"$INSTALL_DIR/$BIN_NAME" --help >/dev/null
echo "[installer] done"
