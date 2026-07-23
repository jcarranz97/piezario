import { describe, expect, it } from "vitest";

import type { CostConfig } from "../lib/config";
import {
  estimateCost,
  formatMoney,
  machineRateBreakdown,
  machineRatePerHour,
} from "../lib/cost";
import type { ThreeMfSlice } from "../lib/threemf";

/** A fully-populated cost config; individual tests null out fields as needed. */
function baseCost(overrides: Partial<CostConfig> = {}): CostConfig {
  return {
    currency: "$",
    filamentPerKg: 20,
    filamentPerKgByType: { PLA: 18, PETG: 25 },
    failureRisk: { low: 1.1, medium: 1.3, high: 1.7 },
    printerPrice: 500,
    maintenanceCost: 100,
    lifespanHours: 5000,
    powerWatts: 120,
    electricityPerKwh: 0.15,
    laborPerHour: 20,
    shippingCost: 2,
    taxPercent: 8,
    markupPercent: 50,
    ...overrides,
  };
}

function slice(overrides: Partial<ThreeMfSlice> = {}): ThreeMfSlice {
  return {
    grams: null,
    seconds: null,
    printer: null,
    nozzle: null,
    supports: null,
    filaments: [],
    ...overrides,
  };
}

describe("machineRateBreakdown", () => {
  it("splits depreciation and electricity and applies the buffer", () => {
    const rate = machineRateBreakdown(baseCost(), 1.3)!;
    expect(rate.depreciation).toBeCloseTo((500 + 100) / 5000, 10); // 0.12
    expect(rate.electricity).toBeCloseTo((120 / 1000) * 0.15, 10); // 0.018
    expect(rate.buffer).toBe(1.3);
    expect(rate.perHour).toBeCloseTo((0.12 + 0.018) * 1.3, 10);
  });

  it("works with only the depreciation half configured", () => {
    const rate = machineRateBreakdown(
      baseCost({ powerWatts: null, electricityPerKwh: null }),
      1,
    )!;
    expect(rate.electricity).toBe(0);
    expect(rate.perHour).toBeCloseTo(0.12, 10);
  });

  it("returns null when neither half can be computed", () => {
    expect(
      machineRateBreakdown(
        baseCost({
          printerPrice: null,
          lifespanHours: null,
          powerWatts: null,
          electricityPerKwh: null,
        }),
      ),
    ).toBeNull();
    expect(
      machineRatePerHour(
        baseCost({
          printerPrice: null,
          lifespanHours: null,
          powerWatts: null,
          electricityPerKwh: null,
        }),
      ),
    ).toBeNull();
  });
});

describe("estimateCost", () => {
  it("prices from the plate total when there is no per-filament breakdown", () => {
    const est = estimateCost(
      slice({ grams: 100, seconds: 3600 }),
      baseCost(),
      null,
      1.0, // efficiency 1.0 to isolate the base numbers
    )!;
    expect(est.perMaterial).toBe(false);
    // 100 g at $20/kg = $2.00 raw material.
    expect(est.rawMaterials).toBeCloseTo(2.0, 10);
    // 1 hour at the machine rate (buffer 1.0 here) = 0.138.
    expect(est.machine).toBeCloseTo(0.12 + 0.018, 10);
    expect(est.subtotal).toBeCloseTo(est.rawMaterials! + est.machine!, 10);
  });

  it("prices each filament at its own material rate when weighed", () => {
    const est = estimateCost(
      slice({
        grams: 150,
        filaments: [
          { id: 1, grams: 100, metres: null, type: "PLA", colour: null },
          { id: 2, grams: 50, metres: null, type: "PETG", colour: null },
        ],
      }),
      baseCost(),
      null,
      1.0,
    )!;
    expect(est.perMaterial).toBe(true);
    // 100 g PLA @ 18 + 50 g PETG @ 25 = 1.8 + 1.25 = 3.05.
    expect(est.rawMaterials).toBeCloseTo(1.8 + 1.25, 10);
  });

  it("lets an explicit per-kg override win over the material table", () => {
    const est = estimateCost(
      slice({
        filaments: [{ id: 1, grams: 100, metres: null, type: "PLA", colour: null }],
      }),
      baseCost(),
      30, // override $30/kg
      1.0,
    )!;
    expect(est.rawMaterials).toBeCloseTo(3.0, 10);
  });

  it("applies the waste buffer to filament", () => {
    const est = estimateCost(slice({ grams: 100 }), baseCost(), null, 1.5)!;
    // 100 g @ $20/kg = $2.00, ×1.5 buffer = $3.00.
    expect(est.rawMaterials).toBeCloseTo(3.0, 10);
  });

  it("returns null when nothing can be priced", () => {
    expect(estimateCost(slice(), baseCost(), null, 1.0)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats to two decimals with the currency prefix", () => {
    expect(formatMoney(2.0304, "$")).toBe("$2.03");
    expect(formatMoney(0, "€")).toBe("€0.00");
  });
});
