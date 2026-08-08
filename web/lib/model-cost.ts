import type { LaborBasis, ModelFile, ModelSupply } from "./catalog";
import type { ComponentCostPart } from "./components";
import type { CostConfig, FilamentItem, SupplyItem } from "./config";
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

/** Why a component line could not be priced, or priced to something suspect. */
export type ComponentIssue =
  /** The slug names no model in the catalog — renamed, moved, or mistyped. */
  | "missing"
  /** Resolving it would loop back to a model already on the path. */
  | "cycle"
  /** The nesting cap was reached before this line could be priced. */
  | "depth"
  /** Too many distinct components on one page. */
  | "limit"
  /** Priced, but no sliced file in an output folder contributed anything. */
  | "no-print"
  /** It has no costs at all — nothing sliced, no supplies, no labour. */
  | "unpriceable"
  /** Its own discount pushed its margin below zero. */
  | "below-cost";

/**
 * One component line, resolved and priced. Plain data only — this crosses to
 * the client, so it never holds a `Model`.
 */
export interface ResolvedComponent {
  /** The slug exactly as the frontmatter wrote it. */
  slug: string;
  /** The component's title, or the slug when it could not be resolved. */
  title: string;
  qty: number;
  /** Which of the component's per-part costs folded in. */
  include: ComponentCostPart[];
  /** Which group the unit figures came from ("Estimate", or a batch name). */
  groupLabel: string | null;
  /** Which filament priced it, for the tooltip. Null = by material type. */
  filamentLabel: string | null;
  /** Units the component's plate yields; its print cost was divided by this. */
  yieldUnits: number;
  /** The plate's own weight, so a "unit" that is really a plate is visible. */
  plateGrams: number | null;
  /** The plate's own print time, for the same reason. */
  plateSeconds: number | null;
  /** How many sliced files backed the print figures. 0 is the warning case. */
  fileCount: number;
  /** One unit's cost: print ÷ yield, plus whatever `include` allowed. */
  unitCost: number;
  /** One unit's own margin, at its own markup and after its own discount. */
  unitProfit: number;
  /** qty × unitCost. */
  lineCost: number;
  /** qty × unitProfit. */
  lineProfit: number;
  issue: ComponentIssue | null;
  /** A ready-to-show sentence for the issue. */
  note: string | null;
}

/** Every component line of one model, summed. */
export interface ComponentRollup {
  lines: ResolvedComponent[];
  /** Σ lineCost — folds into the parent's landed cost. */
  totalCost: number;
  /** Σ lineProfit — folds into the parent's profit, beside its own markup. */
  totalProfit: number;
}

/** A model that composes nothing. Also the default for every existing model. */
export const EMPTY_ROLLUP: ComponentRollup = {
  lines: [],
  totalCost: 0,
  totalProfit: 0,
};

/**
 * The filaments worth offering for a model: those whose material is one of the
 * model's. A PLA-only part lists the PLA spools, a PLA/PETG part lists both.
 */
export function candidateFilaments(
  materials: string[],
  filaments: FilamentItem[],
): FilamentItem[] {
  const wanted = new Set(materials.map((m) => m.toLowerCase()));
  return filaments.filter(
    (f) => f.material && wanted.has(f.material.toLowerCase()),
  );
}

/**
 * Which candidate a model is priced at when nobody is choosing from a dropdown —
 * the one it remembers, else the first that matches its materials, else null
 * (price by the per-material table). Shared by the detail page and the kit
 * resolver so a component's line in a kit matches its own card.
 */
export function preferredFilament(
  candidates: FilamentItem[],
  costFilament: string | null,
): FilamentItem | null {
  if (costFilament) {
    const remembered = candidates.find(
      (f) => f.id.toLowerCase() === costFilament.toLowerCase(),
    );
    if (remembered) {
      return remembered;
    }
  }
  return candidates[0] ?? null;
}

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
  /** Path relative to the models root, for opening the file in the slicer. */
  relPath: string;
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
  /** What the components cost you. Already inside `landed`. */
  componentsCost: number;
  /**
   * raw + machine + purchased + packaging + shipping + labor + components —
   * base cost. `landed − componentsCost` is what this model adds on its own.
   */
  landed: number;
  /** This model's own markup %, unchanged by anything its components do. */
  markupPercent: number | null;
  /** The components' own margins, carried through. Already inside `profit`. */
  componentsProfit: number;
  /** Percent taken off the pre-tax total, when this model discounts. */
  discountPercent: number | null;
  /** The money that discount takes off. Already subtracted from `profit`. */
  discount: number;
  /** Your margin: own landed × own markup, plus the components', less discount. */
  profit: number | null;
  /**
   * profit ÷ landed — the margin this model actually runs at once its
   * components' markups and its own discount are in. Null when there is no
   * profit to blend, or nothing to blend it against.
   */
  effectiveMarkupPercent: number | null;
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
  /** Labor minutes as the model declared them, echoed for the labor line. */
  laborMinutes: number;
  /** Whether those minutes were per piece or per plate. */
  laborBasis: LaborBasis;
  /** Finished units one plate makes; the print figures were divided by it. */
  yieldUnits: number;
}

