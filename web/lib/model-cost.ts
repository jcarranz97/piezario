import type { ModelFile, ModelSupply } from "./catalog";
import type { CostConfig, SupplyItem } from "./config";
import { type MachineRate, estimateCost, machineRateBreakdown } from "./cost";
import type { ThreeMfFileSummary } from "./threemf";

/**
 * The **landed cost** of a whole model — everything a finished part costs you,
 * following the Print Farm Academy method:
 *
 *   landed = raw materials + purchased materials + packaging + labor + machine
 *   price  = landed × (1 + tax) × (1 + markup)
 *
 * - **Raw materials + machine** come from the sliced `.3mf` files in the model's
 *   `out/` folder, grouped by their immediate subfolder. Files sitting directly
 *   in `out/` are the **Estimate** (the reference print); each subfolder
 *   (`out/juanito1/`) is a **sale batch** summed on its own.
 * - **Purchased materials** are the supplies the README lists (rings, chains,
 *   inserts…), priced from the catalog.
 * - **Packaging** and **labor** are per-part figures the model supplies (or that
 *   fall back to the global defaults).
 *
 * The per-part pieces (supplies, packaging, labor) fold into every group, since
 * each finished item needs them. Tax and markup apply once to the landed total.
 */

/** A resolved supply line: the model's `{item, qty}` joined to its catalog row. */
export interface ResolvedSupply {
  item: string;
  qty: number;
  /** The catalog entry, or null when the id isn't in `catalog.yaml`. */
  supply: SupplyItem | null;
  /** qty × unit price, or null when the supply or its price is unknown. */
  lineTotal: number | null;
}

/** One sliced file's contribution to a group, for the expandable breakdown. */
export interface ModelCostFile {
  /** The file's display name, e.g. "out/juanito1/order.gcode.3mf". */
  label: string;
  grams: number | null;
  seconds: number | null;
  rawMaterials: number;
  machine: number;
}

export interface ModelCostGroup {
  /** "Estimate" for files directly in `out/`, else the subfolder name. */
  label: string;
  isEstimate: boolean;
  /** How many sliced files were summed. */
  fileCount: number;
  /** Per-file breakdown behind `rawMaterials` and `machine`. */
  files: ModelCostFile[];
  /** Filament with the waste buffer, summed across the group's sliced files. */
  rawMaterials: number;
  /** Machine cost, summed across the group's sliced files. */
  machine: number;
  /** Purchased materials — the supplies subtotal, same for every group. */
  purchased: number;
  /** Packaging consumables subtotal (bag, box…), same for every group. */
  packaging: number;
  /** Flat shipping fee per part. */
  shipping: number;
  /** Labor for this part. */
  labor: number;
  /** raw + machine + purchased + packaging + shipping + labor — base cost. */
  landed: number;
  markupPercent: number | null;
  /** Your margin: landed × markup. */
  profit: number | null;
  /** Price before tax: landed + profit. */
  total: number;
  taxPercent: number | null;
  /** Sales tax on the pre-tax price (`total`). */
  tax: number | null;
  /** total + tax — what the customer pays. */
  price: number;
}

/** The rates behind the numbers, so the card can explain how they're built. */
export interface ModelCostRates {
  /** Waste buffer applied to filament and machine (1.1 = +10%). */
  efficiency: number;
  /** The failure-risk level the buffer came from (low/medium/high), if known. */
  riskLevel: string | null;
  /** Per-kg filament rate for this option, or null when priced by material. */
  filamentPerKg: number | null;
  /** Machine hourly rate and its parts, or null when not configured. */
  machine: MachineRate | null;
  /** Labor rate per hour, echoed for the labor line. */
  laborPerHour: number;
  /** Labor minutes for this part, echoed for the labor line. */
  laborMinutes: number;
}

export interface ModelCost {
  currency: string;
  groups: ModelCostGroup[];
  supplyLines: ResolvedSupply[];
  suppliesTotal: number;
  /** Resolved packaging consumables, for the Packaging breakdown. */
  packagingLines: ResolvedSupply[];
  rates: ModelCostRates;
  /** Ids listed on the model but missing from `catalog.yaml`. */
  unresolved: string[];
}

/**
 * One entry in the cost card's filament dropdown: a candidate filament and the
 * whole-model cost priced at its rate. "default" is the fallback that prices by
 * the per-material table when no filament matches the model's materials.
 */
export interface ModelCostOption {
  key: string;
  label: string;
  cost: ModelCost;
}

/** Join a model's supply lines to their catalog entries and price each one. */
export function resolveSupplies(
  lines: ModelSupply[],
  lookup: (id: string) => SupplyItem | null,
): ResolvedSupply[] {
  return lines.map((line) => {
    const supply = lookup(line.item);
    const lineTotal =
      supply && supply.price !== null ? supply.price * line.qty : null;
    return { item: line.item, qty: line.qty, supply, lineTotal };
  });
}

/**
 * The immediate `out/` subfolder a generated file belongs to, or null when it
 * sits directly in `out/`. `file.name` keeps the whole subpath
 * (`out/juanito1/part.gcode.3mf`), so segment 1 (after the output-dir segment)
 * is the batch.
 */
function batchOf(name: string): string | null {
  const segments = name.split("/");
  return segments.length > 2 ? segments[1] : null;
}

