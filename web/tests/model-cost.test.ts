import { describe, expect, it } from "vitest";

import type { ModelFile } from "../lib/catalog";
import type { CostConfig, SupplyItem } from "../lib/config";
import {
  estimateModelCost,
  resolveSupplies,
} from "../lib/model-cost";
import type { ThreeMfFileSummary, ThreeMfSlice } from "../lib/threemf";

function baseCost(overrides: Partial<CostConfig> = {}): CostConfig {
  return {
    currency: "$",
    filamentPerKg: 20,
    filamentPerKgByType: {},
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

const keyring: SupplyItem = {
  id: "keyring",
  name: "Key ring",
  unit: "piece",
  price: 0.1,
  category: null,
  notes: null,
};

function slice(grams: number, seconds: number): ThreeMfSlice {
  return { grams, seconds, printer: null, nozzle: null, supports: null, filaments: [] };
}

function outputFile(name: string): ModelFile {
  return { name, relPath: `m/${name}`, kind: "print", size: 1, isOutput: true };
}

function summary(name: string, s: ThreeMfSlice | null): ThreeMfFileSummary {
  return { label: name, tools: [], slice: s, cost: null };
}

describe("resolveSupplies", () => {
  it("joins each line to its catalog entry and prices it", () => {
    const resolved = resolveSupplies(
      [{ item: "keyring", qty: 2 }],
      (id) => (id === "keyring" ? keyring : null),
    );
    expect(resolved[0]).toMatchObject({ item: "keyring", qty: 2, lineTotal: 0.2 });
  });

  it("leaves lineTotal null when the id is unknown", () => {
    const resolved = resolveSupplies([{ item: "ghost", qty: 3 }], () => null);
    expect(resolved[0].supply).toBeNull();
    expect(resolved[0].lineTotal).toBeNull();
  });
});

describe("estimateModelCost", () => {
  it("returns null when there are no files and no per-part extras", () => {
    expect(estimateModelCost([], [], baseCost(), [], [])).toBeNull();
  });

  it("builds the Estimate group and the full landed→price chain", () => {
    const files = [outputFile("out/box.gcode.3mf")];
    const summaries = [summary("out/box.gcode.3mf", slice(100, 3600))];
    const supplyLines = resolveSupplies(
      [{ item: "keyring", qty: 2 }],
      () => keyring,
    );

    const result = estimateModelCost(
      files,
      summaries,
      baseCost(),
      supplyLines,
      [], // packaging
      null, // overridePerKg → use plate/material rate
      1.0, // efficiency (isolate the base numbers)
      5, // labor minutes
      2, // shipping
      50, // markup %
    )!;

    expect(result).not.toBeNull();
    expect(result.groups).toHaveLength(1);
    const g = result.groups[0];
    expect(g.label).toBe("Estimate");
    expect(g.isEstimate).toBe(true);
    expect(g.fileCount).toBe(1);

    // 100 g @ $20/kg = $2.00 raw; 1 h machine @ (0.12+0.018) = 0.138.
    expect(g.rawMaterials).toBeCloseTo(2.0, 10);
    expect(g.machine).toBeCloseTo(0.138, 10);
    expect(g.purchased).toBeCloseTo(0.2, 10);
    expect(g.shipping).toBe(2);
    expect(g.labor).toBeCloseTo((5 / 60) * 20, 10); // 1.6667

    const landed = 2.0 + 0.138 + 0.2 + 0 + 2 + (5 / 60) * 20;
    expect(g.landed).toBeCloseTo(landed, 8);
    // Markup applies before tax: profit on landed, tax on the marked-up price.
    expect(g.profit).toBeCloseTo(landed * 0.5, 8);
    expect(g.total).toBeCloseTo(landed * 1.5, 8);
    expect(g.tax).toBeCloseTo(landed * 1.5 * 0.08, 8);
    expect(g.price).toBeCloseTo(landed * 1.5 * 1.08, 8);

    expect(result.suppliesTotal).toBeCloseTo(0.2, 10);
    expect(result.unresolved).toEqual([]);
  });

  it("splits files into an Estimate group and per-subfolder batches", () => {
    const files = [
      outputFile("out/ref.gcode.3mf"),
      outputFile("out/batch1/a.gcode.3mf"),
      outputFile("out/batch1/b.gcode.3mf"),
    ];
    const summaries = [
      summary("out/ref.gcode.3mf", slice(100, 0)),
      summary("out/batch1/a.gcode.3mf", slice(50, 0)),
      summary("out/batch1/b.gcode.3mf", slice(50, 0)),
    ];

    const result = estimateModelCost(
      files,
      summaries,
      baseCost(),
      [],
      [],
      null,
      1.0,
    )!;

    const labels = result.groups.map((g) => g.label);
    expect(labels).toEqual(["Estimate", "batch1"]); // Estimate sorts first
    const batch = result.groups.find((g) => g.label === "batch1")!;
    expect(batch.fileCount).toBe(2);
    // 50 g + 50 g @ $20/kg = $2.00 raw for the batch.
    expect(batch.rawMaterials).toBeCloseTo(2.0, 10);
  });

  it("flags supply ids that aren't in the catalog as unresolved", () => {
    const supplyLines = resolveSupplies([{ item: "ghost", qty: 1 }], () => null);
    const result = estimateModelCost(
      [],
      [],
      baseCost(),
      supplyLines,
      [],
    )!;
    expect(result).not.toBeNull();
    expect(result.unresolved).toEqual(["ghost"]);
  });
});
