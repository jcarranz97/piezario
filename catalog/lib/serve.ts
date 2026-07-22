import fs from "node:fs/promises";
import path from "node:path";

/**
 * Serving files from a directory outside the Next app.
 *
 * Both the models tree and the fonts folder live outside `catalog/`, so
 * `public/` can't reach either — cover images, README pictures and the font
 * files behind `@font-face` all come through here. Everything is local and
 * read-only, but the path is still resolved and checked against its root so a
 * crafted `../../` URL can't walk out and serve arbitrary files off the
 * machine. One implementation, so that check can never drift between routes.
 */

const INLINE_TYPES: Record<string, string> = {
  // Images.
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  // Text.
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".scad": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  // Fonts must be inline: the browser fetches these itself to satisfy an
  // @font-face rule, and an attachment disposition would defeat that.
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function serveFileFrom(
  root: string,
  segments: string[],
  request: Request,
): Promise<Response> {
  const target = path.resolve(root, ...segments);

  // Containment check: resolve first, then confirm the result is still under
  // the root. Comparing the raw segments is not enough — symlinks and `..`
  // only collapse after resolution.
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(target).toLowerCase();
  const inlineType = INLINE_TYPES[ext];
  const download = new URL(request.url).searchParams.has("download");

  const body = await fs.readFile(target);
  const disposition =
    inlineType && !download
      ? "inline"
      : `attachment; filename="${path.basename(target).replace(/"/g, "")}"`;

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": inlineType ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": disposition,
      // Local files change as you work; never let the browser hold a stale one.
      "Cache-Control": "no-store",
    },
  });
}
