import fs from "node:fs/promises";

import { Document, parseDocument } from "yaml";

import { configPath } from "./config";

/**
 * The inventory writer — the only code that mutates `catalog.yaml`.
 *
 * Like `lib/write.ts` (models) and `lib/icons-import.ts` (icons), it is
 * deliberately narrow: it edits exactly the `filaments:`, `supplies:` and
 * `cost:` nodes of one file — the config file `config.ts` itself reads — and
 * nothing else.
 *
 * `catalog.yaml` is heavily commented, and the whole file is the documentation
 * for how the catalog reads the repo. A plain dump would erase every comment, so
 * this uses the `yaml` package's Document API: it parses the file into a CST that
 * keeps comments and formatting, replaces just the one section's value, and
 * re-stringifies. The `cost:` explanation, the `exclude:` notes and everything
 * else survive untouched. The `cost:` values are edited **in place** (`setIn`)
 * rather than by replacing the whole map, so the comment on each cost line stays.
 */

/** A filament as it is written to yaml (snake_case keys, the file's spelling). */
export interface FilamentInput {
  id: string;
  name: string;
  material?: string;
  brand?: string;
  colors?: Array<{ name?: string; hex?: string }>;
  price_per_kg?: number | null;
  notes?: string;
}

/** Clean a colour list for yaml: keep entries with a name or a hex. */
function cleanColors(
  colors: FilamentInput["colors"],
): Array<Record<string, string>> {
  if (!colors) {
    return [];
  }
  const out: Array<Record<string, string>> = [];
  for (const c of colors) {
    const name = c.name?.trim() ?? "";
    const hex = c.hex?.trim() ?? "";
    if (name || hex) {
      out.push(prune({ name, hex }) as Record<string, string>);
    }
  }
  return out;
}

/** A supply as it is written to yaml. */
export interface SupplyInput {
  id: string;
  name: string;
  unit?: string;
  price?: number | null;
  category?: string;
  notes?: string;
}

export class InventoryError extends Error {}

/** A yaml-safe id: lower kebab, so it is stable and quotes-free in the file. */
function normaliseId(raw: string): string {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!id) {
    throw new InventoryError("An id is required.");
  }
  return id;
}

/** Drop empty/blank fields so the yaml stays clean rather than full of "". */
function prune<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && value.trim() === "") {
      continue;
    }
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

/**
 * Read the config as an editable Document. When the file doesn't exist yet, an
 * empty Document is returned so the first save creates it.
 */
async function readDocument(file: string): Promise<Document> {
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (text === null) {
    return new Document({});
  }
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new InventoryError(
      "catalog.yaml could not be parsed, so it was left unchanged. Fix the file by hand first.",
    );
  }
  return doc;
}

