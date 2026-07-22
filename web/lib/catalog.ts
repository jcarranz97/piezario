import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import { isExcluded, loadConfig, matchesPattern } from "./config";
import {
  type Capability,
  type FileKind,
  capabilitiesFor,
  classify,
} from "./files";
import { detectLicense, isLicenseFile } from "./license";

/**
 * The catalog reader.
 *
 * There is no database. `models/` *is* the database: every leaf folder is one
 * model, its parent folders are its categories, and everything the catalog
 * knows about it comes from the files inside plus the YAML frontmatter at the
 * top of its README.md. Nothing is cached — every page render re-walks the
 * tree, so editing a README and refreshing the browser shows the change.
 */


export interface LicenseFile {
  /** Path relative to the models root — the URL for the /files route. */
  relPath: string;
  name: string;
  /** "MIT", "CC BY-SA", … or null when the text isn't recognised. */
  detected: string | null;
}

export interface ModelFile {
  /**
   * Display name. For a file in an output folder this keeps the folder
   * prefix (`out/dogcup.3mf`) so it's obvious the file was generated.
   */
  name: string;
  /** Path relative to the models root — also the URL for the /files route. */
  relPath: string;
  kind: FileKind;
  size: number;
  /** True when the file came from an output folder rather than the model. */
  isOutput?: boolean;
}

/**
 * One supply line on a model: how many of a catalog supply it consumes. The
 * unit and unit price are not stored here — they live on the supply in
 * `catalog.yaml`, resolved by `id` when the cost is computed.
 */
export interface ModelSupply {
  /** The `id` of a supply in `catalog.yaml`. */
  item: string;
  /** How many units this part needs. */
  qty: number;
}

export interface Model {
  /** URL slug and unique id, e.g. "keychains/ysisi-nametag". */
  slug: string;
  /** Folder name, e.g. "ysisi-nametag". */
  dirName: string;
  /** Ancestor folders, e.g. ["keychains"]. Empty for a top-level model. */
  categories: string[];
  title: string;
  description: string;
  tags: string[];
  status: string | null;
  date: string | null;
  /** A part often prints in several, so this is a list. */
  materials: string[];
  /** A model may have been printed on more than one machine. */
  printers: string[];
  /** Saved slicer process/print profiles to load for this model. */
  profiles: string[];
  source: string | null;
  license: string | null;
  /** Consumables this part needs, resolved to prices against `catalog.yaml`. */
  supplies: ModelSupply[];
  /** Failure-risk level (low/medium/high); its factor buffers the cost. */
  failureRisk: string | null;
  /** Prep/clean/package time for this part, in minutes. */
  laborMinutes: number | null;
  /** Packaging consumables (bag, box…) this part needs, from the supplies catalog. */
  packaging: ModelSupply[];
  /** Shipping fee for this part; overrides the global default. */
  shippingCost: number | null;
  /** Profit markup % for this part; overrides the global default. */
  markupPercent: number | null;
  /** Preferred filament id to pre-select in the cost card's dropdown. */
  costFilament: string | null;
  /** A LICENSE file sitting in the folder, if there is one. */
  licenseFile: LicenseFile | null;
  /** README body with the frontmatter stripped. Empty when there is no README. */
  body: string;
  hasReadme: boolean;
  files: ModelFile[];
  kinds: FileKind[];
  capabilities: Capability[];
  /** relPath of the image to show in the grid, if any. */
  cover: string | null;
  /** Newest file mtime, used as the fallback sort key. */
  updatedAt: number;
}

/**
 * Absolute path to the models root.
 *
 * Defaults to `../models` relative to the app, which is the layout while the
 * catalog lives inside the models repo. `CATALOG_MODELS_DIR` overrides it, so
 * the app can be extracted into its own project later and pointed at any
 * repository without a code change.
 */
export function modelsRoot(): string {
  return loadConfig().modelsDir;
}

/** Frontmatter values arrive as unknown; coerce them without throwing. */
function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  // js-yaml turns an unquoted `2026-07-08` into a Date. Normalise to ISO so the
  // value stays a plain string all the way to the client.
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

/** A frontmatter scalar to a finite non-negative number, or null. */
function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A failure-risk level (low/medium/high), or null when unset/invalid. */
function asRiskLevel(value: unknown): string | null {
  const level = asString(value)?.toLowerCase();
  return level === "low" || level === "medium" || level === "high"
    ? level
    : null;
}

/**
 * A YAML list, a comma-separated string, or a bare scalar — all become an
 * array. Accepting a scalar is what keeps a hand-written `material: PLA`
 * working now that materials are a list.
 *
 * Case is preserved ("PETG" must not become "petg") and order is the author's,
 * since the first material listed is usually the one they actually printed in.
 * Duplicates are dropped case-insensitively.
 */