/**
 * Turn a landed cost into a selling price, the right way round:
 *
 *   profit         = landed × markup      (your margin, on the base cost)
 *   price before tax = landed + profit
 *   tax            = (price before tax) × tax   (a pass-through on the price)
 *   price          = price before tax + tax
 *
 * Markup must come first: profit is the revenue you keep, so it's a margin on
 * cost, while sales tax is collected on the price you charge. (The final price
 * is the same either way — two flat percentages commute — but the split into
 * profit vs tax is only correct in this order.)
 */
function applyMargins(
  landed: number,
  cost: CostConfig,
  markupPercent: number | null,
): Pick<
  ModelCostGroup,
  "taxPercent" | "tax" | "total" | "markupPercent" | "profit" | "price"
> {
  const profit =
    markupPercent !== null ? landed * (markupPercent / 100) : null;
  const total = landed + (profit ?? 0); // price before tax
  const tax = cost.taxPercent !== null ? total * (cost.taxPercent / 100) : null;
  return {
    markupPercent,
    profit,
    total,
    taxPercent: cost.taxPercent,
    tax,
    price: total + (tax ?? 0),
  };
}

/**
 * The landed cost per `out/` group. Returns null when there's nothing to price —
 * no sliced files and no per-part costs — so the detail page can skip the card.
 */
export function estimateModelCost(
  files: ModelFile[],
  summaries: ThreeMfFileSummary[],
  cost: CostConfig,
  supplyLines: ResolvedSupply[],
  /** Resolved packaging consumables (bag, box…) — priced like supplies. */
  packagingLines: ResolvedSupply[],
  /**
   * A candidate filament's rate. Raw materials are repriced from each file's
   * slice at this rate, so the same analysis can be costed against several
   * filaments without re-reading the 3MFs. Null prices by the per-material table.
   */
  overridePerKg: number | null = null,
  /** The part's waste buffer (some parts fail more); defaults to the global. */
  efficiency: number = cost.failureRisk.medium,
  /** Prep/clean/package time for this part, in minutes. */
  laborMinutes = 0,
  /** Flat shipping fee for this part (already resolved to a number). */
  shipping = 0,
  /** Profit markup % for this part; defaults to the global. */
  markupPercent: number | null = cost.markupPercent,
  /** The failure-risk level, echoed in the rates for the tooltips. */
  riskLevel: string | null = null,
): ModelCost | null {
  const lineTotal = (lines: ResolvedSupply[]) =>
    lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  const purchased = lineTotal(supplyLines);
  const packaging = lineTotal(packagingLines);
  const unresolved = [...supplyLines, ...packagingLines]
    .filter((line) => line.supply === null)
    .map((line) => line.item);

  const laborRate = cost.laborPerHour ?? 20;
  const labor = laborMinutes > 0 ? (laborMinutes / 60) * laborRate : 0;

  // Raw-material and machine cost per group, keyed by batch. `null` = Estimate.
  const byId = new Map(summaries.map((s) => [s.label, s]));
  const print = new Map<
    string | null,
    { raw: number; machine: number; count: number; items: ModelCostFile[] }
  >();
  for (const file of files) {
    if (!file.isOutput || !file.name.toLowerCase().endsWith(".3mf")) {
      continue;
    }
    const summary = byId.get(file.name);
    // Reprice the file at the candidate rate and this part's waste buffer.
    const priced = summary?.slice
      ? estimateCost(summary.slice, cost, overridePerKg, efficiency)
      : null;
    if (!priced) {
      continue; // not sliced — no cost to add
    }
    const key = batchOf(file.name);
    const bucket =
      print.get(key) ?? { raw: 0, machine: 0, count: 0, items: [] };
    bucket.raw += priced.rawMaterials ?? 0;
    bucket.machine += priced.machine ?? 0;
    bucket.count += 1;
    bucket.items.push({
      label: file.name,
      grams: summary!.slice!.grams,
      seconds: summary!.slice!.seconds,
      rawMaterials: priced.rawMaterials ?? 0,
      machine: priced.machine ?? 0,
    });
    print.set(key, bucket);
  }

  const hasExtras =
    supplyLines.length > 0 ||
    packagingLines.length > 0 ||
    shipping > 0 ||
    labor > 0;
  if (print.size === 0 && !hasExtras) {
    return null;
  }

  // Ensure an Estimate group exists whenever there is anything to show, so a
  // model with only supplies/labor/packaging still gets a total.
  if (!print.has(null) && (hasExtras || print.size === 0)) {
    print.set(null, { raw: 0, machine: 0, count: 0, items: [] });
  }

  const groups: ModelCostGroup[] = [...print.entries()]
    .map(([key, bucket]) => {
      const landed =
        bucket.raw +
        bucket.machine +
        purchased +
        packaging +
        shipping +
        labor;
      return {
        label: key ?? "Estimate",
        isEstimate: key === null,
        fileCount: bucket.count,
        files: bucket.items,
        rawMaterials: bucket.raw,
        machine: bucket.machine,
        purchased,
        packaging,
        shipping,
        labor,
        landed,
        ...applyMargins(landed, cost, markupPercent),
      };
    })
    .sort((a, b) => {
      // Estimate first, then batches by name.
      if (a.isEstimate !== b.isEstimate) {
        return a.isEstimate ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });

  return {
    currency: cost.currency,
    groups,
    supplyLines,
    suppliesTotal: purchased,
    packagingLines,
    rates: {
      efficiency,
      riskLevel,
      filamentPerKg: overridePerKg,
      machine: machineRateBreakdown(cost, efficiency),
      laborPerHour: laborRate,
      laborMinutes,
    },
    unresolved,
  };
}
