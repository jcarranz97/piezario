# Piezario

**Piezario** is a desktop app for makers to organize a personal catalog of 3D
models and price their prints. The name is Spanish — *pieza* + *-ario*, "a
personal collection of parts" (like a *recetario* is your collection of
recipes). It is a **private, maker-only** tool: not a customer-facing storefront
and not a design tool — it organizes parts you already have.

It follows one idea: **the folder is the database.** You point Piezario at a
folder on your disk, and it renders whatever is there — one folder per model,
plus fonts, icons, and a `catalog.yaml` of your filaments, supplies and costs.
There is no import step, no database, no admin panel. Edit a README and refresh.

The catalog content lives in a **separate** repo (e.g.
[`3d-catalog`](https://github.com/) — your own models). Piezario is just the
viewer/editor; it ships empty and asks you to pick your catalog folder on first
launch.

## For end users

Download the AppImage, make it executable, and open it:

```bash
chmod +x Piezario-*.AppImage
./Piezario-*.AppImage
```

No Node, no npm, no terminal setup — the app bundles its own runtime. On first
launch it asks for your **catalog folder** (the one containing `catalog.yaml`).
That choice is remembered; change it any time from **File → Change catalog
folder…**.

## Layout

```text
catalog/     The Next.js 16 + React 19 + HeroUI v3 app (the catalog itself).
             Reads the catalog folder off disk and renders it. See
             catalog/AGENTS.md for how it works.
desktop/     The Electron shell that turns catalog/ into a desktop app and
             packages it into an AppImage. See desktop/AGENTS.md.
```

## Development

Run the app in the browser (fastest iteration):

```bash
cd catalog
npm install
npm run dev            # http://localhost:3000
# point it at a catalog folder with an env var:
CATALOG_CONFIG=/path/to/3d-catalog/catalog.yaml npm run dev
```

Run it inside the Electron window (over the same dev server):

```bash
cd desktop
npm install
npm run dev            # opens the Electron window against `next dev`
```

## Building the Linux AppImage

```bash
cd desktop
npm install
npm run build:linux
# → desktop/dist/Piezario-*.AppImage
```

`build:linux` builds the catalog in **standalone** mode, stages the
self-contained Next server (`stage.js`), and runs `electron-builder`. Windows
`.exe` support is planned but not wired up yet.

## How it works

Piezario is a genuine server-side Next.js app — it reads the models tree with
`node:fs`, opens files in the desktop's apps, and writes back to READMEs and
`catalog.yaml`. So the desktop build runs the **real Next server** inside
Electron (using Electron's bundled Node via `ELECTRON_RUN_AS_NODE`), rather than
exporting static HTML. The window just loads `http://127.0.0.1:<port>`.

The entire catalog is wired from **one environment variable**: `CATALOG_CONFIG`
points at your `catalog.yaml`, and the app resolves `models/`, `fonts/` and
`icons/` relative to it.
