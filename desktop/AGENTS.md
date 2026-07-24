# Desktop shell

Turns the Next.js app in `../web` into a Linux desktop app (AppImage).
Everything here is the packaging layer — no catalog logic lives in `desktop/`.

## Why a server, not static HTML

Piezario is a real server-side app: it reads the models tree with `node:fs`,
spawns the file manager (`../web/lib/open.ts`), and writes back to READMEs
and `catalog.yaml`. Static export would drop all of that. So the desktop build
**runs the production Next server** and points a window at it.

## How it runs

`main.js`:

1. Reads a remembered catalog folder from `app.getPath("userData")/config.json`.
   On first launch (or if the folder has no `catalog.yaml`) it shows a native
   folder picker, and offers to scaffold `models/ fonts/ icons/ catalog.yaml`
   into an empty folder.
2. Grabs a free localhost port.
3. Spawns the Next server. **Production**: `spawn(process.execPath, [server.js],
   { env: { ELECTRON_RUN_AS_NODE: "1", PORT, HOSTNAME: "127.0.0.1",
   CATALOG_CONFIG } })` — `ELECTRON_RUN_AS_NODE=1` runs Electron's bundled Node
   with no Chromium, so **the app carries its own runtime and needs nothing
   installed**. **Dev** (`NEXT_DEV=1`, i.e. `npm run dev`): runs the catalog's
   own `next dev` instead.
4. Polls the port until the server answers, then opens a `BrowserWindow` at
   `http://127.0.0.1:<port>`.

`CATALOG_CONFIG` is the single wire into the catalog — see the root `AGENTS.md`.
**File → Change catalog folder…** re-picks the folder, restarts the server, and
reloads.

## The one gotcha: staging

`next build` with `output: "standalone"` leaves the server in
`../web/.next/standalone` but, by Next's design, does **not** copy the static
assets into it. `stage.js` assembles the shippable server into
`staging/app-server/`: the standalone tree plus `.next/static` copied to
`<server>/.next/static`. (There is no `public/` folder in this app.)
electron-builder ships `staging/app-server` as an `extraResource`, and `main.js`
resolves it at `process.resourcesPath/app-server/server.js` when packaged.

`web/next.config.ts` pins `outputFileTracingRoot` to the web-app folder so
`server.js` always lands at the root of the standalone tree — don't remove it,
or the staged path breaks.

## Commands

```bash
npm run dev             # Electron over `next dev` (needs Node on the dev machine)
npm run build:linux     # build web (standalone) → stage → electron-builder → AppImage
npm run install:linux   # install that AppImage as a single desktop entry
npm run uninstall:linux # remove it again
```

Output: `dist/Piezario-*.AppImage`.

## Installing without collecting duplicate launcher entries

An AppImage is only a file, so "installing" it usually means letting
AppImageLauncher / `appimaged` integrate it. That copies it into `~/Applications`
under a **content-hashed** name (`Piezario-0.1.0_<md5>.AppImage`) and writes one
`~/.local/share/applications/appimagekit_<md5>-Piezario.desktop` per file. Every
rebuild is a different file, so every rebuild adds *another* launcher entry —
`Piezario (0.1.0)`, `Piezario (0.1.0) (1)`, `(2)`… and nothing removes the old
ones. Bumping the version does not help; the hash is per build, not per version.

`install-linux.sh` (the `install:linux` script) avoids the whole mechanism:

- installs to a **fixed** path, `~/.local/share/piezario/Piezario.AppImage`, so a
  reinstall overwrites in place;
- that folder is deliberately **not** one appimaged watches (`~/Downloads`,
  `~/Desktop`, `~/Applications`, `~/.local/bin`, `~/bin`, `/opt`,
  `/usr/local/bin`), so nothing re-integrates it behind your back;
- writes one `piezario.desktop` with a fixed name and the same
  `StartupWMClass=piezario-desktop` the packaged entry uses;
- purges any AppImageLauncher-integrated Piezario (entry, hashed AppImage, and
  extracted icon) first, which is what clears an already-duplicated menu.

It copies to `Piezario.AppImage.new` and `mv`s it into place — overwriting the
file a running instance is executing from would kill that session.

## The Chromium sandbox

Electron aborts at startup on many end-user machines with a
`setuid_sandbox_host` FATAL: an AppImage mounts read-only so its `chrome-sandbox`
can't be root:4755, and modern Ubuntu/GNOME also restrict the namespace-sandbox
fallback via AppArmor. The fix is to run with `--no-sandbox` — safe here because
Piezario only loads its own localhost server, never untrusted web content.

Passing it reliably takes **four** layers, because the setuid-sandbox check
fires in early native startup, before `main.js` runs — so anything set from JS
is already too late for the main process:

