import fs from "node:fs";
import path from "node:path";

import { load } from "js-yaml";

/**
 * `catalog.yaml` — the repository's own settings, in the spirit of
 * `mkdocs.yml`.
 *
 * The catalog is otherwise entirely convention-driven: a folder is a model, a
 * file's extension is its kind. This file exists for the handful of decisions
 * conventions can't make, above all *which folders aren't content* — a
 * generator script's `out/` holds real files, but it is build output, not a
 * model.
 *
 * It is read from disk on every scan rather than cached at startup, so editing
 * it and refreshing the browser is enough — same as everything else here.
 */

/**
 * The "landed cost" settings, from the `cost:` section of `catalog.yaml`.
 *
 * This follows the Print Farm Academy method: a part's real cost is not just
 * filament, it's **raw materials** (filament × a waste buffer) + **purchased
 * materials** (the supplies) + **packaging/shipping** + **labor** + **machine
 * cost** (the printer slowly wearing out, plus power). Price is a markup on that
 * landed cost.
 *
 * These are the global knobs, all editable from the Others tab. A few things are
 * per-part instead and live on the model: the efficiency factor (some parts fail
 * more), the labor minutes, the supplies, and an optional packaging override.
 */
/**
 * The waste buffer for each failure-risk level. A part likely to fail (and be
 * reprinted) wastes more filament *and* machine time, so one multiplier scales
 * both. A model picks a level (low/medium/high); these are the factors.
 */
export interface FailureRisk {
  low: number;
  medium: number;
  high: number;
}

export type RiskLevel = "low" | "medium" | "high";

export interface CostConfig {
  currency: string;

  // --- Raw materials ---
  /** Spool price per kilogram, used when a material has no own rate. */
  filamentPerKg: number | null;
  /** Per-material rates, keyed by the type the slicer recorded (PLA, PETG…). */
  filamentPerKgByType: Record<string, number>;
  /** Waste-buffer factor per failure-risk level; a model picks the level. */
  failureRisk: FailureRisk;

  // --- Machine cost (an hourly rate is computed from these) ---
  /** What the printer cost. */
  printerPrice: number | null;
  /** Estimated maintenance + repairs over the printer's whole life. */
  maintenanceCost: number | null;
  /** Estimated running hours over the printer's life (depreciation basis). */
  lifespanHours: number | null;
  /** Average power draw while printing, in watts. */
  powerWatts: number | null;
  /** Electricity price per kWh. */
  electricityPerKwh: number | null;

  // --- Labor & packaging ---
  /** Labor rate; a model supplies the minutes. Defaults to 20 when unset. */
  laborPerHour: number | null;
  /** Default shipping fee per part; a model may override it. Packaging itself
   * is a per-part list of supplies, not a flat number. */
  shippingCost: number | null;

  // --- Pricing ---
  /**
   * Tax as a percentage, applied to the landed cost **before** the markup — so
   * the profit is calculated on the taxed cost, not the bare one.
   */
  taxPercent: number | null;
  /**
   * Profit as a percentage **of the landed cost** (a markup, not a margin). 50
   * means the price is 1.5× the landed cost.
   */
  markupPercent: number | null;
}

/** One colour a filament product is stocked in. */
export interface FilamentColor {
  /** How you refer to it ("Black", "Matte Red"). A model pins this by name. */
  name: string;
  /** Hex, for the swatch. Null when only a name was given. */
  hex: string | null;
}

/**
 * One filament **product** in your inventory — a line like "PLA Basic" by Bambu
 * Lab — lives under `filaments:` in `catalog.yaml`. Rather than one entry per
 * colour, a product carries the list of `colors` you stock, which keeps the tab
 * short. A model pins a product by `id` (its `pricePerKg` then prices the print)
 * and may name one of its colours.
 */
export interface FilamentItem {
  /** Stable key a model references. Required; entries without one are dropped. */
  id: string;
  name: string;
  /**
   * The material (PLA, PETG…). Matched against a model's `materials` and the
   * per-material rate table when costing. Read from the legacy `type:` key too.
   */
  material: string | null;
  brand: string | null;
  /** The colours you stock this product in. */
  colors: FilamentColor[];
  /** Spool price per kilogram — the same across colours of one product. */
  pricePerKg: number | null;
  notes: string | null;
}

/**
 * One consumable in your supplies inventory — a ring, a chain, glue, anything
 * that isn't printed. Lives under `supplies:` in `catalog.yaml`. A model lists
 * how many of each it needs; the unit and unit price come from here.
 */
export interface SupplyItem {
  /** Stable key a model references. Required; entries without one are dropped. */
  id: string;
  name: string;
  /** Unit the price is per: piece, gram, ml, cm… A free-form label. */
  unit: string | null;
  /** Price per one unit. */
  price: number | null;
  /** Optional grouping label for the Supplies tab. */
  category: string | null;
  notes: string | null;
}

