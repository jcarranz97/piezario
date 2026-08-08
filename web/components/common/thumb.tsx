import { LuImage } from "react-icons/lu";

/**
 * A square picture at thumbnail size, or a dashed placeholder when there is
 * none.
 *
 * The placeholder is the reason this is shared rather than written twice: a
 * breakdown row keeps its alignment whether or not the thing it names has a
 * picture, so a supply with no photo and a component with no cover leave the
 * same gap. Callers pass a finished URL — `supplyImageUrl` for a supply's
 * photo, `fileUrl` for a model's cover — since the two live under different
 * file routes.
 *
 * A plain `<img>` rather than `next/image`: these are local files served with
 * `no-store`, so the optimiser has nothing to add.
 */
export function Thumb({
  src,
  alt,
  size = 56,
}: {
  src: string | null;
  /** The name it sits beside — the picture is decorative there, so this is "". */
  alt?: string;
  size?: number;
}) {
  const style = { width: size, height: size };

  if (!src) {
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
      src={src}
      alt={alt ?? ""}
      style={style}
      className="shrink-0 rounded-lg border border-[var(--card-border)] object-cover"
    />
  );
}
