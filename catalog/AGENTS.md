# Catalog App

The web app that renders the models tree. **Next.js 16 (App Router),
React 19, Tailwind v4, HeroUI v3.** Read the root `AGENTS.md` first —
it holds the folder-is-a-model invariant and the frontmatter schema that
everything here depends on.

Nothing in this folder knows about the repository it sits in. It reads
`CATALOG_MODELS_DIR` (default `../models`), which is what lets it be
extracted into its own project later.

## Running Commands

```bash
npm run dev                  # http://localhost:3000
npm run build                # production build; also runs TypeScript
npx tsc --noEmit             # typecheck alone
```

## Layout

```text
app/
├── layout.tsx               # shell: header, theme toggle, footer
├── page.tsx                 # grid page (server) → CatalogBrowser
├── providers.tsx            # next-themes only
├── globals.css              # theme vars, .readme typography, .build-plate
├── models/[...slug]/page.tsx    # detail page (server)
├── fonts/page.tsx               # fonts specimen browser (server)
├── icons/page.tsx               # icons preview browser (server)
├── filaments/page.tsx           # filament inventory (server) → yaml, not a folder
├── supplies/page.tsx            # supplies inventory (server) → yaml, not a folder
├── others/page.tsx              # cost settings editor (server) → the cost: section
├── files/[...slug]/route.ts     # serves anything under models/
├── font-files/[...slug]/route.ts # serves anything under fonts/
├── icon-files/[...slug]/route.ts # serves anything under icons/
└── api/icons/search/route.ts    # svgapi.com proxy (keeps SVGAPI_KEY server-side)
components/
├── catalog/catalog-browser.tsx  # "use client" — search + filters + grid
├── catalog/model-card.tsx       # grid card
├── fonts/font-browser.tsx       # "use client" — font specimen browser
├── icons/icon-browser.tsx       # "use client" — icon preview browser
├── filaments/filaments-browser.tsx # "use client" — spool inventory + add/edit
├── supplies/supplies-browser.tsx   # "use client" — supply inventory + add/edit
├── others/others-browser.tsx       # "use client" — cost settings form
├── model/readme.tsx             # markdown, with relative paths rewritten
├── model/file-table.tsx         # downloads, grouped by kind
├── model/model-cost-card.tsx    # landed cost; lines expand to per-file breakdown
├── model/supplies-input.tsx     # repeatable {item, qty} rows for the editor
└── layout/theme-toggle.tsx
lib/
├── catalog.ts               # the scanner — Model type, getModels(), getModel()
├── fonts.ts                 # the fonts scanner — Font type, getFonts()
├── icons.ts                 # the icons scanner — Icon type, getIcons()
├── icons-import.ts          # a writer for icons/ — saves an online icon
│                            #   (svgapi-CDN-locked, path-guarded, no overwrite)
├── inventory.ts             # reads catalog.yaml's filaments:/supplies: sections
├── inventory-write.ts       # the ONLY writer for catalog.yaml — comment-safe
│                            #   (filaments, supplies, and the cost: settings)
├── cost.ts                  # per-file material+machine cost; machineRatePerHour()
├── model-cost.ts            # landed cost (materials+packaging+labor+machine), by out/ group
├── files.ts                 # extension → FileKind → Capability
└── urls.ts                  # fileUrl() / modelUrl() / fontUrl() / iconUrl()
scripts/thumbnail.py         # cover.png renderer (own venv)
```

## Data Flow

There is one direction and no client-side fetching:

1. A server component calls `getModels()` / `getModel()`, which walks
   the models tree and parses each README's frontmatter.
2. The full `Model[]` is passed into `CatalogBrowser` as a prop.
3. Filtering and search are **pure client-side work over that array** —
   no refetch, no loading state, no API layer.

That works because the dataset is a personal model collection (tens to
hundreds of folders). If it ever grows enough to hurt, the fix is
paginating the server render, not adding a client fetch layer.

## Conventions

- **Server components by default.** The only client components are
  `catalog-browser.tsx` and `theme-toggle.tsx` (interactive state) and
  `providers.tsx` (the `next-themes` context). `readme.tsx` renders
  markdown on the server deliberately.
