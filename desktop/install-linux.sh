#!/usr/bin/env bash
#
# Install the built AppImage as a single, stable desktop entry.
#
# Why this exists: handing the AppImage to AppImageLauncher / appimaged gives you
# a new launcher entry per build. It copies the file into ~/Applications under a
# *content-hashed* name (Piezario-0.4.0_<md5>.AppImage) and writes one
# ~/.local/share/applications/appimagekit_<md5>-Piezario.desktop for it. Every
# rebuild is a different file, so every rebuild becomes another entry —
# "Piezario (0.3.0)", "Piezario (0.4.0)", … and none of the old ones is ever
# removed. Bumping the version does not help; the hash is per build.
#
# Moving the file somewhere unwatched does not help either: AppImageLauncher
# registers itself with binfmt_misc for the AppImage format, so it intercepts
# *any* AppImage being executed from *any* path and offers to move it into
# ~/Applications and integrate it.
#
# So this script does not install an AppImage at all. It **extracts** it into
# ~/.local/share/piezario/app/ and points the launcher at the AppDir's AppRun —
# an ordinary executable, which binfmt_misc has no interest in. There is no
# AppImage left for anything to integrate, and reinstalling replaces the same
# directory and rewrites the same .desktop file, so exactly one entry exists.
#
# Cost: the AppDir is uncompressed (~300 MB vs ~120 MB). In exchange, startup
# skips the squashfs mount.
#
# Usage:
#   ./install-linux.sh [path/to/Piezario.AppImage]   # defaults to dist/*.AppImage
#   ./install-linux.sh --uninstall

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${XDG_DATA_HOME:-$HOME/.local/share}"

install_dir="$data/piezario"
app_dir="$install_dir/app"
desktop_file="$data/applications/piezario.desktop"
icon_file="$data/icons/hicolor/512x512/apps/piezario.png"

# Remove every AppImageLauncher-integrated Piezario: its .desktop entry, the
# hashed AppImage that entry points at, and the icon it extracted. Scoped to
# Piezario only — other integrated AppImages are left alone.
purge_appimagelauncher() {
  local entry binary icon
  shopt -s nullglob
  for entry in "$data"/applications/appimagekit_*-Piezario.desktop; do
    # First Exec= line, first token: the hashed AppImage path.
    binary="$(grep -m1 '^Exec=' "$entry" | sed 's/^Exec=//; s/ .*//')"
    if [ -n "$binary" ] && [ -f "$binary" ]; then
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
appimage="$(readlink -f "$appimage")"

echo "Installing $(basename "$appimage")…"

# Extract BEFORE purging. The source is very often an already-integrated AppImage
# in ~/Applications — exactly what the purge deletes — so purging first would
# remove the file we are about to install.
#
# --appimage-extract always writes ./squashfs-root, so run it in a scratch dir.
staging="$(mktemp -d "${TMPDIR:-/tmp}/piezario-install-XXXXXX")"
trap 'rm -rf "$staging"' EXIT
( cd "$staging" && "$appimage" --appimage-extract >/dev/null )
if [ ! -x "$staging/squashfs-root/AppRun" ]; then
  echo "Extraction failed: no AppRun in the AppDir." >&2
  exit 1
fi

purge_appimagelauncher

mkdir -p "$install_dir" "$(dirname "$desktop_file")" "$(dirname "$icon_file")"

# Swap the new AppDir in, then delete the old one: a running instance keeps its
# files alive until it exits, and the launcher never points at a half-copy.
rm -rf "$app_dir.old"
[ -d "$app_dir" ] && mv "$app_dir" "$app_dir.old"
mv "$staging/squashfs-root" "$app_dir"
rm -rf "$app_dir.old"

cp "$here/build/icon.png" "$icon_file"

# AppRun already appends --no-sandbox to the Electron binary (repack-appimage.js
# patches it), so the Exec line must not repeat it.
#
# StartupWMClass must stay 'piezario-desktop' — Electron derives WM_CLASS from
# package.json's `name`, and GNOME matches the running window to this entry by
# that string. See AGENTS.md → "The taskbar icon".
cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Piezario
Comment=Organize a 3D-model catalog and price your prints
Exec=$app_dir/AppRun %U
TryExec=$app_dir/AppRun
Icon=piezario
Terminal=false
Categories=Graphics;
StartupWMClass=piezario-desktop
EOF
chmod +x "$desktop_file"

refresh_caches

echo "Installed → $app_dir"
echo "Launcher  → $desktop_file"
