import {
  type FilamentColor,
  type FilamentItem,
  type SupplyItem,
  loadConfig,
} from "./config";

/**
 * The inventory reader.
 *
 * Filaments and supplies aren't a folder tree like `models/` — they live as two
 * sections inside `catalog.yaml`, parsed by `loadConfig()`. This module is the
 * thin read side over them: the tab pages call `getFilaments()` / `getSupplies()`,
 * and the cost code resolves a model's pinned filament and its supply lines back
 * to their catalog entries.
 *
 * Like everything else here, nothing is cached — the config is re-read on every
 * scan, so editing `catalog.yaml` and refreshing shows the change.
 */

export type { FilamentColor, FilamentItem, SupplyItem } from "./config";

/** Every filament spool, sorted by name for a stable tab order. */
export function getFilaments(): FilamentItem[] {
  return [...loadConfig().filaments].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/** Every supply, sorted by category then name. */
export function getSupplies(): SupplyItem[] {
  return [...loadConfig().supplies].sort(
    (a, b) =>
      (a.category ?? "").localeCompare(b.category ?? "") ||
      a.name.localeCompare(b.name),
  );
}

/** The supply with this id, or null. Ids are matched case-insensitively. */
export function resolveSupply(id: string | null): SupplyItem | null {
  if (!id) {
    return null;
  }
  const key = id.toLowerCase();
  return (
    loadConfig().supplies.find((item) => item.id.toLowerCase() === key) ?? null
  );
}
