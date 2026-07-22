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
web/         The Next.js 16 + React 19 + HeroUI v3 app (the catalog itself).
             Reads the catalog folder off disk and renders it. See
             web/AGENTS.md for how it works.
desktop/     The Electron shell that turns web/ into a desktop app and
             packages it into an AppImage. See desktop/AGENTS.md.
```

## Development

Run the app in the browser (fastest iteration):

```bash
cd web
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

## Building the installers

Linux AppImage (builds natively on Linux):

```bash
cd desktop
npm install
npm run build:linux
# → desktop/dist/Piezario-*.AppImage
```

`build:linux` builds the web app in **standalone** mode, stages the
self-contained Next server (`stage.js`), runs `electron-builder`, then repacks
the AppImage (`repack-appimage.js`).

## Releasing (both installers, from GitHub)

The `.github/workflows/release.yml` GitHub Action builds **both** installers and
attaches them to a Release, so you never need a Windows machine:

1. Go to the repo's **Releases** page → **Draft a new release**.
2. Create a tag like **`v0.1.0`** (the leading `v` is stripped for the version).
3. **Publish** the release.

The action then builds the AppImage on Linux and the `.exe` on Windows, names
both after the tag (e.g. `Piezario-0.1.0.AppImage`, `Piezario Setup 0.1.0.exe`),
and uploads them to that release — downloadable straight from the releases page.

(For a purely local Linux build without a release, `npm run build:linux` still
works, as above. A local Windows build needs `npm run build:win` **on Windows**;
cross-building from Linux is unreliable, which is why the Windows `.exe` is left
to CI.)

## How it works

Piezario is a genuine server-side Next.js app — it reads the models tree with
`node:fs`, opens files in the desktop's apps, and writes back to READMEs and
`catalog.yaml`. So the desktop build runs the **real Next server** inside
Electron (using Electron's bundled Node via `ELECTRON_RUN_AS_NODE`), rather than
exporting static HTML. The window just loads `http://127.0.0.1:<port>`.

The entire catalog is wired from **one environment variable**: `CATALOG_CONFIG`
points at your `catalog.yaml`, and the app resolves `models/`, `fonts/` and
`icons/` relative to it.