export interface ModelCost {
  currency: string;
  groups: ModelCostGroup[];
  supplyLines: ResolvedSupply[];
  suppliesTotal: number;
  /** Resolved packaging consumables, for the Packaging breakdown. */
  packagingLines: ResolvedSupply[];
  /** Resolved component lines, for the Components breakdown. */
  componentLines: ResolvedComponent[];
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
 *   profit         = own landed × markup + the components' own margins
 *   discount       = (landed + profit) × discount    (a kit sells for less)
 *   price before tax = landed + profit − discount
 *   tax            = (price before tax) × tax   (a pass-through on the price)
 *   price          = price before tax + tax
 *
 * Markup must come first: profit is the revenue you keep, so it's a margin on
 * cost, while sales tax is collected on the price you charge. (The final price
 * is the same either way — two flat percentages commute — but the split into
 * profit vs tax is only correct in this order.)
 *
 * **Components carry their own margin.** A markup you back-solved on a keychain
 * is a decision about what that keychain is worth, and it should survive the
 * keychain being sold inside a kit — so a component contributes its cost to
 * `landed` and its margin to `profit`, and the kit's own markup applies only to
 * what the kit itself adds. Tax is charged exactly **once**, on the whole
 * pre-tax price, which is what adding component *prices* by hand gets wrong.
 */
function applyMargins(
  /** This model's own costs, before anything its components contribute. */
  ownLanded: number,
  cost: CostConfig,
  markupPercent: number | null,
  /** The components' rolled-up cost and margin. */
  components: { cost: number; profit: number } = { cost: 0, profit: 0 },
  /** Percent off the pre-tax total, for a kit that sells below sum-of-parts. */
  discountPercent: number | null = null,
): Pick<
  ModelCostGroup,
  | "taxPercent"
  | "tax"
  | "total"
  | "markupPercent"
  | "profit"
  | "price"
  | "componentsCost"
  | "componentsProfit"
  | "discountPercent"
  | "discount"
  | "effectiveMarkupPercent"
> {
  const own = markupPercent !== null ? ownLanded * (markupPercent / 100) : null;
  // Null profit means "no markup configured anywhere", so the card hides the
  // row — but a component's margin is a real number and must not be swallowed.
  const gross =
    own === null && components.profit === 0 ? null : (own ?? 0) + components.profit;

  const landed = ownLanded + components.cost;
  const preDiscount = landed + (gross ?? 0);
  const discount =
    discountPercent !== null ? preDiscount * (discountPercent / 100) : 0;
  // The discount comes out of your margin, never out of your cost — which is
  // why a discount deep enough to sell below cost shows as a negative profit
  // rather than quietly shrinking what the thing cost to make.
  const profit = gross === null ? (discount ? -discount : null) : gross - discount;

  const total = landed + (profit ?? 0); // price before tax
  const tax = cost.taxPercent !== null ? total * (cost.taxPercent / 100) : null;
  return {
    markupPercent,
    componentsCost: components.cost,
    componentsProfit: components.profit,
    discountPercent,
    discount,
    profit,
    effectiveMarkupPercent:
      profit !== null && landed > 0 ? (profit / landed) * 100 : null,
    total,
    taxPercent: cost.taxPercent,
    tax,
    price: total + (tax ?? 0),
  };
}

/** The per-part inputs to a landed cost — everything but the files themselves. */
export interface ModelCostInput {
  /** Resolved supply lines (rings, chains, inserts…), priced from the catalog. */
  supplyLines?: ResolvedSupply[];
  /** Resolved packaging consumables (bag, box…) — priced like supplies. */
  packagingLines?: ResolvedSupply[];
  /**
   * A candidate filament's rate. Raw materials are repriced from each file's
   * slice at this rate, so the same analysis can be costed against several
   * filaments without re-reading the 3MFs. Null prices by the per-material table.
   */
  overridePerKg?: number | null;
  /** The part's waste buffer (some parts fail more); defaults to the global. */
  efficiency?: number;
  /** Prep/clean/package time, in minutes. Per what, `laborBasis` says. */
  laborMinutes?: number;
  /**
   * Whether those minutes are spent per finished piece ("part", the default) or
   * on the whole plate ("plate", divided by `yieldUnits` like the print is).
   */
  laborBasis?: LaborBasis;
  /** Flat shipping fee for this part (already resolved to a number). */
  shipping?: number;
  /** Profit markup % for this part; defaults to the global. */
  markupPercent?: number | null;
  /** The failure-risk level, echoed in the rates for the tooltips. */
  riskLevel?: string | null;
  /** Rolled-up component lines, when this model composes others. */
  components?: ComponentRollup;
  /**
   * Finished units one run of the sliced plate produces. A plate of 21 keycaps
   * is one print and 21 sellable things, so filament and machine divide by this.
   * Everything else (supplies, labor, packaging, shipping) is already per-unit.
   */
  yieldUnits?: number;
  /** Percent off the pre-tax total, for a kit that sells below sum-of-parts. */
  discountPercent?: number | null;
}

/**
 * The landed cost per `out/` group. Returns null when there's nothing to price —
 * no sliced files and no per-part costs — so the detail page can skip the card.
 */
export function estimateModelCost(
  files: ModelFile[],
  summaries: ThreeMfFileSummary[],
  cost: CostConfig,
  input: ModelCostInput = {},
): ModelCost | null {
  const {
    supplyLines = [],
    packagingLines = [],
    overridePerKg = null,
    efficiency = cost.failureRisk.medium,
    laborMinutes = 0,
    laborBasis = "part",
    shipping = 0,
    markupPercent = cost.markupPercent,
    riskLevel = null,
    components = EMPTY_ROLLUP,
    yieldUnits = 1,
    discountPercent = null,
  } = input;

  // A bad `yield:` must never divide a cost into nothing or into infinity.
  const units = Number.isFinite(yieldUnits) && yieldUnits >= 1 ? yieldUnits : 1;

  const lineTotal = (lines: ResolvedSupply[]) =>
    lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  const purchased = lineTotal(supplyLines);
  const packaging = lineTotal(packagingLines);
  const unresolved = [...supplyLines, ...packagingLines]
    .filter((line) => line.supply === null)
    .map((line) => line.item);

  const laborRate = cost.laborPerHour ?? 20;
  // Time spent on the whole plate divides by the yield, exactly as the filament
  // and machine do — five minutes to de-support 52 keycaps is not five minutes
  // per keycap. Time spent on one finished piece does not.
  const laborUnits = laborBasis === "plate" ? units : 1;
  const labor =
    laborMinutes > 0 ? ((laborMinutes / 60) * laborRate) / laborUnits : 0;

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
    // Divide by the yield here rather than at the group, so the expanded
    // per-file breakdown adds up to the figure it is expanding. Grams and
    // seconds go with them: a keycap really is 5 g and 16 min, and the plate's
    // own totals stay recoverable from `rates.yieldUnits`.
    const slice = summary!.slice!;
    bucket.raw += (priced.rawMaterials ?? 0) / units;
    bucket.machine += (priced.machine ?? 0) / units;
    bucket.count += 1;
    bucket.items.push({
      label: file.name,
      relPath: file.relPath,
      grams: slice.grams === null ? null : slice.grams / units,
      seconds: slice.seconds === null ? null : slice.seconds / units,
      rawMaterials: (priced.rawMaterials ?? 0) / units,
      machine: (priced.machine ?? 0) / units,
    });
    print.set(key, bucket);
  }

  const hasExtras =
    supplyLines.length > 0 ||
    packagingLines.length > 0 ||
    // Without this a README holding nothing but `components:` prices to null
    // and shows no card at all — which is exactly what a kit folder is.
    components.lines.length > 0 ||
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
      // What this model costs on its own, before its components. The kit's own
      // markup applies to exactly this; each component brings its own.
      const ownLanded =
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
        landed: ownLanded + components.totalCost,
        ...applyMargins(
          ownLanded,
          cost,
          markupPercent,
          { cost: components.totalCost, profit: components.totalProfit },
          discountPercent,
        ),
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
    componentLines: components.lines,
    rates: {
      efficiency,
      riskLevel,
      filamentPerKg: overridePerKg,
      machine: machineRateBreakdown(cost, efficiency),
      laborPerHour: laborRate,
      laborMinutes,
      laborBasis,
      yieldUnits: units,
    },
    unresolved,
  };
}
