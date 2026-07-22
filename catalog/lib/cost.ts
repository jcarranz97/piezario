import type { CostConfig } from "./config";
import type { ThreeMfSlice } from "./threemf";

/**
 * A single sliced file's contribution to the landed cost: raw materials plus
 * machine time.
 *
 * **Raw materials** is filament weight × a waste buffer × the per-kg rate. The
 * buffer (the "efficiency factor", 1.1 by default) exists because a slicer
 * assumes every print succeeds; over many parts, failures, jams and defects eat
 * more filament than the file says. **Machine cost** is print time × an hourly
 * rate that captures the printer wearing out plus the power it draws.
 *
 * The other landed-cost components — purchased materials (supplies), packaging,
 * labor — are per-part, not per-file, so they're added in `model-cost.ts`, and
 * tax/markup apply to the whole landed total, never here.
 */
export interface CostEstimate {
  currency: string;
  /** Filament cost with the waste buffer applied. */
  rawMaterials: number | null;
  /** Machine time at the computed hourly rate. */
  machine: number | null;
  /** rawMaterials + machine — this file's slice of the landed cost. */
  subtotal: number;
  /** True when per-filament weights were priced individually by material. */
  perMaterial: boolean;
}

/**
 * The rate for a material.
 *
 * A model's cost card can price against a specific filament; when it does,
 * `overridePerKg` is that spool's price and it wins for every weight. Otherwise
 * the per-material table applies, then the flat default.
 */
function rateFor(
  type: string | null,
  cost: CostConfig,
  overridePerKg: number | null,
): number | null {
  if (overridePerKg !== null) {
    return overridePerKg;
  }
  if (type) {
    const specific = cost.filamentPerKgByType[type.toUpperCase()];
    if (Number.isFinite(specific)) {
      return specific;
    }
  }
  return cost.filamentPerKg;
}

/** The machine hourly rate broken into its parts. */
export interface MachineRate {
  /** Printer wear per hour (price + maintenance ÷ lifespan), before buffer. */
  depreciation: number;
  /** Electricity per hour, before buffer. */
  electricity: number;
  /** The waste buffer applied (the same efficiency factor used for filament). */
  buffer: number;
  /** (depreciation + electricity) × buffer — the rate actually charged. */
  perHour: number;
}

/**
 * The machine's cost per hour, built up the Print Farm Academy way:
 *
 *   depreciation = (printer price + lifetime maintenance) / lifetime hours
 *   power        = (watts / 1000) × price per kWh
 *   rate         = (depreciation + power) × waste buffer
 *
 * The waste buffer is the same **efficiency factor** applied to filament: a
 * failed print wastes the same percentage of machine time as material. It's
 * per-part, so it's passed in; it defaults to the global factor for previews.
 * Returns null when there isn't enough configured to compute either part.
 */
export function machineRateBreakdown(
  cost: CostConfig,
  efficiency: number = cost.failureRisk.medium,
): MachineRate | null {
  let depreciation = 0;
  let electricity = 0;
  let have = false;
  if (cost.printerPrice !== null && cost.lifespanHours) {
    depreciation = (cost.printerPrice + (cost.maintenanceCost ?? 0)) / cost.lifespanHours;
    have = true;
  }
  if (cost.powerWatts !== null && cost.electricityPerKwh !== null) {
    electricity = (cost.powerWatts / 1000) * cost.electricityPerKwh;
    have = true;
  }
  if (!have) {
    return null;
  }
  const buffer = efficiency || 1;
  return {
    depreciation,
    electricity,
    buffer,
    perHour: (depreciation + electricity) * buffer,
  };
}

/** The machine rate per hour, or null when not enough is configured. */
export function machineRatePerHour(
  cost: CostConfig,
  efficiency: number = cost.failureRisk.medium,
): number | null {
  return machineRateBreakdown(cost, efficiency)?.perHour ?? null;
}

export function estimateCost(
  slice: ThreeMfSlice,
  cost: CostConfig,
  overridePerKg: number | null = null,
  /** Waste buffer to apply to filament weight; defaults to the global one. */
  efficiency: number = cost.failureRisk.medium,
): CostEstimate | null {
  let filament: number | null = null;
  let perMaterial = false;

  // Price each filament at its own material rate when the slicer broke the
  // weight down — a two-colour print in PLA and TPU is not one blended price.
  const weighed = slice.filaments.filter((entry) => entry.grams !== null);
  if (weighed.length > 0) {
    let total = 0;
    let priced = 0;
    for (const entry of weighed) {
      const rate = rateFor(entry.type, cost, overridePerKg);
      if (rate !== null) {
        total += (entry.grams! / 1000) * rate;
        priced += 1;
      }
    }
    if (priced > 0) {
      filament = total;
      perMaterial = true;
    }
  }

  // Fall back to the plate total when there is no per-filament breakdown.
  const plateRate = overridePerKg ?? cost.filamentPerKg;
  if (filament === null && slice.grams !== null && plateRate !== null) {
    filament = (slice.grams / 1000) * plateRate;
  }

  const rawMaterials = filament !== null ? filament * efficiency : null;

  // The same waste buffer applies to machine time (a reprint costs both).
  const machineRate = machineRatePerHour(cost, efficiency);
  const machine =
    slice.seconds !== null && machineRate !== null
      ? (slice.seconds / 3600) * machineRate
      : null;

  if (rawMaterials === null && machine === null) {
    return null;
  }

  return {
    currency: cost.currency,
    rawMaterials,
    machine,
    subtotal: (rawMaterials ?? 0) + (machine ?? 0),
    perMaterial,
  };
}

/** 2.0304 → "$2.03". */
export function formatMoney(value: number, currency: string): string {
  return `${currency}${value.toFixed(2)}`;
}