function asList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const out: string[] = [];
  for (const item of raw) {
    const entry = asString(item);
    if (entry && !out.some((seen) => seen.toLowerCase() === entry.toLowerCase())) {
      out.push(entry);
    }
  }
  return out;
}

/** Tags are additionally lowercased and sorted, so they group reliably. */
function asTags(value: unknown): string[] {
  return [...new Set(asList(value).map((tag) => tag.toLowerCase()))].sort();
}

/**
 * The `supplies:` frontmatter — a list of `{ item, qty }`. Unlike materials or
 * tags, each entry is an object, so `asList` (which drops non-strings) can't be
 * reused. Reading is lenient: `item`/`name`/`id` all name the supply, `qty`/
 * `count` both give the count. An entry with no name or a non-positive count is
 * skipped; a same-item entry is merged so a duplicated line adds up rather than
 * overwriting.
 */
function asSupplies(value: unknown): ModelSupply[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ModelSupply[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const row = raw as Record<string, unknown>;
    const item = asString(row.item ?? row.name ?? row.id);
    const qty = Number(row.qty ?? row.count ?? 1);
    if (!item || !Number.isFinite(qty) || qty <= 0) {
      continue;
    }
    const existing = out.find(
      (entry) => entry.item.toLowerCase() === item.toLowerCase(),
    );
    if (existing) {
      existing.qty += qty;
    } else {
      out.push({ item, qty });
    }
  }
  return out;
}