1. `package.json` → `scripts.dev` passes `--no-sandbox` on the `electron .`
   command line. Needed because a dev checkout's
   `node_modules/electron/dist/chrome-sandbox` is owned by the current user, not
   root:4755, so `npm run dev` aborts with a `setuid_sandbox_host` FATAL without
   it. (Do not "fix" that by chowning the helper to root — it would have to be
   redone after every `npm install`.)
2. `main.js` calls `app.commandLine.appendSwitch("no-sandbox")` — this does
   **not** save the main process (it runs too late); it covers child processes
   and renderers.
3. `package.json` → `build.linux.executableArgs: ["--no-sandbox"]` — bakes the
   flag into the generated `.desktop` entry (menu / double-click launches).
4. `repack-appimage.js` (the `repack` step in `build:linux`) patches the
   AppImage's `AppRun` so a plain `./Piezario.AppImage` also passes the flag.
   electron-builder does not touch AppRun, so without this, terminal launches
   would still crash.

## About dialog / version stamping

**Help → About Piezario** shows the version, build date, commit and runtime
versions, with a **Copy details** button so a bug report can carry the exact
build it came from.

The two facts have deliberately different sources:

- **Version** — `app.getVersion()`, i.e. `desktop/package.json`. The release
  workflow rewrites it from the git tag (`npm --prefix desktop version
  "${GITHUB_REF_NAME#v}"`) before building, so tagging `v0.3.0` is all it takes
  for the About box to read `0.3.0`. Do not duplicate the version anywhere else.
- **Build date + commit** — `build-info.json`, generated by `build-info.js`
  (the `buildinfo` step in both `build:linux` and `build:win`). Neither is
  knowable at runtime: a packaged AppImage has no git repo, and squashfs
  normalises file mtimes. It is gitignored and listed in `build.files` so
  electron-builder ships it next to `main.js`.

`build-info.js` never fails a build — the stamp is diagnostic, so a missing git
binary just yields `commit: null`. When the file is absent entirely (a `npm run
dev` run), About says *"Built from source (development)"* rather than showing a
bare version that could be mistaken for a release build. It honours
`SOURCE_DATE_EPOCH` for reproducible builds.

## The taskbar icon (StartupWMClass)

The launcher icon and the **running window's** icon are two different lookups.
The launcher reads the `.desktop` file directly; GNOME picks the icon for a live
window by matching that window's X11 `WM_CLASS` against a `.desktop` file's
`StartupWMClass`. If nothing matches, the window gets a generic gear icon even
though the launcher looks right.

Electron derives `WM_CLASS` from `app.getName()`, i.e. this package's
**`name`: `piezario-desktop`** — verified with `xprop`:

```text
WM_CLASS(STRING) = "piezario-desktop", "piezario-desktop"
```

electron-builder, however, defaults `StartupWMClass` to `productName`
(`Piezario`), so the two never matched. `package.json` →
`build.linux.desktop.StartupWMClass` pins it to `piezario-desktop` instead.

Two traps worth knowing:

- **Chromium's `--class` switch does not work here.** Under Ozone, Electron
  ignores it and keeps the app-name-derived value — a fix via `--class` looks
  correct and silently does nothing.
- **`StartupWMClass` is coupled to this package's `name` field.** Renaming
  `name` changes `WM_CLASS` and breaks the icon again. `productName` is safe to
  change; `name` is not, unless you update `StartupWMClass` to match.

(`app.setName("Piezario")` would also align them, but it moves
`app.getPath("userData")` — where the remembered catalog folder lives — so
users would silently lose their catalog-folder setting.)

To verify a change, run the app and check the window's class:

```bash
for w in $(xprop -root _NET_CLIENT_LIST | grep -o '0x[0-9a-f]*'); do
  xprop -id $w WM_CLASS WM_NAME 2>/dev/null | tr '\n' ' '; echo
done
```

AppImageLauncher copies the `.desktop` file into
`~/.local/share/applications/appimagekit_*-Piezario.desktop` at integration
time, so an already-integrated AppImage keeps its **old** `StartupWMClass`.
Remove the old entry (or re-integrate) when testing.

## Windows installer

`npm run build:win` builds the NSIS `.exe` (config under `build.win` / `build.nsis`
in `package.json`). It runs `build:web` → `stage` → `electron-builder --win nsis`
— **without** the `repack` step, which is AppImage-only. The same `main.js`
already works on Windows: the Wayland/sandbox tweaks are Linux-guarded, and the
server spawn (`process.execPath` + `ELECTRON_RUN_AS_NODE`) is cross-platform.

**Build it on Windows, not here.** Cross-building NSIS from Linux via wine is
unreliable, so `.github/workflows/release.yml` builds the `.exe` on a
`windows-latest` runner (and the AppImage on `ubuntu-latest`). It runs when a
GitHub **Release** is published: it stamps both installers with the release tag's
version (`npm version` from `${GITHUB_REF_NAME}`, `v` stripped) and uploads them
onto that release via `softprops/action-gh-release`. Cut a release from the
Releases page with a tag like `v0.1.0` and both files appear on it.
