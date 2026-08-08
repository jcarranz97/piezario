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
├── api/icons/search/route.ts    # svgapi.com proxy (keeps SVGAPI_KEY server-side)
└── api/customize/…              # start a generator run, poll it, serve its output
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
├── model/components-input.tsx   # repeatable {model, qty, include} rows — kits
├── model/customizer.tsx         # "use client" — the Basic/Advanced parameter form
├── model/mesh-preview.tsx       # "use client" — three.js turntable over a generated STL
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
├── kit-cost.ts              # prices a model's components: lines against the catalog
├── components.ts            # the components: line shape + include set (pure — no fs)
├── customize-spec.ts        # the `customize:` frontmatter block (pure — no fs)
├── customize.ts             # reads a generator's params; validates a form → argv
├── customize-run.ts         # spawns a run, tracks it, caches by parameter hash
├── threemf-mesh.ts          # 3MF -> coloured meshes for the preview (browser-safe)
├── files.ts                 # extension → FileKind → Capability
└── urls.ts                  # fileUrl() / modelUrl() / fontUrl() / iconUrl()
scripts/thumbnail.py         # cover.png renderer (own venv)
scripts/describe_generator.py # dumps any click script's params as JSON
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

## Customisable Models

A model whose README carries a `customize:` block is generated by a `click`
script the app can drive. The form is **not** declared anywhere in this repo:
`describe_generator.py` imports the script in the *model's own* `.venv` and
dumps click's parameter list, so a new option shows up with no code change
here. See the root catalog's `AGENTS.md` for the frontmatter.

Three things are worth knowing before touching this:

- **`toArgv` in `lib/customize.ts` is a trust boundary.** Every value it sees
  came from a browser. It accepts only what the introspected schema declares,
  refuses non-numbers, and will not pass a filesystem path unless the parameter
  was bound to a catalog folder with `from_catalog:` — in which case the client
  sends an id and the path is resolved server-side. This layer is written to
  survive the move to a hosted backend; the route around it is not.
- **A field's default can follow another field**, which is the one thing click
  cannot express — a CLI has no live form to react to, you just pass the flag.
  A generator declares it as a module-level `DEPENDENT_DEFAULTS`:

  ```python
  DEPENDENT_DEFAULTS = {
      "--revision": {"on": "--variant", "map": {"snap": "C", "tongue": "B"}},
  }
  ```

  `describe_generator.py` reports it, `customize.ts` resolves the flags to
  field *names* and seeds the dependent from the controller's own default, and
  `customizer.tsx` moves it whenever the controller changes. **The script owns
  the map**, for the same reason it owns the rest of the form: it can derive it
  from whatever it already reads, so it cannot drift. The joint study reads its
  revision letters out of its own README.

  Changing the controller **overwrites** whatever was typed in the dependent,
  deliberately. Leaving a hand-edited value alone preserves one that is now
  wrong, silently — and for the case this was built for the value is engraved
  on physical parts. Re-typing a letter is cheap; re-printing coupons is not. A
  controller value with no mapping clears the field, which is what makes the
  script fall back to its own record.