export interface CatalogConfig {
  /** Absolute path to the models tree. */
  modelsDir: string;
  /** Absolute path to the fonts folder. */
  fontsDir: string;
  /** Absolute path to the icons folder. */
  iconsDir: string;
  /** Folder patterns that are never models, categories, or font folders. */
  exclude: string[];
  /**
   * Folders whose contents belong to the *parent* model rather than forming a
   * model of their own — where a generator script writes its meshes.
   */
  outputDirs: string[];
  cost: CostConfig;
  /** Your filament spools, for the Filaments tab and per-part pricing. */
  filaments: FilamentItem[];
  /** Your consumables (rings, chains…), for the Supplies tab and part costs. */
  supplies: SupplyItem[];
  /** Absolute path of the config file, when one was found. */
  file: string | null;
}

/**
 * Used when there is no `catalog.yaml`, and as the documented starting point
 * inside it. Folders beginning with "." are always skipped and don't need
 * listing, which covers `.git`, `.venv` and friends.
 */
const DEFAULT_EXCLUDE = ["node_modules", "__pycache__", "venv", "build", "dist"];

/**
 * `out/` is the near-universal name for where a generator drops its meshes.
 * Those files are real output you want to see and open — they just aren't a
 * model of their own.
 */
const DEFAULT_OUTPUT_DIRS = ["out", "output"];

/** Where to look for the config file. Also where the inventory writer writes. */
export function configPath(): string {
  return process.env.CATALOG_CONFIG
    ? path.resolve(process.env.CATALOG_CONFIG)
    : path.resolve(process.cwd(), "..", "catalog.yaml");
}

function readConfigFile(file: string): Record<string, unknown> {
  try {
    const parsed = load(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A malformed config must not take the whole catalog down; fall back to
    // conventions and let the pages render.
    return {};
  }
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const out = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return out.length > 0 ? out : null;
}

/** A yaml scalar to a trimmed string, or null — no throwing on odd shapes. */
function itemString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

/** A yaml scalar to a finite non-negative number, or null. */
function itemNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse a filament's `colors:` list. Each entry is `{ name, hex }`, but a bare
 * string ("Black") or a lone hex is accepted too. A legacy top-level `color:`
 * (from the one-entry-per-colour era) becomes a single unnamed colour, so old
 * files keep rendering.
 */
function parseColors(value: unknown, legacy: unknown): FilamentColor[] {
  const out: FilamentColor[] = [];
  const push = (name: string | null, hex: string | null) => {
    if (name || hex) {
      out.push({ name: name ?? "", hex });
    }
  };
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (raw && typeof raw === "object") {
        const row = raw as Record<string, unknown>;
        push(itemString(row.name), itemString(row.hex ?? row.color ?? row.colour));
      } else {
        // A bare string: a hex if it looks like one, else a colour name.
        const s = itemString(raw);
        if (s) {
          push(/^#?[0-9a-f]{3,8}$/i.test(s) ? null : s, /^#/.test(s) ? s : null);
        }
      }
    }
  }
  if (out.length === 0) {
    const hex = itemString(legacy);
    if (hex) {
      push(null, hex);
    }
  }
  return out;
}

/**
 * Parse the `filaments:` list. Each entry needs an `id`; anything without one
 * is skipped rather than silently priced against a missing key. A malformed
 * list (not an array) yields an empty inventory, never an error.
 */
function parseFilaments(value: unknown): FilamentItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: FilamentItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const row = raw as Record<string, unknown>;
    const id = itemString(row.id);
    if (!id) {
      continue;
    }
    out.push({
      id,
      name: itemString(row.name) ?? id,
      material: itemString(row.material ?? row.type),
      brand: itemString(row.brand),
      colors: parseColors(row.colors, row.color ?? row.colour),
      pricePerKg: itemNumber(row.price_per_kg ?? row.pricePerKg),
      notes: itemString(row.notes),
    });
  }
  return out;
}

/** Parse the `supplies:` list, same discipline as `parseFilaments`. */
function parseSupplies(value: unknown): SupplyItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SupplyItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const row = raw as Record<string, unknown>;
    const id = itemString(row.id);
    if (!id) {
      continue;
    }
    out.push({
      id,
      name: itemString(row.name) ?? id,
      unit: itemString(row.unit) ?? "piece",
      price: itemNumber(row.price),
      category: itemString(row.category),
      notes: itemString(row.notes),
    });
  }
  return out;
}

