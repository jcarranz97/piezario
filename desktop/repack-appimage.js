// Post-process the AppImage so it launches WITHOUT Chromium's sandbox no matter
// how it is started.
//
// Why: an AppImage mounts read-only, so its chrome-sandbox helper can't be
// root:4755, and modern Ubuntu/GNOME also restrict the namespace-sandbox
// fallback (AppArmor). Electron then aborts at startup with a setuid_sandbox
// FATAL. Passing --no-sandbox fixes it (safe here — Piezario only ever loads its
// own localhost server, never untrusted web content).
//
// electron-builder's `linux.executableArgs` only adds the flag to the generated
// .desktop entry (menu / double-click), NOT to the AppRun script that a plain
// `./Piezario.AppImage` uses. So this step patches AppRun directly and repacks
// the AppImage, covering every launch path.
//
// It reuses the tools electron-builder already downloaded (mksquashfs + the
// AppImage runtime), so no extra system packages are required.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dist = path.join(__dirname, "dist");
const appImageName = fs
  .readdirSync(dist)
  .find((f) => f.endsWith(".AppImage"));
if (!appImageName) {
  console.error("[repack] no .AppImage found in dist/ — run electron-builder first.");
  process.exit(1);
}
const appImage = path.join(dist, appImageName);

// Find a tool electron-builder cached under ~/.cache/electron-builder/appimage.
const cacheRoot = path.join(os.homedir(), ".cache", "electron-builder", "appimage");
function findCached(relParts) {
  if (!fs.existsSync(cacheRoot)) return null;
  for (const version of fs.readdirSync(cacheRoot)) {
    const p = path.join(cacheRoot, version, ...relParts);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const runtime = findCached(["runtime-x64"]);
if (!runtime) {
  console.error(`[repack] AppImage runtime not found under ${cacheRoot}.`);
  process.exit(1);
}
// Prefer electron-builder's mksquashfs; fall back to a system one.
const mksquashfs = findCached(["linux-x64", "mksquashfs"]) || "mksquashfs";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "piezario-repack-"));
try {
  // 1. Unpack the AppImage into its AppDir.
  execFileSync(appImage, ["--appimage-extract"], { cwd: work, stdio: "inherit" });
  const appDir = path.join(work, "squashfs-root");
  const appRun = path.join(appDir, "AppRun");

  // 2. Inject --no-sandbox into AppRun's exec lines (idempotent).
  let script = fs.readFileSync(appRun, "utf8");
  if (!script.includes("--no-sandbox")) {
    script = script
      .replace(/exec "\$BIN"$/m, 'exec "$BIN" --no-sandbox')
      .replace(/exec "\$BIN" "\$\{args\[@\]\}"/m, 'exec "$BIN" --no-sandbox "${args[@]}"');
    fs.writeFileSync(appRun, script);
  }

  // 3. Repack: fresh squashfs, then prepend the AppImage runtime.
  const squashfs = path.join(work, "piezario.squashfs");
  execFileSync(
    mksquashfs,
    [appDir, squashfs, "-root-owned", "-noappend", "-comp", "gzip", "-quiet"],
    { stdio: "inherit" },
  );
  fs.writeFileSync(
    appImage,
    Buffer.concat([fs.readFileSync(runtime), fs.readFileSync(squashfs)]),
  );
  fs.chmodSync(appImage, 0o755);
  console.log(`[repack] injected --no-sandbox into AppRun → ${appImage}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
