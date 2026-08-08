/**
 * How supply numbers and links are written on screen.
 *
 * Shared by the tab, the form and a supply's own page, so the same price never
 * reads two different ways depending on where you are looking at it.
 */

export function money(value: number | null, currency: string): string {
  return value === null ? "—" : `${currency}${value.toFixed(2)}`;
}

/**
 * The price of one unit.
 *
 * Two decimals is right for a price someone typed, but a bag of 13 for $5 is
 * $0.3846 and rounding that to $0.38 would make two different bags look
 * identical. Below a whole unit of currency, keep four digits and trim the
 * zeros — but never below two, since $0.5 reads like a typo where $0.50
 * doesn't.
 */
export function perUnit(value: number | null, currency: string): string {
  if (value === null) {
    return "—";
  }
  if (value >= 1) {
    return `${currency}${value.toFixed(2)}`;
  }
  const trimmed = value.toFixed(4).replace(/0+$/, "");
  const padded = trimmed.replace(/\.$/, ".00").replace(/\.(\d)$/, ".$10");
  return `${currency}${padded}`;
}

/**
 * "13 pieces", but "100 cm".
 *
 * Units are free-form, and the word-like ones (piece, gram, pair) pluralise
 * while the abbreviations (cm, ml) do not — length is what tells them apart.
 */
export function plural(count: number, unit: string | null): string {
  const word = unit?.trim() || "units";
  const s =
    count !== 1 && word.length > 2 && !word.endsWith("s") ? `${word}s` : word;
  return `${count} ${s}`;
}

/** "amazon.com" — what the link is worth showing of itself. */
export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
