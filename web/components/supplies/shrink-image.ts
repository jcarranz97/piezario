/**
 * Shrink a picked photo before it is uploaded.
 *
 * Supply photos are committed to the catalog repo, and a phone photo is several
 * megabytes for a thumbnail that renders at 64px. Doing this in the browser
 * rather than on the server keeps a native image dependency out of the Electron
 * build — and re-encoding drops the EXIF block on the way, so a photo taken in
 * the workshop doesn't carry its GPS tag into git.
 *
 * Lives beside the component rather than in `lib/` on purpose: `lib/urls.ts` is
 * the one module there that a client component may import, and this touches
 * browser-only APIs that must never end up in a server bundle.
 */

/** Long edge of the stored photo. Comfortably above the largest thumbnail. */
const MAX_EDGE = 640;

const QUALITY = 0.85;

export async function shrinkToWebp(source: File): Promise<File> {
  // `from-image` applies the EXIF orientation, so a portrait photo doesn't
  // arrive on its side once the canvas has stripped that tag.
  const bitmap = await createImageBitmap(source, {
    imageOrientation: "from-image",
  }).catch(() => null);
  if (!bitmap) {
    return source;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      return source;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", QUALITY);
    });
    // A browser that can't encode WebP returns null, or quietly hands back a
    // PNG. Either way the original is fine — the server accepts PNG and JPEG
    // too, and caps the size itself.
    if (!blob || blob.type !== "image/webp") {
      return source;
    }
    return new File([blob], "supply.webp", { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}
