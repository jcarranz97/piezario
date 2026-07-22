# Desktop shell

Turns the Next.js app in `../catalog` into a Linux desktop app (AppImage).
Everything here is the packaging layer — no catalog logic lives in `desktop/`.

## Why a server, not static HTML

Piezario is a real server-side app: it reads the models tree with `node:fs`,
spawns the file manager (`../catalog/lib/open.ts`), and writes back to READMEs
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
`../catalog/.next/standalone` but, by Next's design, does **not** copy the static
assets into it. `stage.js` assembles the shippable server into
`staging/app-server/`: the standalone tree plus `.next/static` copied to
`<server>/.next/static`. (There is no `public/` folder in this app.)
electron-builder ships `staging/app-server` as an `extraResource`, and `main.js`
resolves it at `process.resourcesPath/app-server/server.js` when packaged.

`catalog/next.config.ts` pins `outputFileTracingRoot` to the catalog folder so
`server.js` always lands at the root of the standalone tree — don't remove it,
or the staged path breaks.

## Commands

```bash
npm run dev           # Electron over `next dev` (needs Node on the dev machine)
npm run build:linux   # build catalog (standalone) → stage → electron-builder → AppImage
```

Output: `dist/Piezario-*.AppImage`.

## Not yet done

- **Windows `.exe`**: add `win.target: nsis` to `build` in `package.json` and
  build on Windows or a GitHub Actions Windows runner (cross-building NSIS from
  Linux via wine is unreliable).