- **`lib/` is server-only** except `urls.ts` and `tree.ts`. `catalog.ts`,
  `fonts.ts` and `serve.ts` touch `node:fs`; importing any **value** from
  them in a client component drags the filesystem into the browser bundle
  and the build fails with *"does not support external modules (request:
  node:fs/promises)"*. Pass data down as props, `import type` for the
  types, and keep URL builders in `urls.ts` — that is exactly why
  `fontUrl` lives there rather than next to the font scanner.
- **Keep `Model` serializable.** It crosses the server/client boundary.
  Plain strings, numbers and arrays — no `Date`, no class instances.
- **Never build a `/files` or `/models` URL by hand.** Use
  `fileUrl()` / `modelUrl()`; filenames contain spaces and `+`.
- **`force-dynamic` on both pages.** Freshness is the whole point.
- **Styling** goes through the CSS variables in `globals.css`
  (`--accent`, `--card-border`, `--muted`) so light and dark stay in
  sync. The `.readme` block is scoped typography for rendered markdown,
  since HeroUI's reset strips heading styles.

## Adding a Feature

- **A new metadata field**: add it to `Model` and `readModel()` in
  `lib/catalog.ts` (coerce through `asString`/`asTags`), then surface it
  in the detail page's `facts` list and/or `model-card.tsx`.
- **A new file type**: one entry in the `EXTENSIONS` map in
  `lib/files.ts`. If it implies a new capability, extend `Capability`,
  `CAPABILITY_LABELS`, `CAPABILITY_HINTS` and `capabilitiesFor()` —
  the filter row in `catalog-browser.tsx` reads them.
- **A new editable field**: add the input to `model/model-editor.tsx`,
  read it in `saveModelAction`, and add the key to `ModelFrontmatter` in
  `lib/write.ts`. The merge logic there is generic — an empty value
  deletes the key, anything else sets it.

- **A new filament/supply field**: add it to `FilamentItem`/`SupplyItem`
  and the parser in `lib/config.ts`, write it in `lib/inventory-write.ts`,
  and surface it in the `filaments`/`supplies` browser. Model-side pricing
  reads through `lib/model-cost.ts`.

There are three sanctioned writers, and everything else stays read-only:
`lib/write.ts` (a model's README), `lib/icons-import.ts` (a saved icon),
and `lib/inventory-write.ts` (`catalog.yaml`'s `filaments:`, `supplies:`
and `cost:`). Each owns a path guard and its own invariant — for
`write.ts` the "empty means delete" rule and the promise that unknown keys
and the markdown body survive; for `inventory-write.ts`, that **every
comment in `catalog.yaml` survives**. It edits only those nodes via the
`yaml` Document API, never a full dump — and the `cost:` values are set
**in place** (`setIn`) so the paragraph above each one stays put.

## HeroUI v3 Notes

`~/repos/printforhelp/frontend` is the working reference; there is no
HeroUI MCP server configured here.

- Compound components: `Card.Header`, `Card.Title`, `Card.Content`,
  `Card.Footer`, `Select.Trigger`, `SearchField.Group`.
- `Chip` variants: `primary | secondary | tertiary | soft`. **No
  `outline`.** `soft` marks capabilities, `tertiary` marks tags.
- `Select` is controlled with `selectedKey` + `onSelectionChange`;
  `ToggleButtonGroup` with `selectionMode="multiple"`, `selectedKeys`
  and a `Set` of keys.
- To confirm a component exists, list
  `node_modules/@heroui/react/dist/components/` and read its
  `index.d.ts` — faster and more accurate than the docs site.
- Always finish with `npx tsc --noEmit`; wrong variant names are type
  errors, not runtime surprises.

## The Files Route

`app/files/[...slug]/route.ts` is the only way to reach anything under
`models/`. It resolves the requested path and then checks the result is
still inside the models root before reading.

**Keep that check.** Without it the route will happily serve any file on
the machine — `%2e%2e%2f` sequences survive to the handler even though
curl and browsers collapse a literal `../` first.

Images and text are served inline; everything else, and any request with
`?download`, is sent as an attachment. `Cache-Control: no-store`
throughout, because these files change while you work.
