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
  --no-path-update           Do not auto-update shell startup files with install dir
  --with-skill               Install bundled Codex skill after binary install
  --overwrite-skill          Overwrite existing Codex skill files when used with --with-skill
  --skip-rust-install        Fail instead of auto-installing Rust toolchain when cargo is missing
  -h, --help                 Show this help
USAGE
}

PLATFORM=""
INSTALL_DIR="${FUGIT_INSTALL_DIR:-$HOME/.local/bin}"
PATH_UPDATE=1
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
    --no-path-update)
      PATH_UPDATE=0
      shift
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
GUI_LAUNCHER_NAME="fugit-gui"

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

desktop_exec_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/ /\\ /g'
}

install_gui_launcher() {
  local launcher_src="$REPO_ROOT/scripts/$GUI_LAUNCHER_NAME"
  if [[ ! -f "$launcher_src" ]]; then
    echo "missing GUI launcher source: $launcher_src" >&2
    exit 1
  fi
  install -m 0755 "$launcher_src" "$INSTALL_DIR/$GUI_LAUNCHER_NAME"
  echo "[installer] installed GUI launcher to: $INSTALL_DIR/$GUI_LAUNCHER_NAME"
}

install_macos_gui_app() {
  local app_root="$HOME/Applications/Fugit GUI.app"
  local macos_dir="$app_root/Contents/MacOS"
  local plist_path="$app_root/Contents/Info.plist"
  local launcher_path="$macos_dir/fugit-gui-launcher"
  mkdir -p "$macos_dir"
  cat >"$launcher_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$INSTALL_DIR/$GUI_LAUNCHER_NAME" "\$@"
EOF
  chmod 0755 "$launcher_path"
  cat >"$plist_path" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Fugit GUI</string>
  <key>CFBundleExecutable</key>
  <string>fugit-gui-launcher</string>
  <key>CFBundleIdentifier</key>
  <string>io.fugit.gui</string>
  <key>CFBundleName</key>
  <string>Fugit GUI</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
EOF
  echo "[installer] installed macOS app launcher to: $app_root"
}

install_linux_desktop_entry() {
  local desktop_dir="$HOME/.local/share/applications"
  local desktop_file="$desktop_dir/fugit-gui.desktop"
  local escaped_exec
  mkdir -p "$desktop_dir"
  escaped_exec="$(desktop_exec_escape "$INSTALL_DIR/$GUI_LAUNCHER_NAME")"
  cat >"$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Fugit GUI
Comment=Launch the fugit task board
Exec=$escaped_exec
Terminal=false
Categories=Development;
EOF
  echo "[installer] installed Linux desktop entry to: $desktop_file"
}

echo "[installer] building fugit-alpha (binary: fugit)"
cargo build --release --manifest-path "$REPO_ROOT/Cargo.toml"

BIN_SRC="$REPO_ROOT/target/release/$BIN_NAME"
if [[ ! -x "$BIN_SRC" ]]; then
  echo "build succeeded but binary not found at $BIN_SRC" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
install -m 0755 "$BIN_SRC" "$INSTALL_DIR/$BIN_NAME"
install_gui_launcher

echo "[installer] installed $BIN_NAME to: $INSTALL_DIR/$BIN_NAME"

PATH_EXPORT_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""
if [[ "$PATH_UPDATE" -eq 1 ]]; then
  PATH_FILES=()
  if [[ "$PLATFORM" == "macos" ]]; then
    PATH_FILES=("$HOME/.zprofile" "$HOME/.zshrc")
  else
    PATH_FILES=("$HOME/.profile" "$HOME/.bashrc")
  fi
  for path_file in "${PATH_FILES[@]}"; do
    mkdir -p "$(dirname "$path_file")"
    touch "$path_file"
    if ! grep -Fqs "$PATH_EXPORT_LINE" "$path_file"; then
      printf '\n%s\n' "$PATH_EXPORT_LINE" >> "$path_file"
      echo "[installer] added PATH export to $path_file"
    fi
  done
  export PATH="$INSTALL_DIR:$PATH"
elif [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo
  echo "[installer] PATH auto-update disabled. Add this line manually if needed:"
  echo "  $PATH_EXPORT_LINE"
fi

case "$PLATFORM" in
  macos)
    install_macos_gui_app
    ;;
  linux)
    install_linux_desktop_entry
    ;;
esac

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
INSTALLED_VERSION="$("$INSTALL_DIR/$BIN_NAME" --version 2>/dev/null || true)"
if [[ -n "$INSTALLED_VERSION" ]]; then
  echo "[installer] installed version: $INSTALLED_VERSION"
fi
RESOLVED_BIN="$(command -v "$BIN_NAME" || true)"
if command -v which >/dev/null 2>&1; then
  PATH_MATCHES="$(which -a "$BIN_NAME" 2>/dev/null | awk '!seen[$0]++')"
  if [[ -n "$PATH_MATCHES" ]]; then
    echo "[installer] PATH matches:"
    while IFS= read -r match; do
      [[ -z "$match" ]] && continue
      MATCH_VERSION="$("$match" --version 2>/dev/null || true)"
      if [[ -n "$MATCH_VERSION" ]]; then
        echo "  - $match ($MATCH_VERSION)"
      else
        echo "  - $match"
      fi
    done <<<"$PATH_MATCHES"
  fi
fi
if [[ -n "$RESOLVED_BIN" && "$RESOLVED_BIN" != "$INSTALL_DIR/$BIN_NAME" ]]; then
  echo "[installer] warning: PATH currently resolves $BIN_NAME to: $RESOLVED_BIN"
  echo "[installer] expected active binary: $INSTALL_DIR/$BIN_NAME"
  echo "[installer] open a new shell or run: hash -r"
fi
echo "[installer] done"