export function loadConfig(): CatalogConfig {
  const file = configPath();
  const exists = fs.existsSync(file);
  const data = exists ? readConfigFile(file) : {};
  const base = path.dirname(file);

  // Env wins over the file, so a one-off run can point somewhere else without
  // editing the repository's own config.
  const resolveDir = (envVar: string, key: string, fallback: string): string => {
    const fromEnv = process.env[envVar];
    if (fromEnv) {
      return path.resolve(fromEnv);
    }
    const fromFile = data[key];
    return path.resolve(base, typeof fromFile === "string" ? fromFile : fallback);
  };

  const costSection =
    data.cost && typeof data.cost === "object"
      ? (data.cost as Record<string, unknown>)
      : {};
  const byType: Record<string, number> = {};
  const rawByType = costSection.filament_per_kg_by_type;
  if (rawByType && typeof rawByType === "object") {
    for (const [type, value] of Object.entries(
      rawByType as Record<string, unknown>,
    )) {
      const rate = Number(value);
      if (Number.isFinite(rate)) {
        // Slicer material names are upper-case (PLA, PETG); match on that.
        byType[type.toUpperCase()] = rate;
      }
    }
  }
  // A positive price/rate, or null when unset or non-positive.
  const rate = (key: string): number | null => {
    const value = Number(costSection[key]);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  // A finite non-negative number (0 allowed — e.g. free packaging), or null.
  const num = (key: string): number | null => {
    const value = Number(costSection[key]);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  // A multiplier with a default.
  const factor = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  // Failure-risk factors, read from `cost.failure_risk: { low, medium, high }`.
  // The legacy flat `efficiency_factor` seeds the medium level if present.
  const riskSection =
    costSection.failure_risk && typeof costSection.failure_risk === "object"
      ? (costSection.failure_risk as Record<string, unknown>)
      : {};
  const legacyEfficiency = costSection.efficiency_factor;
  const failureRisk: FailureRisk = {
    low: factor(riskSection.low, 1.1),
    medium: factor(riskSection.medium ?? legacyEfficiency, 1.3),
    high: factor(riskSection.high, 1.7),
  };

  return {
    modelsDir: resolveDir("CATALOG_MODELS_DIR", "models_dir", "models"),
    fontsDir: resolveDir("CATALOG_FONTS_DIR", "fonts_dir", "fonts"),
    iconsDir: resolveDir("CATALOG_ICONS_DIR", "icons_dir", "icons"),
    exclude: asStringList(data.exclude) ?? DEFAULT_EXCLUDE,
    outputDirs: asStringList(data.output_dirs) ?? DEFAULT_OUTPUT_DIRS,
    cost: {
      currency:
        typeof costSection.currency === "string" ? costSection.currency : "$",
      filamentPerKg: rate("filament_per_kg"),
      filamentPerKgByType: byType,
      failureRisk,
      printerPrice: num("printer_price"),
      maintenanceCost: num("maintenance_cost"),
      lifespanHours: num("lifespan_hours"),
      powerWatts: num("power_watts"),
      electricityPerKwh: num("electricity_per_kwh"),
      laborPerHour: rate("labor_per_hour"),
      // `packaging_cost` was the pre-split flat fee; read it as the shipping fee.
      shippingCost: num("shipping_cost") ?? num("packaging_cost"),
      taxPercent: rate("tax_percent"),
      markupPercent: rate("markup_percent"),
    },
    filaments: parseFilaments(data.filaments),
    supplies: parseSupplies(data.supplies),
    file: exists ? file : null,
  };
}

/** The three risk levels, low → high, for menus. */
export const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high"];

/** The waste-buffer factor for a model's risk level, defaulting to medium. */
export function failureRiskFactor(
  cost: CostConfig,
  level: string | null,
): number {
  const key = (level ?? "medium").toLowerCase();
  if (key === "low") return cost.failureRisk.low;
  if (key === "high") return cost.failureRisk.high;
  return cost.failureRisk.medium;
}

/** `out` → /^out$/, `*.bak` → /^[^/]*\.bak$/ — `*` never crosses a separator. */
function toRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Should this folder be skipped?
 *
 * A pattern containing "/" is matched against the folder's path relative to
 * the tree root (`examples/scratch`), so you can exclude one specific folder.
 * A pattern without one is matched against the folder's *name* at any depth,
 * which is what makes a bare `out` exclude every generator's output folder.
 */
export function matchesPattern(
  name: string,
  relPath: string,
  patterns: string[],
): boolean {
  const posix = relPath.split(path.sep).join("/");
  return patterns.some((pattern) =>
    pattern.includes("/")
      ? toRegExp(pattern).test(posix)
      : toRegExp(pattern).test(name),
  );
}

export function isExcluded(
  name: string,
  relPath: string,
  patterns: string[],
): boolean {
  return name.startsWith(".") || matchesPattern(name, relPath, patterns);
}
