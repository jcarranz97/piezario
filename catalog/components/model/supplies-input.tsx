"use client";

import { Button } from "@heroui/react";
import { useState } from "react";
import { LuPlus, LuTrash2 } from "react-icons/lu";

import type { ModelSupply } from "@/lib/catalog";
import type { SupplyItem } from "@/lib/inventory";

// No-width base so each row can size its inputs (flex-1, w-24) without a
// `w-full` overriding them.
const INPUT =
  "rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

/**
 * The supplies editor: a repeatable list of `{ item, qty }` rows.
 *
 * `TagInput` can't hold a count next to each name, so this is its structured
 * cousin — a supply `<select>` (options are the catalog's supplies) plus a
 * quantity, with add/remove. The whole list is serialised into one hidden JSON
 * field the save action parses, mirroring how `TagInput` mirrors into a hidden
 * comma field. The unit shown next to the quantity comes from the chosen
 * supply, so "2" reads as "2 pieces" without the model storing the unit.
 */
export function SuppliesInput({
  name,
  label = "Supplies",
  addLabel = "Add supply",
  emptyHint = "None. Add a chain, a ring, or anything else this part needs.",
  defaultSupplies,
  catalog,
}: {
  name: string;
  /** Heading text — "Supplies" or "Packaging". */
  label?: string;
  /** The add-button text. */
  addLabel?: string;
  /** Placeholder shown when the list is empty. */
  emptyHint?: string;
  defaultSupplies: ModelSupply[];
  catalog: SupplyItem[];
}) {
  const [rows, setRows] = useState<ModelSupply[]>(
    defaultSupplies.length > 0 ? defaultSupplies : [],
  );

  const byId = new Map(catalog.map((s) => [s.id.toLowerCase(), s]));
  const unitFor = (item: string) => byId.get(item.toLowerCase())?.unit ?? null;

  function update(index: number, patch: Partial<ModelSupply>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function add() {
    setRows((current) => [
      ...current,
      { item: catalog[0]?.id ?? "", qty: 1 },
    ]);
  }

  function remove(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  // Only rows with a chosen item and a positive quantity are submitted.
  const payload = rows.filter((row) => row.item && row.qty > 0);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>

      {catalog.length === 0 ? (
        <p className="text-xs text-muted">
          No supplies defined yet. Add some in the Supplies tab first, then list
          them here.
        </p>
      ) : (
        <>
          {rows.length === 0 && (
            <p className="text-xs text-muted">{emptyHint}</p>
          )}

          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                aria-label="Supply"
                value={row.item}
                onChange={(event) => update(index, { item: event.target.value })}
                className={`${INPUT} min-w-0 flex-1`}
              >
                {catalog.map((supply) => (
                  <option key={supply.id} value={supply.id}>
                    {supply.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Quantity"
                type="number"
                min="0"
                step="any"
                value={row.qty}
                onChange={(event) =>
                  update(index, { qty: Number(event.target.value) })
                }
                className={`${INPUT} w-24 shrink-0`}
              />
              <span className="w-14 shrink-0 text-xs text-muted">
                {unitFor(row.item) ?? "unit"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Remove supply"
                onPress={() => remove(index)}
              >
                <LuTrash2 className="size-3.5" />
              </Button>
            </div>
          ))}

          <div>
            <Button type="button" size="sm" variant="ghost" onPress={add}>
              <LuPlus className="size-3.5" />
              {addLabel}
            </Button>
          </div>
        </>
      )}

      <input type="hidden" name={name} value={JSON.stringify(payload)} />
    </div>
  );
}