/** The current array under a top-level key, as plain objects (never null). */
function currentList(doc: Document, key: string): Record<string, unknown>[] {
  const json = doc.toJS() as Record<string, unknown> | null;
  const value = json?.[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Add a filament, or replace the one with the same id. Returns the id used, so
 * the UI can select the freshly saved row.
 */
export async function saveFilament(input: FilamentInput): Promise<string> {
  const id = normaliseId(input.id || input.name);
  // Name, type and price are mandatory — the form marks them required, and this
  // is the server-side backstop.
  if (!input.name?.trim()) {
    throw new InventoryError("A name is required.");
  }
  if (!input.material?.trim()) {
    throw new InventoryError("A material is required.");
  }
  if (input.price_per_kg === null || input.price_per_kg === undefined) {
    throw new InventoryError("A price per kg is required.");
  }
  const file = configPath();
  const doc = await readDocument(file);
  const rows = currentList(doc, "filaments")
    .filter((row) => String(row.id ?? "").toLowerCase() !== id.toLowerCase())
    // Migrate any kept row from the legacy `type:` key to `material:`.
    .map((row) => {
      if (row.type !== undefined && row.material === undefined) {
        row.material = row.type;
        delete row.type;
      }
      return row;
    });
  const colors = cleanColors(input.colors);
  rows.push({
    id,
    name: input.name,
    material: input.material,
    brand: input.brand,
    // Written after the scalar keys so a plain map isn't split by the list.
    ...(colors.length > 0 ? { colors } : {}),
    price_per_kg: input.price_per_kg,
    notes: input.notes,
  });
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  doc.set("filaments", rows.map(prune));
  await fs.writeFile(file, String(doc), "utf8");
  return id;
}

/** Add a supply, or replace the one with the same id. */
export async function saveSupply(input: SupplyInput): Promise<string> {
  const id = normaliseId(input.id || input.name);
  // Name and price are mandatory — the form marks them required, and this is
  // the server-side backstop.
  if (!input.name?.trim()) {
    throw new InventoryError("A name is required.");
  }
  if (input.price === null || input.price === undefined) {
    throw new InventoryError("A price is required.");
  }
  const file = configPath();
  const doc = await readDocument(file);
  const rows = currentList(doc, "supplies").filter(
    (row) => String(row.id ?? "").toLowerCase() !== id.toLowerCase(),
  );
  rows.push({
    id,
    name: input.name,
    unit: input.unit?.trim() || "piece",
    price: input.price,
    category: input.category,
    notes: input.notes,
  });
  rows.sort(
    (a, b) =>
      String(a.category ?? "").localeCompare(String(b.category ?? "")) ||
      String(a.name).localeCompare(String(b.name)),
  );
  doc.set("supplies", rows.map(prune));
  await fs.writeFile(file, String(doc), "utf8");
  return id;
}

/** Remove one entry by id from a section. A no-op if it isn't there. */
async function deleteFrom(
  key: "filaments" | "supplies",
  id: string,
): Promise<void> {
  const file = configPath();
  const doc = await readDocument(file);
  const rows = currentList(doc, key).filter(
    (row) => String(row.id ?? "").toLowerCase() !== id.toLowerCase(),
  );
  doc.set(key, rows.map(prune));
  await fs.writeFile(file, String(doc), "utf8");
}

/** Remove one filament by id. A no-op if it isn't there. */
export function deleteFilament(id: string): Promise<void> {
  return deleteFrom("filaments", id);
}

/** Remove one supply by id. A no-op if it isn't there. */
export function deleteSupply(id: string): Promise<void> {
  return deleteFrom("supplies", id);
}

/** The editable cost settings, in the file's snake_case spelling. */
export interface CostInput {
  currency?: string;
  filament_per_kg?: number | null;
  filament_per_kg_by_type?: Record<string, number>;
  failure_risk?: { low: number | null; medium: number | null; high: number | null };
  printer_price?: number | null;
  maintenance_cost?: number | null;
  lifespan_hours?: number | null;
  power_watts?: number | null;
  electricity_per_kwh?: number | null;
  labor_per_hour?: number | null;
  shipping_cost?: number | null;
  tax_percent?: number | null;
  markup_percent?: number | null;
}

/**
 * Save the `cost:` settings.
 *
 * Each value is set (or deleted, when cleared) at its path inside `cost:` rather
 * than replacing the whole map, so the long comment above every line survives.
 * A cleared number deletes its key, which restores the documented default —
 * `loadConfig()` reads a missing rate as null.
 */
export async function saveCost(input: CostInput): Promise<void> {
  const file = configPath();
  const doc = await readDocument(file);
  if (!doc.has("cost")) {
    doc.set("cost", {});
  }

  const setNum = (key: string, value: number | null | undefined) => {
    if (value === null || value === undefined) {
      doc.deleteIn(["cost", key]);
    } else {
      doc.setIn(["cost", key], value);
    }
  };

  const currency = input.currency?.trim();
  if (currency) {
    doc.setIn(["cost", "currency"], currency);
  } else {
    doc.deleteIn(["cost", "currency"]);
  }

  setNum("filament_per_kg", input.filament_per_kg);
  // Failure-risk factors: a whole sub-map (its key keeps its comment).
  if (input.failure_risk) {
    const r = input.failure_risk;
    const map: Record<string, number> = {};
    if (r.low !== null && r.low !== undefined) map.low = r.low;
    if (r.medium !== null && r.medium !== undefined) map.medium = r.medium;
    if (r.high !== null && r.high !== undefined) map.high = r.high;
    if (Object.keys(map).length > 0) {
      doc.setIn(["cost", "failure_risk"], map);
    }
  }
  setNum("printer_price", input.printer_price);
  setNum("maintenance_cost", input.maintenance_cost);
  setNum("lifespan_hours", input.lifespan_hours);
  setNum("power_watts", input.power_watts);
  setNum("electricity_per_kwh", input.electricity_per_kwh);
  setNum("labor_per_hour", input.labor_per_hour);
  setNum("shipping_cost", input.shipping_cost);
  setNum("tax_percent", input.tax_percent);
  setNum("markup_percent", input.markup_percent);
  // Retire keys the settings no longer use.
  doc.deleteIn(["cost", "printer_per_hour"]);
  doc.deleteIn(["cost", "packaging_cost"]);
  doc.deleteIn(["cost", "machine_buffer"]);
  doc.deleteIn(["cost", "efficiency_factor"]);

  // Per-material overrides: a whole sub-map. Its own key keeps its comment; the
  // entries carry none, so replacing the value wholesale is safe.
  const entries = Object.entries(input.filament_per_kg_by_type ?? {}).filter(
    ([type, rate]) => type.trim() && Number.isFinite(rate),
  );
  if (entries.length > 0) {
    const map: Record<string, number> = {};
    for (const [type, rate] of entries) {
      map[type.trim().toUpperCase()] = rate;
    }
    doc.setIn(["cost", "filament_per_kg_by_type"], map);
  } else {
    doc.deleteIn(["cost", "filament_per_kg_by_type"]);
  }

  await fs.writeFile(file, String(doc), "utf8");
}
