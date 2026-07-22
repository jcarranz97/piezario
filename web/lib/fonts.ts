import fs from "node:fs/promises";
import path from "node:path";

import { isExcluded, loadConfig } from "./config";
import { detectLicense, isLicenseFile } from "./license";
import { fontUrl } from "./urls";

/**
 * The fonts reader.
 *
 * Same idea as the models tree: `fonts/` on disk *is* the data. Drop a `.ttf`
 * in there and it shows up in the Fonts tab on the next refresh. Everything the
 * catalog knows about a font is inferred from its filename, because that is the
 * only metadata a bare font file reliably carries.
 */

const FORMATS: Record<string, string> = {
  ".ttf": "truetype",
  ".otf": "opentype",
  ".woff": "woff",
  ".woff2": "woff2",
};

export interface Font {
  /** Filename on disk, e.g. "SairaCondensed-Bold.ttf". */
  file: string;
  /** Path relative to the fonts root — also the URL for the /font-files route. */
  relPath: string;
  /** Ancestor folders, e.g. ["Chewy"]. Empty for a font at the top level. */
  categories: string[];
  /** CSS-safe id, used as the generated font-family name. */
  id: string;
  /** Display family, e.g. "Saira Condensed". */
  family: string;
  /** Display style, e.g. "Bold". "Regular" when the name carries none. */
  style: string;
  /** CSS `format()` hint for the @font-face rule. */
  format: string;
  size: number;
  /**
   * A LICENSE file next to the font. Fonts almost always ship one — the folder
   * that carries it is exactly the folder `flattenPackagingFolders` hides, so
   * the licence has to be attached to the font itself or it becomes
   * unreachable.
   */
  licenseFile: { relPath: string; detected: string | null } | null;
}

/**
 * Absolute path to the fonts folder. Defaults to `../fonts` relative to the
 * app; `CATALOG_FONTS_DIR` overrides it, mirroring `CATALOG_MODELS_DIR`.
 */
export function fontsRoot(): string {
  return loadConfig().fontsDir;
}

/** "SairaCondensed" → "Saira Condensed"; "Oxanium" → "Oxanium". */
function splitCamelCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/**
 * Pull a family and a style out of the filename.
 *
 * Font files are named `Family-Style.ttf` by near-universal convention
 * ("SairaCondensed-Bold"), so the first `-`/`_` separates the two. A name with
 * no separator is the regular weight of that family.
 */
function parseName(file: string): { family: string; style: string } {
  const stem = file.slice(0, file.lastIndexOf("."));
  const [rawFamily, ...rest] = stem.split(/[-_]/);
  return {
    family: splitCamelCase(rawFamily) || stem,
    style: rest.length > 0 ? splitCamelCase(rest.join(" ")) : "Regular",
  };
}

function toId(file: string): string {
  return file
    .slice(0, file.lastIndexOf("."))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Walk the fonts tree. Folders become categories, exactly like `models/` —
 * font downloads usually arrive as a folder per family (the font plus its
 * licence and a specimen), so nesting is the normal case, not the exception.
 */
async function walk(
  absDir: string,
  root: string,
  exclude: string[],
  out: Font[],
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

  // A licence in this folder applies to every font in it.
  const licenseEntry = entries.find(
    (entry) => entry.isFile() && isLicenseFile(entry.name),
  );
  let licenseFile: Font["licenseFile"] = null;
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
    const format = FORMATS[path.extname(entry.name).toLowerCase()];
    if (!format) {
      continue; // not a font — the folder may hold licences, notes, specimens
    }
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) {
      continue;
    }
    const relPath = path.relative(root, abs);
    const segments = relPath.split(path.sep);
    const { family, style } = parseName(entry.name);
    out.push({
      file: entry.name,
      relPath,
      categories: segments.slice(0, -1),
      // The id becomes a CSS font-family name, so it must be unique across the
      // whole tree — two folders may each hold a "Regular.ttf".
      id: toId(relPath),
      family,
      style,
      format,
      size: stat.size,
      licenseFile,
    });
  }
}

/**
 * Drop folders that exist only to package a single font.
 *
 * A font downloaded from Google Fonts arrives as a folder holding the `.ttf`
 * plus its licence and a specimen — the folder is packaging, not a category,
 * and showing it in the tree adds a level you have to open to find one thing.
 * A folder holding *several* fonts is a real grouping (a family and its
 * weights) and is kept.
 *
 * The rule: a folder whose whole subtree contains exactly one font contributes
 * no category. Applied repeatedly, so `fonts/A/B/only.ttf` collapses all the
 * way up rather than stopping after one level. The font's `relPath` is
 * untouched — it still lives where it lives on disk.
 */
function flattenPackagingFolders(fonts: Font[]): Font[] {
  for (let changed = true; changed; ) {
    changed = false;

    const perDirectory = new Map<string, number>();
    for (const font of fonts) {
      const dir = font.categories.join("/");
      if (dir) {
        perDirectory.set(dir, (perDirectory.get(dir) ?? 0) + 1);
      }
    }

    for (const font of fonts) {
      if (font.categories.length === 0) {
        continue;
      }
      const dir = font.categories.join("/");
      const hasFontsDeeper = [...perDirectory.keys()].some(
        (other) => other !== dir && other.startsWith(`${dir}/`),
      );
      if (perDirectory.get(dir) === 1 && !hasFontsDeeper) {
        font.categories = font.categories.slice(0, -1);
        changed = true;
      }
    }
  }
  return fonts;
}

export async function getFonts(): Promise<Font[]> {
  const config = loadConfig();
  const root = config.fontsDir;
  const exists = await fs.stat(root).catch(() => null);
  if (!exists?.isDirectory()) {
    return [];
  }

  const fonts: Font[] = [];
  await walk(root, root, config.exclude, fonts);
  flattenPackagingFolders(fonts);
  fonts.sort(
    (a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style),
  );
  return fonts;
}

/**
 * The `@font-face` block for every font found.
 *
 * Emitted into the page as a plain <style> tag rather than loaded through
 * `next/font`, because the set isn't known at build time — it is whatever is
 * sitting in the folder when the request arrives.
 */
export function fontFaceCss(fonts: Font[]): string {
  return fonts
    .map(
      (font) => `@font-face {
  font-family: "${font.id}";
  src: url("${fontUrl(font.relPath)}") format("${font.format}");
  font-display: swap;
}`,
    )
    .join("\n");
}
