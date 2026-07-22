import fs from "node:fs/promises";
import path from "node:path";

import { modelsRoot } from "./catalog";
import { fontsRoot } from "./fonts";
import { iconsRoot } from "./icons";

/**
 * Turning a browser-supplied path into a real location on disk.
 *
 * Writing a README, opening a folder, opening a file — all three act on a path
 * that arrived from the browser, so all three need the same guarantee: the
 * resolved path really is inside the tree it claims to be in. One
 * implementation, so they can never drift apart.
 */

export class CatalogError extends Error {}

/** Which tree a path is relative to. */
export type CatalogRoot = "models" | "fonts" | "icons";

export function rootDir(root: CatalogRoot): string {
  switch (root) {
    case "fonts":
      return fontsRoot();
    case "icons":
      return iconsRoot();
    default:
      return modelsRoot();
  }
}

/**
 * Resolve `relPath` inside `root` and confirm it stayed there.
 *
 * Resolving first and comparing afterwards is the point: `..` segments and
 * symlinks only collapse once the path is resolved, so checking the raw string
 * would let both through.
 */
async function resolveInside(
  root: string,
  relPath: string,
  expect: "file" | "directory",
): Promise<string> {
  const target = path.resolve(root, relPath);

  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw new CatalogError("That path is outside the catalog.");
  }

  const stat = await fs.stat(target).catch(() => null);
  const ok = expect === "file" ? stat?.isFile() : stat?.isDirectory();
  if (!ok) {
    throw new CatalogError(`That ${expect} no longer exists.`);
  }
  return target;
}

/** A file in either tree. */
export function resolveCatalogFile(
  relPath: string,
  root: CatalogRoot = "models",
): Promise<string> {
  return resolveInside(rootDir(root), relPath, "file");
}

/** A model's folder. */
export function resolveModelDir(slug: string): Promise<string> {
  return resolveInside(modelsRoot(), slug, "directory");
}