- **A repeatable flag becomes a list of rows**, the way the Supplies card
  works. `click`'s `multiple=True` already says the flag may be given once per
  value, and `describe_generator.py` reports it — `toArgv` then emits
  `--word JUAN:3 --word ORIANA:4` rather than one value with a comma in it,
  which would silently build a single item named after the whole list.

  What click *cannot* say is that one entry is a name **and** a count. On a
  command line you type the colon; on a form, a single box where the colon
  means something is a box only the script's author can fill. So a generator
  may describe one entry as a module-level `MULTI_FIELDS`:

  ```python
  MULTI_FIELDS = {
      "--word": {
          "add_label": "Add name",
          "empty_label": "No names yet.",
          "separator": ":",
          "parts": [
              {"key": "text", "label": "Name", "type": "text"},
              {"key": "times", "label": "Times", "type": "integer",
               "default": "1", "width": "narrow"},
          ],
      },
  }
  ```

  Same ownership rule as `DEPENDENT_DEFAULTS`: the separator lives next to the
  parser that reads the entry back apart, so the two cannot disagree about what
  a colon separates. A repeatable flag with no declaration is still a list —
  just of plain single boxes, which is right for a flag taking one value per
  occurrence.

  **Enter adds the next row** and puts the cursor in it, so a list of names is
  typed without reaching for the mouse; on a row that is not the last one it
  steps down instead of inserting into the middle. A row whose **first part is
  blank** is one somebody added and did not fill, and it is dropped before the
  payload is posted. That is not tidiness: pressing Enter hands you a fresh row
  every time and the last one is still there when you press Generate, and an
  untouched row on the keycap form joins to `:1` — a valid entry meaning "one
  cap with no letter on it". A blank keycap would arrive on the plate with
  nobody having asked for one.

  The rows are held in form state as the **joined strings**, not as objects.
  The form's job is to make the separator invisible, not to invent a second
  representation of an entry that then has to be converted on the way out.
  Splitting for display goes from the **right**, once per gap, mirroring what
  the script does: `MARIA:JOSE:2` is the name `MARIA:JOSE` twice.
- **A run is started and polled, never awaited.** Generators take seconds to
  minutes, and one runs at a time (OCC is single-threaded and CPU-bound). The
  job id is a hash of the model plus the exact argv, so the same parameters
  twice cost nothing and finished work survives a restart.
- **Output is not catalog content.** Runs write to `.piezario/generated/<hash>/`
  beside `catalog.yaml`, not into the model's `out/` — a customer's variant is
  an artifact, and customising a model must never edit the catalog.
- **`from_catalog: filaments` is presets, not a limit.** The picker offers the
  colours in `catalog.yaml` as swatches because they answer most orders, but
  any colour can be chosen and submitted. Validation is on the *shape*
  (`#rrggbb`, nothing else), not the inventory — contrast `fonts`, which is a
  closed list because a font that is not in the catalog cannot be resolved to
  a file at all.
