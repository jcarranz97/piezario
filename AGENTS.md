# Piezario

**Piezario** is a desktop app for makers to organize a 3D-model catalog and
price their prints. The application lives here; the **catalog content lives in a
separate folder the user chooses** (e.g. the `3d-catalog` repo). Piezario reads
that folder off disk and renders it — the same relationship `mkdocs` has with
`docs/`. There is no database, no import step and no admin panel.

The app is a Next.js web app (`web/`) wrapped in an Electron shell
(`desktop/`) so it ships as a single AppImage — no Node, npm or terminal for the
end user. See `web/AGENTS.md` for the app internals and `desktop/AGENTS.md`
for the packaging.

The app has six tabs. The first three are folder-driven — the same rule drives
all of them:

- **Models** — `models/`, one folder per model (see below).
- **Fonts** — `fonts/`, a flat folder of `.ttf`/`.otf`/`.woff`/`.woff2` files
  the generator scripts draw text with, shown as a Google-Fonts-style specimen
  browser.
- **Icons** — `icons/`, `.svg` files nested in folders, shown as a resizable
  preview browser. A folder may carry a `README.md` whose frontmatter
  (`description`, `tags`, `source`, `license`) describes it. A **Search online**
  checkbox extends the tab to svgapi.com's public-domain library; **Save**
  downloads an SVG into the selected folder through `actions/icons.action.ts` →
  `lib/icons-import.ts`, the only code that writes to `icons/`.

The last three are driven by `catalog.yaml`, not a folder, and are **editable**
— they write back through `lib/inventory-write.ts`, comment-preserving:

- **Filaments** — the `filaments:` section: your spools, one entry per product
  with a list of `colors`.
- **Supplies** — the `supplies:` section: rings, chains, glue, priced per unit.
- **Others** — the `cost:` section: currency, per-kg rates, machine rate, tax
  and markup. Editing these reprices every model's cost card.

**Stack**: Next.js 16 (App Router) + React 19 + Tailwind v4 + HeroUI v3, plus a
small numpy/matplotlib CLI for thumbnails, wrapped in Electron 33. Everything
runs locally; there is no backend service.

## Quick Start (development)

```bash
cd web
npm install
CATALOG_CONFIG=/path/to/3d-catalog/catalog.yaml npm run dev   # http://localhost:3000
```

Or inside the Electron window: `cd desktop && npm install && npm run dev`.
Build the AppImage: `cd desktop && npm run build:linux`.

The app re-reads the catalog folder on every request, so editing a README and
refreshing is enough — no restart, no rebuild.

## Where the catalog lives

The whole catalog is wired from **one environment variable**: `CATALOG_CONFIG`
points at a `catalog.yaml`, and `loadConfig()` (`web/lib/config.ts`)
resolves `models/`, `fonts/` and `icons/` relative to that file's folder. In the
desktop app, `desktop/main.js` sets `CATALOG_CONFIG` from the folder the user
picks on first launch (**File → Change catalog folder…** changes it).
`CATALOG_MODELS_DIR` / `CATALOG_FONTS_DIR` / `CATALOG_ICONS_DIR` still override
individual roots.

## The Core Invariant

**A folder with no subfolders is a model. Its parent folders are its
categories.** `models/keychains/ysisi-nametag/` is the model *Ysisi nametag* in
the category *keychains*. Nesting depth is arbitrary.

This rule lives in two places that **must stay in sync**: `walk()` in
`web/lib/catalog.ts` and `is_model_dir()` in `web/scripts/thumbnail.py`.
Both read their exclusion list from the same `catalog.yaml`.

`catalog.yaml` holds the settings conventions can't infer — `models_dir`,
`fonts_dir`, `icons_dir`, and `exclude`. It is read on every scan; a malformed
file falls back to defaults rather than taking the pages down. `exclude` matters
more than it looks: a folder with subfolders is a *category*, so failing to
exclude a generator's `out/` demotes the parent from model to category and hides
its README and scripts.

Everything else about a model is derived, never declared:

| Derived | From |
|---|---|
| Category | Ancestor folder names |
| Title | `title:` → folder name |
| Description | `description:` → README's first paragraph |
| Cover image | `cover:` → a `*preview*`/`cover.*` image → any image |
| File kinds | File extensions (`lib/files.ts`) |
| Capability badges | Which kinds are present |

## Model Metadata

Optional YAML frontmatter at the top of a model's `README.md`. **Every field is
optional** — a folder with no README still appears, just with less on its card.
The full field list and the cost model (landed cost = raw materials + purchased
materials + packaging + labor + machine, then markup and tax) are documented in
`web/AGENTS.md`, which is authoritative for app internals.

## Structure

```text
web/                     # the Next.js app (reads the catalog folder, renders it)
├── app/                 # App Router pages + the file-serving routes
├── components/          # catalog/ · model/ · fonts/ · icons/ · layout/
├── lib/                 # catalog.ts · config.ts · fonts.ts · icons.ts · cost.ts …
└── scripts/thumbnail.py # renders cover.png from an STL
desktop/                 # Electron shell → AppImage (see desktop/AGENTS.md)
├── main.js              # spawns the Next server, opens the window
├── stage.js             # assembles the standalone server for packaging
└── build/icon.png
```

## Desktop packaging

Piezario is a **server-side** app (it reads the tree with `node:fs`, spawns the
file manager via `web/lib/open.ts`, and writes back to READMEs and
`catalog.yaml`), so it cannot be exported as static HTML. The desktop build runs
the **real Next server** built with `output: "standalone"`, launched from
`desktop/main.js` using Electron's own bundled Node
(`ELECTRON_RUN_AS_NODE=1`) — which is why the packaged app needs no separate
runtime. The window loads `http://127.0.0.1:<port>`. Details in
`desktop/AGENTS.md`.

## Key Constraints

- **The filesystem is the schema.** Never introduce a database, a manifest, or a
  build-time index. If something can be derived by reading the folder, derive it.
- **Pages are `export const dynamic = "force-dynamic"`.** The catalog changes
  while the server runs; a cached render would show stale content. No
  `generateStaticParams`, no ISR — and no static export (the app needs a live
  Node server, which is exactly what the Electron build provides).
- **`web/` has no dependency on any particular catalog.** It reads whatever
  `CATALOG_CONFIG` points at. That is what lets Piezario be pointed at any
  models folder without a code change.
- The remaining app-internal constraints (the file-serving containment check,
  `lib/urls.ts` path encoding, `lib/open.ts` no-shell spawn, gitignored
  binaries, frontmatter `Date` handling, HeroUI v3 notes, the 3MF tool checker,
  thumbnails) are documented in **`web/AGENTS.md`** — read it before
  touching the app.

## Validation Checklist

```bash
cd web
npx tsc --noEmit
npm run build
```

Then load the app and check a **model detail page** — the grid can look fine
while a detail page throws. For the desktop path, `cd desktop && npm run
build:linux` and open the resulting AppImage.
