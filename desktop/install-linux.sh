#!/usr/bin/env bash
#
# Install the built AppImage as a single, stable desktop entry.
#
# Why this exists: an AppImage is just a file, so "installing" it normally means
# handing it to AppImageLauncher / appimaged, which copies it into ~/Applications
# under a *content-hashed* name (Piezario-0.1.0_<md5>.AppImage) and writes one
# ~/.local/share/applications/appimagekit_<md5>-Piezario.desktop per file. Every
# rebuild is a different file, so every rebuild becomes another launcher entry —
# "Piezario (0.1.0)", "Piezario (0.1.0) (1)", "Piezario (0.1.0) (2)"… and none of
# the old ones is ever removed.
#
# This script sidesteps that: it installs to a fixed path under
# ~/.local/share/piezario/ — deliberately NOT one of the folders appimaged
# watches (~/Downloads, ~/Desktop, ~/Applications, ~/.local/bin, ~/bin, /opt,
# /usr/local/bin) — and writes one .desktop file with a fixed name, so
# reinstalling overwrites in place instead of accumulating.
#
# It also purges any AppImageLauncher-integrated Piezario left over from before.
#
# Usage:
#   ./install-linux.sh [path/to/Piezario.AppImage]   # defaults to dist/*.AppImage
#   ./install-linux.sh --uninstall

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${XDG_DATA_HOME:-$HOME/.local/share}"

install_dir="$data/piezario"
target="$install_dir/Piezario.AppImage"
desktop_file="$data/applications/piezario.desktop"
icon_file="$data/icons/hicolor/512x512/apps/piezario.png"

# Remove every AppImageLauncher-integrated Piezario: its .desktop entry, the
# hashed AppImage that entry points at, and the icon it extracted. Scoped to
# Piezario only — other integrated AppImages are left alone.
purge_appimagelauncher() {
  shopt -s nullglob
  for entry in "$data"/applications/appimagekit_*-Piezario.desktop; do
    # First Exec= line, first token: the hashed AppImage path.
    local binary
    binary="$(grep -m1 '^Exec=' "$entry" | sed 's/^Exec=//; s/ .*//')"
    if [ -n "$binary" ] && [ -f "$binary" ] && [ "$binary" != "$target" ]; then
      echo "  removing $binary"
      rm -f "$binary"
    fi
    echo "  removing $entry"
    rm -f "$entry"
  done
  for icon in "$data"/icons/hicolor/*/apps/appimagekit_*_piezario-desktop.*; do
    echo "  removing $icon"
    rm -f "$icon"
  done
  shopt -u nullglob
}

refresh_caches() {
  command -v update-desktop-database >/dev/null && \
    update-desktop-database "$data/applications" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null && \
    gtk-update-icon-cache -f -t "$data/icons/hicolor" 2>/dev/null || true
}

if [ "${1:-}" = "--uninstall" ]; then
  echo "Uninstalling Piezario…"
  purge_appimagelauncher
  rm -f "$desktop_file" "$icon_file"
  rm -rf "$install_dir"
  refresh_caches
  echo "Done. (Your catalog folder and settings were not touched.)"
  exit 0
fi

# Locate the AppImage: explicit argument, else the newest one in dist/.
appimage="${1:-}"
if [ -z "$appimage" ]; then
  appimage="$(ls -t "$here"/dist/*.AppImage 2>/dev/null | head -n1 || true)"
fi
if [ -z "$appimage" ] || [ ! -f "$appimage" ]; then
  echo "No AppImage found. Run 'npm run build:linux' first, or pass a path." >&2
  exit 1
fi

echo "Installing $(basename "$appimage")…"

mkdir -p "$install_dir" "$(dirname "$desktop_file")" "$(dirname "$icon_file")"

# Copy BEFORE purging. The source is very often an already-integrated AppImage in
# ~/Applications — exactly what the purge deletes — so purging first would remove
# the file we are about to install.
#
# Copy to a temp name and move into place: replacing the file a running instance
# is executing from would otherwise break it mid-session.
cp "$appimage" "$target.new"
chmod +x "$target.new"

purge_appimagelauncher

mv -f "$target.new" "$target"

cp "$here/build/icon.png" "$icon_file"

# StartupWMClass must stay 'piezario-desktop' — Electron derives WM_CLASS from
# package.json's `name`, and GNOME matches the running window to this entry by
# that string. See AGENTS.md → "The taskbar icon".
cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Piezario
Comment=Organize a 3D-model catalog and price your prints
Exec=$target --no-sandbox %U
Icon=piezario
Terminal=false
Categories=Graphics;
StartupWMClass=piezario-desktop
EOF
chmod +x "$desktop_file"

refresh_caches

echo "Installed → $target"
echo "Launcher  → $desktop_file"
