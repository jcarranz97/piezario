import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import { isExcluded, loadConfig } from "./config";
import { detectLicense, isLicenseFile } from "./license";

/**
 * The icons reader.
 *
 * A third tree, in the same spirit as `models/` and `fonts/`: `icons/` on disk
 * *is* the data. Drop an `.svg` in there and it shows up in the Icons tab on
 * the next refresh. Each SVG is one icon, and its parent folders are its
 * categories — exactly like a font.
 *
 * What icons add over fonts is **described groups**. A folder of icons may hold
 * a `README.md`; its YAML frontmatter (description, tags, source, license) then
 * describes every icon sitting directly in that folder. That is how you "save
 * details about them similar to the models" — a `README.md` next to the SVGs
 * turns a bare folder into a documented set. The README applies to the folder's
 * own icons, not to icons nested deeper, so each subfolder can describe itself.
 */

/** Metadata a folder's README.md contributes to the icons inside it. */
export interface IconGroupMeta {
  /** Folder path the README describes, e.g. "social". "" for the icons root. */
  path: string;
  description: string | null;
  tags: string[];
  source: string | null;
  license: string | null;
  /** README body with the frontmatter stripped. Empty when there is none. */
  body: string;
}

export interface Icon {
  /** Filename on disk, e.g. "instagram.svg". */
  file: string;
  /** Path relative to the icons root — also the URL for the /icon-files route. */
  relPath: string;
  /** Ancestor folders, e.g. ["social"]. Empty for an icon at the top level. */
  categories: string[];
  /** CSS-safe id, unique across the whole tree — used for anchors and keys. */
  id: string;
  /** Display name, e.g. "Instagram", derived from the filename. */
  name: string;
  size: number;
  /**
   * Metadata shared by every icon in this icon's folder, from that folder's
   * README.md. Null when the folder has no README. The `path` on it is what
   * lets the browser show a folder's description once rather than per icon.
   */
  group: IconGroupMeta | null;
  /**
   * A LICENSE file sitting in the icon's folder, if there is one. Icons often
   * arrive from a pack that ships a licence beside them.
   */
  licenseFile: { relPath: string; detected: string | null } | null;
}

/**
 * Absolute path to the icons folder. Defaults to `../icons` relative to the
 * app; `CATALOG_ICONS_DIR` overrides it, mirroring the models and fonts roots.
 */
export function iconsRoot(): string {
  return loadConfig().iconsDir;
}

/** Frontmatter values arrive as unknown; coerce them without throwing. */
function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

/** A YAML list, a comma-separated string or a bare scalar — all become tags. */
function asTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = asString(item);
    if (entry) {
      seen.add(entry.toLowerCase());
    }
  }
  return [...seen].sort();
}

/** "instagram-logo" → "Instagram logo", for an icon with no explicit name. */
function nameFromFile(file: string): string {
  const stem = file.slice(0, file.lastIndexOf("."));
  const words = stem.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toId(relPath: string): string {
  return relPath
    .slice(0, relPath.lastIndexOf("."))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** First non-heading paragraph of the README, when there is no `description:`. */
function descriptionFromBody(body: string): string | null {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || text.startsWith("#") || text.startsWith("!")) {
      continue;
    }
    return text.replace(/\s+/g, " ").replace(/[*_`[\]]/g, "").slice(0, 240);
  }
  return null;
}

/**
 * Walk the icons tree. Folders become categories exactly like `models/` and
 * `fonts/`. Before listing a folder's own SVGs, its README.md (if any) is read
 * once and its licence file located — both then apply to every icon in that
 * folder.
 */
async function walk(
  absDir: string,
  root: string,
  exclude: string[],
  out: Icon[],
): Promise<void> {
  const all = await fs.readdir(absDir, { withFileTypes: true }).catch(() => []);
  const entries = all.filter(
    (entry) =>
      !isExcluded(
        entry.name,
        path.relative(root, path.join(absDir, entry.name)),
        exclude,
      ),
  );

  const relDir = path.relative(root, absDir);
  const categories = relDir ? relDir.split(path.sep) : [];

  // The folder's README describes the icons directly in it.
  const readmeEntry = entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase() === "readme.md",
  );
  let group: IconGroupMeta | null = null;
  if (readmeEntry) {
    const raw = await fs
      .readFile(path.join(absDir, readmeEntry.name), "utf8")
      .catch(() => "");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const body = parsed.content.trim();
    group = {
      path: categories.join("/"),
      description: asString(data.description) ?? descriptionFromBody(body),
      tags: asTags(data.tags),
      source: asString(data.source),
      license: asString(data.license),
      body,
    };
  }

  // A licence in this folder applies to every icon in it.
  const licenseEntry = entries.find(
    (entry) => entry.isFile() && isLicenseFile(entry.name),
  );
  let licenseFile: Icon["licenseFile"] = null;
  if (licenseEntry) {
    const text = await fs
      .readFile(path.join(absDir, licenseEntry.name), "utf8")
      .catch(() => "");
    licenseFile = {
      relPath: path.relative(root, path.join(absDir, licenseEntry.name)),
      detected: detectLicense(text),
    };
  }

  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, root, exclude, out);
      continue;
    }
    if (path.extname(entry.name).toLowerCase() !== ".svg") {
      continue; // not an icon — the folder may hold a README, a licence, notes
    }
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) {
      continue;
    }
    const relPath = path.relative(root, abs);
    out.push({
      file: entry.name,
      relPath,
      categories,
      id: toId(relPath),
      name: nameFromFile(entry.name),
      size: stat.size,
      group,
      licenseFile,
    });
  }
}

export async function getIcons(): Promise<Icon[]> {
  const config = loadConfig();
  const root = config.iconsDir;
  const exists = await fs.stat(root).catch(() => null);
  if (!exists?.isDirectory()) {
    return [];
  }

  const icons: Icon[] = [];
  await walk(root, root, config.exclude, icons);
  icons.sort(
    (a, b) =>
      a.categories.join("/").localeCompare(b.categories.join("/")) ||
      a.name.localeCompare(b.name),
  );
  return icons;
}
