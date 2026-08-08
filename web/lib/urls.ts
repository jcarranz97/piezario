/**
 * URL builders.
 *
 * Model folders and files are named by hand, so they contain spaces, `+` and
 * other characters that mean something in a URL ("GAME+BOY+AND+GBA
 * KEYCHAINS.3mf"). Always build links through these helpers: they encode each
 * path segment separately, keeping the `/` separators intact.
 */

function encodePath(relPath: string): string {
  return relPath.split("/").map(encodeURIComponent).join("/");
}

/**
 * Link to a file inside models/ — cover images and the pictures a README
 * references. Model files themselves are opened on the desktop rather than
 * downloaded, so this has no download variant.
 */
export function fileUrl(relPath: string): string {
  return `/files/${encodePath(relPath)}`;
}

/** Link to a model's detail page. */
export function modelUrl(slug: string): string {
  return `/models/${encodePath(slug)}`;
}

/**
 * Link to a font file, for `@font-face` and for downloads.
 *
 * This lives here rather than in `lib/fonts.ts` on purpose: the font browser is
 * a client component, and importing anything from `fonts.ts` would drag its
 * `node:fs` dependency into the browser bundle.
 */
export function fontUrl(
  relPath: string,
  options?: { download?: boolean },
): string {
  // Per-segment, not encodeURIComponent on the whole thing: fonts live in
  // subfolders now, and the "/" separators must survive.
  const url = `/font-files/${encodePath(relPath)}`;
  return options?.download ? `${url}?download` : url;
}

/**
 * Link to an icon file, for the `<img>` preview and for downloads.
 *
 * Lives here for the same reason as `fontUrl`: the icon browser is a client
 * component, so it must not import anything from `lib/icons.ts` (which touches
 * `node:fs`). Icons sit in subfolders, so each segment is encoded separately.
 */
export function iconUrl(
  relPath: string,
  options?: { download?: boolean },
): string {
  const url = `/icon-files/${encodePath(relPath)}`;
  return options?.download ? `${url}?download` : url;
}

/**
 * Link to a supply's photo. The stored value is a bare filename inside the
 * supply images folder, but it still goes through `encodePath` — an id is
 * lower-kebab, yet a file put there by hand need not be.
 *
 * Here rather than in `lib/inventory.ts` for the same reason as the two above:
 * the supplies browser and the model editor's picker are client components.
 */
export function supplyImageUrl(filename: string): string {
  return `/supply-files/${encodePath(filename)}`;
}

/** Link to a supply's page — its photo, its price, and every purchase of it. */
export function supplyUrl(id: string): string {
  return `/supplies/${encodeURIComponent(id)}`;
}
