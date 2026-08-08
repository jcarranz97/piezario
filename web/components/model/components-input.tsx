"use client";

import { Button } from "@heroui/react";
import { useState } from "react";
import { LuPlus, LuTrash2 } from "react-icons/lu";

// From the pure `lib/components` module, never `lib/catalog` — these are
// runtime values, and catalog.ts pulls in node:fs.
import {
  COMPONENT_COST_PARTS,
  DEFAULT_COMPONENT_INCLUDE,
  type ComponentCostPart,
  type ModelComponent,
} from "@/lib/components";

/** Just enough of a model to offer it in the picker. */
export interface ComponentOption {
  slug: string;
  title: string;
  /** Ancestor folders joined for display, e.g. "keychains / colorful-charms". */
  category: string;
}

// No-width base so each row can size its inputs (flex-1, w-24) without a
// `w-full` overriding them.
const INPUT =
  "rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

const PART_LABELS: Record<ComponentCostPart, string> = {
  supplies: "Supplies",
  labor: "Labor",
  packaging: "Packaging",
  shipping: "Shipping",
};

const PART_HINTS: Record<ComponentCostPart, string> = {
  supplies: "Its rings, chains and inserts — usually yes, it still needs them",
  labor: "Its prep and clean-up time — usually yes, you still do that work",
  packaging: "Its own bag or box — usually no, this kit is bagged once",
  shipping: "Its own postage — usually no, this kit ships once",
};

/**
 * The components editor: a repeatable list of `{ model, qty, include }` rows.
 *
 * The structural twin of `SuppliesInput` — a `<select>` plus a quantity plus
 * add/remove, serialised into one hidden JSON field the save action parses —
 * with one thing supplies don't need: which of the component's own per-part
 * costs fold into this model. Filament and machine time are never optional and
 * so have no checkbox; a component always brings its print.
 */
export function ComponentsInput({
  name,
  defaultComponents,
  catalog,
}: {
  name: string;
  defaultComponents: ModelComponent[];
  /** Every other model in the catalog. Excludes this one, so a kit can't
   *  contain itself in one hop. */
  catalog: ComponentOption[];
}) {
  const [rows, setRows] = useState<ModelComponent[]>(defaultComponents);

  // Group for the <optgroup>s, keeping the catalog's existing sort order.
  const groups: Array<[string, ComponentOption[]]> = [];
  for (const option of catalog) {
    const label = option.category || "Top level";
    const group = groups.find(([key]) => key === label);
    if (group) {
      group[1].push(option);
    } else {
      groups.push([label, [option]]);
    }
  }

  function update(index: number, patch: Partial<ModelComponent>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function toggle(index: number, part: ComponentCostPart, on: boolean) {
    setRows((current) =>
      current.map((row, i) =>
        i === index
          ? {
              ...row,
              include: COMPONENT_COST_PARTS.filter((candidate) =>
                candidate === part ? on : row.include.includes(candidate),
              ),
            }
          : row,
      ),
    );
  }

  function add() {
    setRows((current) => [
      ...current,
      {
        model: catalog[0]?.slug ?? "",
        qty: 1,
        include: [...DEFAULT_COMPONENT_INCLUDE],
      },
    ]);
  }

  function remove(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  // Only rows with a chosen model and a positive quantity are submitted.
  const payload = rows.filter((row) => row.model && row.qty > 0);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Components</span>

      {catalog.length === 0 ? (
        <p className="text-xs text-muted">
          No other models to add yet.
        </p>
      ) : (
        <>
          {rows.length === 0 && (
            <p className="text-xs text-muted">
              None. Add other models to build a kit — its price is then their
              prices, kept up to date for you.
            </p>
          )}

          {rows.map((row, index) => (
            <div
              key={index}
              className="flex flex-col gap-1.5 rounded-lg border border-[var(--card-border)] p-2"
            >
              <div className="flex items-center gap-2">
                <select
                  aria-label="Component"
                  value={row.model}
                  onChange={(event) =>
                    update(index, { model: event.target.value })
                  }
                  className={`${INPUT} min-w-0 flex-1`}
                >
                  {/* A model listed in the README but since renamed away has no
                      option to select, so keep it as one rather than silently
                      swapping the row to whatever sorts first. */}
                  {!catalog.some((option) => option.slug === row.model) && (
                    <option value={row.model}>{row.model} (missing)</option>
                  )}
                  {groups.map(([label, options]) => (
                    <optgroup key={label} label={label}>
                      {options.map((option) => (
                        <option
                          key={option.slug}
                          value={option.slug}
                          title={option.slug}
                        >
                          {option.title}
                        </option>
                      ))}
                    </optgroup>
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
                  {row.qty === 1 ? "unit" : "units"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Remove component"
                  onPress={() => remove(index)}
                >
                  <LuTrash2 className="size-3.5" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-1">
                <span className="text-xs text-muted">Also include:</span>
                {COMPONENT_COST_PARTS.map((part) => (
                  <label
                    key={part}
                    title={PART_HINTS[part]}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={row.include.includes(part)}
                      onChange={(event) =>
                        toggle(index, part, event.target.checked)
                      }
                    />
                    {PART_LABELS[part]}
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div>
            <Button type="button" size="sm" variant="ghost" onPress={add}>
              <LuPlus className="size-3.5" />
              Add component
            </Button>
          </div>
        </>
      )}

      <input type="hidden" name={name} value={JSON.stringify(payload)} />
    </div>
  );
}
