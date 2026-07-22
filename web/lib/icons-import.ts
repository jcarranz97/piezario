import fs from "node:fs/promises";
import path from "node:path";

import { iconsRoot } from "./icons";
import { CatalogError } from "./model-path";

/**
 * Pull one online icon onto disk, into the icons tree.
 *
 * This is the only code that writes to `icons/`, so it owns the guards — the
 * same shape `lib/write.ts` owns for model READMEs:
 *
 *  - the **source** is locked to svgapi's CDN over https. The URL arrives from
 *    the browser, so without this the action would fetch any URL the caller
 *    named — an SSRF into whatever the server can reach.
 *  - the **destination** is resolved and confirmed to still sit inside the
 *    icons root, so a crafted folder segment can't write elsewhere.
 *  - the **filename** is derived from the CDN slug, sanitised, and made unique
 *    rather than overwriting an icon that's already there.
 *
 * Once written the file is an ordinary local icon: the next scan picks it up
 * with no further special-casing.
 */

const CDN_HOST = "cdn.svgapi.com";

/** Keep a path segment to a safe, single-level name. */
function safeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** "Map Pin.svg" → "map-pin". */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.svg$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "icon"
  );
}

export async function importOnlineIcon(
  url: string,
  folder: string[],
): Promise<{ relPath: string; name: string }> {
  let source: URL;
  try {
    source = new URL(url);
  } catch {
    throw new CatalogError("That icon URL is not valid.");
  }
  if (source.protocol !== "https:" || source.hostname !== CDN_HOST) {
    throw new CatalogError("That icon isn't served from the svgapi CDN.");
  }

  const root = iconsRoot();
  const rootStat = await fs.stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new CatalogError("The icons folder doesn't exist yet.");
  }

  // Resolve the destination folder and confirm it stayed inside the root.
  const cleanFolder = folder.map(safeSegment).filter(Boolean);
  const dir = path.resolve(root, ...cleanFolder);
  const relDir = path.relative(root, dir);
  if (relDir.startsWith("..") || path.isAbsolute(relDir)) {
    throw new CatalogError("That folder is outside the catalog.");
  }
  const dirStat = await fs.stat(dir).catch(() => null);
  if (!dirStat?.isDirectory()) {
    throw new CatalogError("The selected folder no longer exists.");
  }

  const response = await fetch(source, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) {
    throw new CatalogError("Could not download that icon.");
  }
  const svg = await response.text();
  if (!/<svg[\s>]/i.test(svg)) {
    throw new CatalogError("That download wasn't an SVG.");
  }

  // Name from the CDN slug; on a collision, add a counter rather than clobber.
  const base = slugify(path.basename(source.pathname));
  let filename = `${base}.svg`;
  for (
    let n = 1;
    await fs
      .stat(path.join(dir, filename))
      .then(() => true)
      .catch(() => false);
    n += 1
  ) {
    filename = `${base}-${n}.svg`;
  }

  const target = path.join(dir, filename);
  await fs.writeFile(target, svg, "utf8");
  return {
    relPath: path.relative(root, target).split(path.sep).join("/"),
    name: filename,
  };
}
