import { describe, expect, it } from "vitest";

import type { ModelFile } from "../lib/catalog";
import type { CostConfig, SupplyItem } from "../lib/config";
import {
  type ComponentRollup,
  type ResolvedComponent,
  EMPTY_ROLLUP,
  candidateFilaments,
  estimateModelCost,
  preferredFilament,
  resolveSupplies,
} from "../lib/model-cost";
import type { ThreeMfFileSummary, ThreeMfSlice } from "../lib/threemf";

/**
 * The kit arithmetic, tested as pure functions: hand-built rollups in, numbers
 * out, no filesystem. `kit-resolve.test.ts` covers the other half — turning a
 * README's `components:` into one of these rollups.
 */

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

/** A priced component line. Only the money fields matter to these tests. */
function component(
  slug: string,
  qty: number,
  unitCost: number,
  unitProfit: number,
): ResolvedComponent {
  return {
    slug,
    title: slug,
    qty,
    include: ["supplies", "labor"],
    groupLabel: "Estimate",
    filamentLabel: null,
    yieldUnits: 1,
    plateGrams: null,
    plateSeconds: null,
    fileCount: 1,
    unitCost,
    unitProfit,
    lineCost: unitCost * qty,
    lineProfit: unitProfit * qty,
    issue: null,
    note: null,
  };
}

function rollup(...lines: ResolvedComponent[]): ComponentRollup {
  return {
    lines,
    totalCost: lines.reduce((sum, line) => sum + line.lineCost, 0),
    totalProfit: lines.reduce((sum, line) => sum + line.lineProfit, 0),
  };
}

/** What one of these components would sell for on its own card. */
function ownPrice(line: ResolvedComponent, taxPercent: number): number {
  return (line.unitCost + line.unitProfit) * (1 + taxPercent / 100);
}

function slice(grams: number, seconds: number): ThreeMfSlice {
  return {
    grams,
    seconds,
    printer: null,
    nozzle: null,
    supports: null,
    filaments: [],
  };
}

function outputFile(name: string): ModelFile {
  return { name, relPath: `m/${name}`, kind: "print", size: 1, isOutput: true };
}

function summary(name: string, s: ThreeMfSlice | null): ThreeMfFileSummary {
  return { label: name, tools: [], slice: s, cost: null };
}

