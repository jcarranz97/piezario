import fs from "node:fs/promises";
import path from "node:path";

import { suppliesRoot } from "./inventory";
import { CatalogError } from "./model-path";

/**
 * Put one supply's photo on disk, and take it off again.
 *
 * A supply named `bolsa-de-celofan-5x3` tells you nothing about which bag it
 * is; a picture settles it at a glance. This is the only code that writes to
 * the supply images folder, so — like `lib/icons-import.ts` — it owns the
 * guards:
 *
 *  - the **name** is the supply's own id, which is already lower-kebab
 *    (`normaliseId` in `lib/inventory-write.ts`) and stable across a rename,
 *    so a photo stays attached to its supply and an orphan is identifiable by
 *    eye in a git diff. It is sanitised again here regardless: this module
 *    can't see where the id came from.
 *  - the **destination** is resolved and re-confirmed inside the root, so a
 *    crafted id can't write elsewhere.
 *  - the **content** is sniffed, not trusted. The extension arrives from the
 *    browser; the magic bytes don't.
 *  - the **size** is capped. The form downscales before uploading, so this is
 *    the backstop for anything that skips it.
 *
 * The written file is committed to the catalog repo alongside the yaml, which
 * is why keeping it small matters more than keeping it pristine.
 */

/** Formats a browser can both produce and display. */
const TYPES = [
  { ext: ".webp", magic: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" (…WEBP)
  { ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ".jpg", magic: [0xff, 0xd8, 0xff] },
] as const;

/**
 * 2 MB. The browser sends ~50 KB after downscaling, so anything near this is
 * something that didn't go through the form.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/** The same shape `normaliseId` produces, applied again — never trust a caller. */
function safeName(id: string): string {
  const name = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) {
    throw new CatalogError("That supply has no usable id for an image name.");
  }
  return name;
}

/** Resolve inside the supply images root, or refuse. */
function inRoot(root: string, filename: string): string {
  const target = path.resolve(root, filename);
  const rel = path.relative(root, target);
  // A separator means a caller slipped a folder in where a filename belongs.
  if (
    rel.startsWith("..") ||
    path.isAbsolute(rel) ||
    rel === "" ||
    rel.includes(path.sep)
  ) {
    throw new CatalogError("That image path is outside the catalog.");
  }
  return target;
}

/** Which of the accepted formats these bytes actually are, or null. */
function sniff(bytes: Uint8Array): (typeof TYPES)[number] | null {
  return (
    TYPES.find((type) =>
      type.magic.every((byte, index) => bytes[index] === byte),
    ) ?? null
  );
}

/**
 * Write `file` as this supply's photo and return the filename to store in
 * `catalog.yaml`. Replaces whatever that supply had before, including under a
 * different extension.
 */
export async function saveSupplyImage(id: string, file: File): Promise<string> {
  if (file.size === 0) {
    throw new CatalogError("That image file is empty.");
  }
  if (file.size > MAX_BYTES) {
    throw new CatalogError("That image is too large — keep it under 2 MB.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) {
    throw new CatalogError("That file isn't a WebP, PNG or JPEG image.");
  }

  const root = suppliesRoot();
  // Unlike icons, this folder is allowed not to exist yet: it holds nothing a
  // person puts there by hand, so the first saved photo creates it.
  await fs.mkdir(root, { recursive: true });

  const base = safeName(id);
  const filename = `${base}${type.ext}`;
  const target = inRoot(root, filename);
  await fs.writeFile(target, bytes);

  // A png replaced by a webp would otherwise leave the png behind, still
  // committed and no longer referenced.
  await Promise.all(
    TYPES.filter((other) => other.ext !== type.ext).map((other) =>
      fs.rm(path.join(root, `${base}${other.ext}`), { force: true }),
    ),
  );

  return filename;
}

/** Remove a supply's photo. A no-op when there isn't one. */
export async function deleteSupplyImage(
  filename: string | null | undefined,
): Promise<void> {
  if (!filename?.trim()) {
    return;
  }
  // A stored name that no longer resolves inside the root is left alone rather
  // than reported: the caller is usually deleting the supply anyway.
  let target: string;
  try {
    target = inRoot(suppliesRoot(), filename.trim());
  } catch {
    return;
  }
  await fs.rm(target, { force: true });
}
