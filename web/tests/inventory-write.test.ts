import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config";
import {
  deleteFilament,
  InventoryError,
  saveCost,
  saveFilament,
  saveSupply,
  type CostInput,
} from "../lib/inventory-write";
import { TEST_CONFIG } from "./setup";

/**
 * Every test runs against a throwaway COPY of the fixture's catalog.yaml, so
 * the writer's mutations never touch the checked-in vault.
 */
let tempConfig: string;
const readConfig = () => readFileSync(tempConfig, "utf8");

beforeEach(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "piezario-write-"));
  tempConfig = path.join(dir, "catalog.yaml");
  copyFileSync(TEST_CONFIG, tempConfig);
  process.env.CATALOG_CONFIG = tempConfig;
});

afterEach(() => {
  // Restore the global guard so read-only tests keep hitting the real vault.
  process.env.CATALOG_CONFIG = TEST_CONFIG;
});

describe("saveFilament", () => {
  it("adds a new filament, normalises its id and re-sorts the list", async () => {
    const id = await saveFilament({
      id: "PLA Silk Gold",
      name: "PLA Silk Gold",
      material: "PLA",
      price_per_kg: 22,
      colors: [{ name: "Gold", hex: "#FFD700" }],
    });
    expect(id).toBe("pla-silk-gold");

    const filaments = loadConfig().filaments;
    const added = filaments.find((f) => f.id === "pla-silk-gold")!;
    expect(added.material).toBe("PLA");
    expect(added.pricePerKg).toBe(22);
    expect(added.colors).toEqual([{ name: "Gold", hex: "#FFD700" }]);
    expect(filaments).toHaveLength(3); // the two fixtures + this one
  });

  it("replaces an existing filament with the same id", async () => {
    await saveFilament({
      id: "pla-black",
      name: "PLA Basic Black",
      material: "PLA",
      price_per_kg: 19.5,
    });
    const filaments = loadConfig().filaments;
    expect(filaments.filter((f) => f.id === "pla-black")).toHaveLength(1);
    expect(filaments.find((f) => f.id === "pla-black")!.pricePerKg).toBe(19.5);
  });

  it("preserves the file's comments", async () => {
    await saveFilament({
      id: "x",
      name: "X",
      material: "PLA",
      price_per_kg: 10,
    });
    const text = readConfig();
    expect(text).toContain("# The landed-cost knobs");
    expect(text).toContain("# Where generators drop their meshes");
  });

  it("rejects a filament missing required fields", async () => {
    await expect(
      saveFilament({ id: "y", name: "Y", price_per_kg: 10 }),
    ).rejects.toBeInstanceOf(InventoryError); // no material
    await expect(
      saveFilament({ id: "z", name: "Z", material: "PLA" }),
    ).rejects.toBeInstanceOf(InventoryError); // no price
  });
});

describe("saveSupply", () => {
  it("adds a supply, defaulting the unit to 'piece'", async () => {
    const id = await saveSupply({ id: "chain", name: "Chain 10cm", price: 0.4 });
    expect(id).toBe("chain");
    const chain = loadConfig().supplies.find((s) => s.id === "chain")!;
    expect(chain.unit).toBe("piece");
    expect(chain.price).toBe(0.4);
  });

  it("rejects a supply with no price", async () => {
    await expect(
      saveSupply({ id: "glue", name: "Glue" }),
    ).rejects.toBeInstanceOf(InventoryError);
  });
});

describe("deleteFilament", () => {
  it("removes a filament by id and is a no-op for unknown ids", async () => {
    await deleteFilament("pla-black");
    expect(loadConfig().filaments.map((f) => f.id)).toEqual(["petg-clear"]);
    await deleteFilament("not-there"); // no throw
    expect(loadConfig().filaments).toHaveLength(1);
  });
});

describe("saveCost", () => {
  const fullCost: CostInput = {
    currency: "$",
    filament_per_kg: 22,
    filament_per_kg_by_type: { PLA: 18, PETG: 25 },
    failure_risk: { low: 1.1, medium: 1.3, high: 1.7 },
    printer_price: 500,
    maintenance_cost: 100,
    lifespan_hours: 5000,
    power_watts: 120,
    electricity_per_kwh: 0.15,
    labor_per_hour: 20,
    shipping_cost: 2,
    tax_percent: 8,
    markup_percent: 50,
  };

  it("updates a cost value in place and keeps its inline comment", async () => {
    await saveCost(fullCost);
    expect(loadConfig().cost.filamentPerKg).toBe(22);
    // The comment sitting on the filament_per_kg line survives the edit.
    expect(readConfig()).toContain(
      "# default spool price when a material has no own rate",
    );
  });

  it("deletes a cleared numeric value, restoring its default (null)", async () => {
    await saveCost({ ...fullCost, markup_percent: null });
    expect(loadConfig().cost.markupPercent).toBeNull();
    expect(readConfig()).not.toContain("markup_percent");
  });
});