describe("a model composed of other models", () => {
  it("prices a kit at what its parts add up to, taxed exactly once", () => {
    // Three parts, each with its own back-solved margin — the case the whole
    // feature exists for: 3 bases + 3 keycaps + 1 lip balm holder.
    const parts = rollup(
      component("clickers/base", 3, 1.2, 0.6),
      component("clickers/keycap", 3, 0.15, 0.09),
      component("keychains/lip-balm", 1, 0.9, 1.13),
    );

    const result = estimateModelCost([], [], baseCost(), {
      components: parts,
      // A kit folder holds only a README: no files, no supplies, no labour.
      markupPercent: 50,
    })!;

    expect(result).not.toBeNull();
    const g = result.groups[0];

    const byHand = parts.lines.reduce(
      (sum, line) => sum + line.qty * ownPrice(line, 8),
      0,
    );
    // The headline guarantee: the same number you get adding the parts' own
    // prices up by hand, which is what this replaces.
    expect(g.price).toBeCloseTo(byHand, 8);

    // Tax is charged once, on the whole pre-tax total — not once per part.
    expect(g.tax).toBeCloseTo(g.total * 0.08, 10);
    expect(g.price).not.toBeCloseTo(byHand * 1.08, 4);
  });

  it("splits the parts' cost into landed and their margins into profit", () => {
    const parts = rollup(component("a", 2, 1, 0.5), component("b", 1, 3, 1.5));
    const result = estimateModelCost([], [], baseCost(), {
      components: parts,
      laborMinutes: 6, // the kit's own assembly time
      markupPercent: 50,
    })!;
    const g = result.groups[0];

    const ownLanded = (6 / 60) * 20; // $2.00 of labour, and nothing else
    expect(g.componentsCost).toBeCloseTo(5, 10); // 2×1 + 1×3
    expect(g.componentsProfit).toBeCloseTo(2.5, 10); // 2×0.5 + 1×1.5
    expect(g.landed).toBeCloseTo(ownLanded + 5, 10);
    // The kit's own markup applies to its own $2, never to the parts.
    expect(g.profit).toBeCloseTo(ownLanded * 0.5 + 2.5, 10);
    expect(g.markupPercent).toBe(50); // still the model's own, not blended
    expect(g.total).toBeCloseTo(g.landed + g.profit!, 10);
    expect(g.effectiveMarkupPercent).toBeCloseTo(
      (g.profit! / g.landed) * 100,
      10,
    );
  });

  it("takes a kit discount out of the margin, never out of the cost", () => {
    const parts = rollup(component("a", 1, 10, 5));
    const result = estimateModelCost([], [], baseCost(), {
      components: parts,
      markupPercent: 0,
      discountPercent: 20,
    })!;
    const g = result.groups[0];

    expect(g.landed).toBeCloseTo(10, 10); // untouched by the discount
    expect(g.discount).toBeCloseTo((10 + 5) * 0.2, 10); // 20% of the pre-tax 15
    expect(g.profit).toBeCloseTo(5 - 3, 10);
    expect(g.total).toBeCloseTo(12, 10);
    expect(g.price).toBeCloseTo(12 * 1.08, 10);
    // landed + profit === total holds, so every existing consumer still works.
    expect(g.landed + g.profit!).toBeCloseTo(g.total, 10);
  });

  it("shows a discount deeper than the margin as selling below cost", () => {
    const result = estimateModelCost([], [], baseCost(), {
      components: rollup(component("a", 1, 10, 1)),
      markupPercent: 0,
      discountPercent: 50,
    })!;
    const g = result.groups[0];
    // Not clamped: a price below cost is a real thing that must be visible.
    expect(g.profit).toBeLessThan(0);
    expect(g.total).toBeLessThan(g.landed);
  });

  it("multiplies both the cost and the margin by the quantity", () => {
    const one = estimateModelCost([], [], baseCost(), {
      components: rollup(component("a", 1, 2, 1)),
      markupPercent: 0,
    })!.groups[0];
    const three = estimateModelCost([], [], baseCost(), {
      components: rollup(component("a", 3, 2, 1)),
      markupPercent: 0,
    })!.groups[0];

    expect(three.componentsCost).toBeCloseTo(one.componentsCost * 3, 10);
    expect(three.componentsProfit).toBeCloseTo(one.componentsProfit * 3, 10);
  });

  it("gives a components-only model a cost card at all", () => {
    // Without the components check in `hasExtras` this returns null and the kit
    // page shows no cost card — the folder has no files and no supplies.
    const result = estimateModelCost([], [], baseCost(), {
      components: rollup(component("a", 1, 2, 1)),
    });
    expect(result).not.toBeNull();
    expect(result!.groups).toHaveLength(1);
    expect(result!.groups[0].isEstimate).toBe(true);
    expect(result!.componentLines).toHaveLength(1);
  });

  it("leaves a model with no components exactly as it was", () => {
    const files = [outputFile("out/box.gcode.3mf")];
    const summaries = [summary("out/box.gcode.3mf", slice(100, 3600))];
    const supplyLines = resolveSupplies([{ item: "keyring", qty: 2 }], () => ({
      id: "keyring",
      name: "Key ring",
      unit: "piece",
      price: 0.1,
      purchases: [],
      image: null,
      category: null,
      description: null,
    }) as SupplyItem);

    const withOut = estimateModelCost(files, summaries, baseCost(), {
      supplyLines,
      efficiency: 1.0,
      laborMinutes: 5,
      shipping: 2,
      markupPercent: 50,
    })!;
    const withEmpty = estimateModelCost(files, summaries, baseCost(), {
      supplyLines,
      efficiency: 1.0,
      laborMinutes: 5,
      shipping: 2,
      markupPercent: 50,
      components: EMPTY_ROLLUP,
      yieldUnits: 1,
      discountPercent: null,
    })!;

    expect(withEmpty.groups[0]).toEqual(withOut.groups[0]);
    // And the numbers are still the ones model-cost.test.ts pins down.
    const landed = 2.0 + 0.138 + 0.2 + 2 + (5 / 60) * 20;
    expect(withOut.groups[0].landed).toBeCloseTo(landed, 8);
    expect(withOut.groups[0].price).toBeCloseTo(landed * 1.5 * 1.08, 8);
    expect(withOut.groups[0].componentsCost).toBe(0);
    expect(withOut.groups[0].discount).toBe(0);
  });
});