- **The preview reads the 3MF, not an STL.** `threemf-mesh.ts` pulls out one
  mesh per part with its colour and filament slot, so a multi-material print
  previews as what it is. It imports only `fflate` and runs in the browser:
  the mesh is hundreds of thousands of floats, and shipping it as JSON from a
  route would be larger and slower than sending the 3MF the file route
  already serves. It is the one `lib/` module that is not server-only.

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

  Note what `SupplyItem.price` is before touching it: the **derived**
  price of one unit, and never a stored field. It is `unitPrice()` over
  the supply's `purchases:` — the **quantity-weighted** average of the
  ones whose `use_for_price` isn't `false`, i.e. total spent over total
  units. Weighted is the whole point: a plain mean of the per-unit rates
  lets a bag of 10 count as much as a bag of 100, which is a real
  mispricing, not a rounding difference. There is a fixture and a test
  pinning that (`tests/config.test.ts`, "weights the average by
  quantity").

  The older flat spellings (`price:`, `package_price:`/`package_qty:`,
  `url:`) are read as a single undated purchase and rewritten as one on
  save — the same migrate-on-write rule `write.ts` uses for a model's
  retired frontmatter keys.

  Every cost calculation reads `price` and nothing else — the single
  multiplication is in `resolveSupplies` (`lib/model-cost.ts`) — so keep
  new pricing shapes resolving to it rather than teaching the cost code
  about them.

  A field that becomes an `href` — `SupplyItem.url`, the buy-it-again link —
  is validated **at parse time** (`itemUrl`), not at the anchor: anything but
  `http(s)` is dropped, so a `javascript:` typed into the form can never be
  rendered as something clickable.

## Composed Models (Kits)

Any model may carry a `components:` list — other catalog models it contains,
by slug and quantity — and be priced from them. A kit folder holds nothing
but a `README.md`, which `walk()` already accepts as a model, so **the
scanner needs no change**; what makes it a kit is the frontmatter, which is
also where its `kit` capability badge comes from rather than from file kinds.

`lib/kit-cost.ts` resolves those lines against the live catalog on every
render — never a copy of a component's numbers, which would go stale the
moment a spool price changed. Three rules hold the arithmetic together:

- **A component brings its own margin.** Its cost joins the kit's `landed`
  and its markup joins the kit's `profit`, so a price you back-solved on a
  part survives being sold inside a kit. Tax is charged **once**, on the
  whole pre-tax total — adding component *prices* by hand charges it twice.
- **A component brings only what its line's `include:` allows.** The print
  always; `supplies` and `labor` by default; `packaging` and `shipping`
  only when asked, because a kit is bagged once and posted once.
- **A plate is not a unit.** `yield: 52` on a model divides its filament and
  machine cost, and — when `labor_basis: plate` — its labour too. Supplies,
  packaging and shipping are per finished piece by their nature; labour is
  the one that could be either, and only the author knows which, so it is
  declared rather than guessed. `yield:` applies to that model's own card as
  well, which is the point of declaring it there rather than on whoever
  includes it.

Constraints worth knowing before you touch this:

- Resolution is **depth- and cycle-guarded** (`MAX_COMPONENT_DEPTH`,
  `MAX_COMPONENT_MODELS`), and the cycle check runs *before* the memo, so a
  cached clean result can never mask a loop.
- `resolveComponents` takes the **already-walked index**. `getModel()` is a
  full tree walk, so resolving seven parts by slug would pay for seven of
  them; the detail page walks once via `cache(getModels)` and shares it.
- The rollup does not depend on the parent's filament — each component uses
  its own `cost_filament` — so it is resolved once and reused across every
  entry in the parent's filament dropdown.
- A component that cannot be priced gets a per-line `issue`, never silence:
  `missing`, `cycle`, `depth`, `limit`, `no-print`, `unpriceable`,
  `below-cost`. A too-low price must always look wrong.
- `lib/components.ts` is **pure** (like `customize-spec.ts`) because the
  editor's picker needs `COMPONENT_COST_PARTS` at runtime — importing that
  value from `lib/catalog.ts` drags `node:fs` into the browser bundle and
  fails the build.

There are four sanctioned writers, and everything else stays read-only:
`lib/write.ts` (a model's README), `lib/icons-import.ts` (a saved icon),
`lib/inventory-write.ts` (`catalog.yaml`'s `filaments:`, `supplies:`
and `cost:`) and `lib/supply-image.ts` (a supply's photo). Each owns a
path guard and its own invariant — for `write.ts` the "empty means delete"
rule and the promise that unknown keys and the markdown body survive; for
`inventory-write.ts`, that **every comment in `catalog.yaml` survives**.
It edits only those nodes via the `yaml` Document API, never a full dump —
and the `cost:` values are set **in place** (`setIn`) so the paragraph
above each one stays put.

`supply-image.ts` writes one file per supply, named after that supply's
id: the id is already lower-kebab and survives a rename, so a photo stays
attached to its supply and an orphan is identifiable in a git diff. It
re-sanitises the id (it cannot see where the caller got it), re-confirms
the destination inside the root, **sniffs the magic bytes** rather than
trusting the extension, and caps the size at 2 MB — the form downscales in
the browser, so this is the backstop, not the mechanism. It also deletes
the same supply's file under the other extensions, since a PNG replaced by
a WebP would otherwise stay committed and referenced by nothing. Deleting
a supply deletes its photo, from `deleteSupply`.

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

A supply also has a **page** at `/supplies/[id]`, which is a normal route
rather than a file one: the photo, the derived price, the whole purchase
history, and which models use it. It is where a supply line in a model's
cost breakdown links to, so "why does this part cost that?" leads to the
receipts. Its Edit button links back to `/supplies?edit=<id>`, which the
browser reads once on mount and then strips from the URL — cheaper than
lifting the form out of the modal to a second place.

`/font-files`, `/icon-files` and `/supply-files` are the same route over
the fonts, icons and supply-photo roots. All four share one
implementation — `serveFileFrom()` in `lib/serve.ts` — so the containment
check cannot drift between them; a new root is a root argument and eleven
lines, never a second copy of the check. Their URLs are built by
`lib/urls.ts`, the one module in `lib/` a client component may import.
