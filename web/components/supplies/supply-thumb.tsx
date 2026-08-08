import { LuImage } from "react-icons/lu";

import { supplyImageUrl } from "@/lib/urls";

/**
 * A supply's photo at thumbnail size, or a placeholder when it has none.
 *
 * Shared by the Supplies tab, the model editor's picker and the cost
 * breakdown, so a supply looks the same wherever it is named — which is the
 * whole point of the photo: `bolsa-de-celofan-5x3` is not a description.
 *
 * A plain `<img>` rather than `next/image`: these are local files served by
 * `/supply-files` with `no-store`, so the optimiser has nothing to add.
 */
export function SupplyThumb({
  image,
  alt,
  size = 56,
}: {
  image: string | null;
  /** The supply's name — the picture is decorative beside it, so this is "". */
  alt?: string;
  size?: number;
}) {
  const style = { width: size, height: size };

  if (!image) {
    return (
      <div
        aria-hidden
        style={style}
        className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--card-border)] text-muted"
      >
        <LuImage style={{ width: size / 3, height: size / 3 }} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={supplyImageUrl(image)}
      alt={alt ?? ""}
      style={style}
      className="shrink-0 rounded-lg border border-[var(--card-border)] object-cover"
    />
  );
}