describe("yield: a plate is not a unit", () => {
  const files = [outputFile("out/plate.gcode.3mf")];
  const summaries = [summary("out/plate.gcode.3mf", slice(100, 3600))];

  it("divides filament and machine, and nothing else", () => {
    const plate = estimateModelCost(files, summaries, baseCost(), {
      efficiency: 1.0,
      laborMinutes: 6,
      shipping: 2,
      markupPercent: 0,
    })!.groups[0];
    const perUnit = estimateModelCost(files, summaries, baseCost(), {
      efficiency: 1.0,
      laborMinutes: 6,
      shipping: 2,
      markupPercent: 0,
      yieldUnits: 4,
    })!.groups[0];

    expect(perUnit.rawMaterials).toBeCloseTo(plate.rawMaterials / 4, 10);
    expect(perUnit.machine).toBeCloseTo(plate.machine / 4, 10);
    // Labour and shipping are already written per finished piece.
    expect(perUnit.labor).toBeCloseTo(plate.labor, 10);
    expect(perUnit.shipping).toBe(plate.shipping);
  });

  it("divides per-plate labour by the yield, and per-part labour never", () => {
    // 5 minutes at $20/hr is $1.67 of work either way; what changes is whether
    // that is 5 minutes on one keycap or 5 minutes on all 52 of them.
    const perPart = estimateModelCost(files, summaries, baseCost(), {
      efficiency: 1.0,
      laborMinutes: 5,
      yieldUnits: 4,
    })!.groups[0];
    const perPlate = estimateModelCost(files, summaries, baseCost(), {
      efficiency: 1.0,
      laborMinutes: 5,
      laborBasis: "plate",
      yieldUnits: 4,
    })!.groups[0];

    expect(perPart.labor).toBeCloseTo((5 / 60) * 20, 10);
    expect(perPlate.labor).toBeCloseTo((5 / 60) * 20 / 4, 10);
    // Nothing else moves — the print was already per unit in both.
    expect(perPlate.rawMaterials).toBeCloseTo(perPart.rawMaterials, 10);
    expect(perPlate.landed).toBeCloseTo(
      perPart.landed - (perPart.labor - perPlate.labor),
      10,
    );
  });

  it("leaves per-plate labour alone on a single-up plate", () => {
    // With no yield to divide by, the basis cannot change anything — so a model
    // that declares "per plate" before setting a yield is not quietly wrong.
    const result = estimateModelCost(files, summaries, baseCost(), {
      efficiency: 1.0,
      laborMinutes: 5,
      laborBasis: "plate",
    })!;
    expect(result.groups[0].labor).toBeCloseTo((5 / 60) * 20, 10);
    // The basis is still echoed, so the card can explain the line either way.
    expect(result.rates.laborBasis).toBe("plate");
    expect(result.rates.laborMinutes).toBe(5);
  });

  it("divides the per-file breakdown too, so it adds up to the row", () => {
    const g = estimateModelCost(files, summaries, baseCost(), {
      efficiency: 1.0,
      yieldUnits: 4,
    })!.groups[0];

    expect(g.files[0].grams).toBeCloseTo(25, 10);
    expect(g.files[0].seconds).toBeCloseTo(900, 10);
    const summed = g.files.reduce((sum, f) => sum + f.rawMaterials, 0);
    expect(summed).toBeCloseTo(g.rawMaterials, 10);
  });

  it("ignores a yield that would divide a cost into nothing", () => {
    for (const bad of [0, -3, Number.NaN]) {
      const g = estimateModelCost(files, summaries, baseCost(), {
        efficiency: 1.0,
        yieldUnits: bad,
      })!.groups[0];
      expect(g.rawMaterials).toBeCloseTo(2.0, 10);
    }
  });
});

describe("which filament a component is priced at", () => {
  const filaments = [
    {
      id: "pla-black",
      name: "PLA Black",
      material: "PLA",
      brand: null,
      colors: [],
      pricePerKg: 18,
      notes: null,
    },
    {
      id: "pla-white",
      name: "PLA White",
      material: "PLA",
      brand: null,
      colors: [],
      pricePerKg: 22,
      notes: null,
    },
    {
      id: "petg-clear",
      name: "PETG Clear",
      material: "PETG",
      brand: null,
      colors: [],
      pricePerKg: 25,
      notes: null,
    },
  ];

  it("offers only the filaments matching the model's materials", () => {
    expect(candidateFilaments(["PLA"], filaments).map((f) => f.id)).toEqual([
      "pla-black",
      "pla-white",
    ]);
    // Matching is case-insensitive, and a model listing none gets none.
    expect(candidateFilaments(["petg"], filaments).map((f) => f.id)).toEqual([
      "petg-clear",
    ]);
    expect(candidateFilaments([], filaments)).toEqual([]);
  });

  it("prefers the remembered filament, else the first match, else none", () => {
    const pla = candidateFilaments(["PLA"], filaments);
    expect(preferredFilament(pla, "pla-white")!.id).toBe("pla-white");
    // A remembered id that isn't a candidate isn't in the dropdown either.
    expect(preferredFilament(pla, "petg-clear")!.id).toBe("pla-black");
    expect(preferredFilament(pla, null)!.id).toBe("pla-black");
    expect(preferredFilament([], "pla-black")).toBeNull();
  });
});