/** "ysisi-nametag" → "Ysisi nametag", for models with no frontmatter title. */
function titleFromDirName(dirName: string): string {
  const words = dirName.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** First non-heading paragraph of the README, for models with no description. */
function descriptionFromBody(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || text.startsWith("#") || text.startsWith("!")) {
      continue;
    }
    return text.replace(/\s+/g, " ").replace(/[*_`[\]]/g, "").slice(0, 240);
  }
  return "";
}

/**
 * Pick the grid image. An explicit `cover:` in the frontmatter wins; otherwise
 * prefer a file that looks like a deliberate preview, then any image at all.
 */
function pickCover(files: ModelFile[], declared: string | null): string | null {
  const images = files.filter((file) => file.kind === "image");
  if (declared) {
    const match = images.find((file) => file.name === declared);
    if (match) {
      return match.relPath;
    }
  }
  const preferred = images.find((file) =>
    /^cover\.|preview|_render/i.test(file.name),
  );
  return (preferred ?? images[0])?.relPath ?? null;
}

/**
 * Collect the files inside a model's output folders.
 *
 * These belong to the model — a generator's `out/` holds the very meshes you
 * came to print — but they aren't a model of their own, so they're gathered
 * here and flagged rather than being walked into as a separate folder.
 * Recurses, since `out/` sometimes has a folder per variant.
 */
async function readOutputFiles(
  absDir: string,
  root: string,
  modelDir: string,
  exclude: string[],
  out: ModelFile[],
): Promise<number> {
  let newest = 0;
  const entries = await fs
    .readdir(absDir, { withFileTypes: true })
    .catch(() => []);

  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (isExcluded(entry.name, path.relative(root, abs), exclude)) {
      continue;
    }
    if (entry.isDirectory()) {
      newest = Math.max(
        newest,
        await readOutputFiles(abs, root, modelDir, exclude, out),
      );
      continue;
    }
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat?.isFile()) {
      continue;
    }
    newest = Math.max(newest, stat.mtimeMs);
    out.push({
      name: path.relative(modelDir, abs).split(path.sep).join("/"),
      relPath: path.relative(root, abs),
      kind: classify(entry.name),
      size: stat.size,
      isOutput: true,
    });
  }
  return newest;
}

async function readModel(
  absDir: string,
  root: string,
  entries: string[],
  outputSubdirs: string[],
  exclude: string[],
): Promise<Model> {
  const relDir = path.relative(root, absDir);
  const segments = relDir.split(path.sep);

  const files: ModelFile[] = [];
  let updatedAt = 0;
  for (const name of entries) {
    const stat = await fs.stat(path.join(absDir, name)).catch(() => null);
    if (!stat?.isFile()) {
      continue;
    }
    updatedAt = Math.max(updatedAt, stat.mtimeMs);
    files.push({
      name,
      relPath: path.join(relDir, name),
      kind: classify(name),
      size: stat.size,
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));

  // Generated files come after the model's own, already sorted among themselves.
  const outputFiles: ModelFile[] = [];
  for (const subdir of outputSubdirs) {
    updatedAt = Math.max(
      updatedAt,
      await readOutputFiles(
        path.join(absDir, subdir),
        root,
        absDir,
        exclude,
        outputFiles,
      ),
    );
  }
  outputFiles.sort((a, b) => a.name.localeCompare(b.name));
  files.push(...outputFiles);

  const readme = files.find((file) => file.name.toLowerCase() === "readme.md");
  let data: Record<string, unknown> = {};
  let body = "";
  if (readme) {
    const raw = await fs.readFile(path.join(absDir, readme.name), "utf8");
    const parsed = matter(raw);
    data = parsed.data as Record<string, unknown>;
    body = parsed.content.trim();
  }

  const kinds = [...new Set(files.map((file) => file.kind))];

  // Only read the licence when there is one; the head of the file is enough to
  // name it, so a long GPL doesn't cost anything extra.
  const licenseEntry = files.find((file) => isLicenseFile(file.name));
  let licenseFile: LicenseFile | null = null;
  if (licenseEntry) {
    const text = await fs
      .readFile(path.join(absDir, licenseEntry.name), "utf8")
      .catch(() => "");
    licenseFile = {
      relPath: licenseEntry.relPath,
      name: licenseEntry.name,
      detected: detectLicense(text),
    };
  }

  return {
    slug: segments.join("/"),
    dirName: segments[segments.length - 1],
    categories: segments.slice(0, -1),
    title: asString(data.title) ?? titleFromDirName(segments[segments.length - 1]),
    description: asString(data.description) ?? descriptionFromBody(body),
    tags: asTags(data.tags),
    status: asString(data.status),
    date: asString(data.date),
    // `material:` (singular) is the pre-list spelling; still read so older
    // hand-written READMEs keep working. Saving migrates them to `materials:`.
    materials: asList(data.materials ?? data.material),
    // `printer:` (singular) is the pre-list spelling; see `materials` above.
    printers: asList(data.printers ?? data.printer),
    // Named slicer presets to load; `profile:` (singular) also accepted.
    profiles: asList(data.profiles ?? data.profile),
    source: asString(data.source),
    license: asString(data.license),
    supplies: asSupplies(data.supplies),
    failureRisk: asRiskLevel(data.failure_risk),
    laborMinutes: asNumber(data.labor_minutes),
    packaging: asSupplies(data.packaging),
    // `packaging_cost` was the pre-split flat fee; read it as the shipping fee.
    shippingCost: asNumber(data.shipping_cost ?? data.packaging_cost),
    markupPercent: asNumber(data.markup_percent),
    costFilament: asString(data.cost_filament),
    licenseFile,
    body,
    hasReadme: Boolean(readme),
    files,
    kinds,
    capabilities: capabilitiesFor(kinds),
    cover: pickCover(files, asString(data.cover)),
    updatedAt,
  };
}

/**
 * Walk the tree. A folder is a **model** when it has no subfolders of its own;
 * otherwise it is a **category** and we recurse. That rule means you can nest
 * `models/keychains/pets/chispi/` as deep as you like and the catalog keeps up
 * without any configuration.
 */
async function walk(
  absDir: string,
  root: string,
  exclude: string[],
  outputDirs: string[],
  out: Model[],
): Promise<void> {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const visible = entries.filter(
    (entry) =>
      !isExcluded(
        entry.name,
        path.relative(root, path.join(absDir, entry.name)),
        exclude,
      ),
  );
  const files = visible.filter((entry) => entry.isFile()).map((e) => e.name);

  // An output folder doesn't make its parent a category — it belongs to it.
  // Without this, a generator's `out/` would demote the folder holding the
  // script and the README into a mere container, hiding both.
  const allSubdirs = visible.filter((entry) => entry.isDirectory());
  const outputSubdirs = allSubdirs
    .filter((entry) =>
      matchesPattern(
        entry.name,
        path.relative(root, path.join(absDir, entry.name)),
        outputDirs,
      ),
    )
    .map((entry) => entry.name);
  const categorySubdirs = allSubdirs.filter(
    (entry) => !outputSubdirs.includes(entry.name),
  );

  if (categorySubdirs.length === 0) {
    // Leaf. An empty folder is not a model, but one with only output is.
    if (files.length > 0 || outputSubdirs.length > 0) {
      out.push(
        await readModel(absDir, root, files, outputSubdirs, exclude),
      );
    }
    return;
  }

  for (const subdir of categorySubdirs) {
    await walk(path.join(absDir, subdir.name), root, exclude, outputDirs, out);
  }
}

/** Every model in the repo, newest-looking first. */
export async function getModels(): Promise<Model[]> {
  const config = loadConfig();
  const root = config.modelsDir;
  const exists = await fs.stat(root).catch(() => null);
  if (!exists?.isDirectory()) {
    return [];
  }
  const models: Model[] = [];
  await walk(root, root, config.exclude, config.outputDirs, models);
  models.sort((a, b) => {
    // An explicit date is a stronger signal than a file timestamp.
    if (a.date && b.date && a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    if (a.date !== b.date) {
      return a.date ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt || a.title.localeCompare(b.title);
  });
  return models;
}

export async function getModel(slug: string): Promise<Model | null> {
  const models = await getModels();
  return models.find((model) => model.slug === slug) ?? null;
}
