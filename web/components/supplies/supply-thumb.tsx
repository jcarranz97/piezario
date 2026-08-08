import { Thumb } from "@/components/common/thumb";
import { supplyImageUrl } from "@/lib/urls";

/**
 * A supply's photo at thumbnail size, or a placeholder when it has none.
 *
 * Shared by the Supplies tab, the model editor's picker and the cost
 * breakdown, so a supply looks the same wherever it is named — which is the
 * whole point of the photo: `bolsa-de-celofan-5x3` is not a description.
 *
 * The picture itself is `Thumb`; what this adds is the one thing specific to a
 * supply — that the stored value is a bare filename under `/supply-files`.
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
  return (
    <Thumb
      src={image ? supplyImageUrl(image) : null}
      alt={alt}
      size={size}
    />
  );
}
