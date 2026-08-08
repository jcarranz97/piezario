import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../lib/config";
import {
  deleteFilament,
  deleteSupply,
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

/** The one-purchase shape most of these tests only need in passing. */
const bought = (package_price: number, package_qty = 1) => [
  { package_price, package_qty },
];

describe("saveSupply", () => {
  it("adds a supply, defaulting the unit to 'piece'", async () => {
    const id = await saveSupply({
      id: "chain",
      name: "Chain 10cm",
      purchases: bought(0.4),
    });
    expect(id).toBe("chain");
    const chain = loadConfig().supplies.find((s) => s.id === "chain")!;
    expect(chain.unit).toBe("piece");
    expect(chain.price).toBe(0.4);
  });

  it("rejects a supply with nothing usable as a price", async () => {
    await expect(
      saveSupply({ id: "glue", name: "Glue" }),
    ).rejects.toBeInstanceOf(InventoryError);
    await expect(
      saveSupply({ id: "glue", name: "Glue", purchases: [] }),
    ).rejects.toBeInstanceOf(InventoryError);
    // A row with a count but no price is a half-filled form, not a purchase.
    await expect(
      saveSupply({ id: "glue", name: "Glue", purchases: [{ package_qty: 5 }] }),
    ).rejects.toBeInstanceOf(InventoryError);
  });

  it("rejects a history where nothing is ticked", async () => {
    await expect(
      saveSupply({
        id: "glue",
        name: "Glue",
        purchases: [
          { package_price: 5, package_qty: 10, use_for_price: false },
        ],
      }),
    ).rejects.toThrow(/count toward the price/);
  });

  it("writes the history and prices it by weighted average", async () => {
    await saveSupply({
      id: "washer",
      name: "Washer",
      purchases: [
        { date: "2026-07-01", package_price: 5, package_qty: 10 },
        {
          date: "2026-08-01",
          url: "https://shop.example.com/w",
          package_price: 20,
          package_qty: 100,
        },
      ],
    });
    const yaml = readConfig();
    expect(yaml).toContain("purchases:");
    expect(yaml).toContain("package_qty: 100");

    const washer = loadConfig().supplies.find((s) => s.id === "washer")!;
    expect(washer.purchases).toHaveLength(2);
    // $25 over 110 units, not the 35c a plain mean of the rates would give.
    expect(washer.price).toBeCloseTo(25 / 110, 10);
  });

  it("only writes use_for_price when it is false", async () => {
    await saveSupply({
      id: "washer",
      name: "Washer",
      purchases: [
        { package_price: 5, package_qty: 10 },
        { package_price: 99, package_qty: 1, use_for_price: false },
      ],
    });
    const yaml = readConfig();
    // The default is to count, so a `true` on every row would be noise.
    expect(yaml).toContain("use_for_price: false");
    expect(yaml).not.toContain("use_for_price: true");
    expect(loadConfig().supplies.find((s) => s.id === "washer")!.price).toBe(0.5);
  });

  it("migrates a legacy flat supply to purchases on save", async () => {
    // jump-ring is `package_price: 5` / `package_qty: 100` / `url:` in the
    // fixture. Read it, save it back untouched, and the old keys should go.
    const before = loadConfig().supplies.find((s) => s.id === "jump-ring")!;
    await saveSupply({
      id: before.id,
      name: before.name,
      unit: before.unit ?? undefined,
      purchases: before.purchases.map((p) => ({
        date: p.date ?? undefined,
        url: p.url ?? undefined,
        package_price: p.packagePrice,
        package_qty: p.packageQty,
        use_for_price: p.useForPrice,
      })),
    });
    const after = loadConfig().supplies.find((s) => s.id === "jump-ring")!;
    expect(after.price).toBe(0.05);
    expect(after.purchases).toHaveLength(1);
    // The row is rebuilt from scratch, so the flat keys are simply not written.
    const row = readConfig().split("- id: jump-ring")[1].split("- id:")[0];
    expect(row).toContain("purchases:");
    expect(row).not.toMatch(/^\s{4}package_price:/m);
  });

  it("round-trips a purchase's date, link and note", async () => {
    await saveSupply({
      id: "chain",
      name: "Chain 10cm",
      purchases: [
        {
          date: "2026-08-08",
          url: "https://www.amazon.com/dp/ABC123",
          notes: "20% coupon applied.",
          package_price: 4,
          package_qty: 10,
        },
      ],
    });
    const chain = loadConfig().supplies.find((s) => s.id === "chain")!;
    expect(chain.purchases[0]).toMatchObject({
      date: "2026-08-08",
      url: "https://www.amazon.com/dp/ABC123",
      notes: "20% coupon applied.",
    });
  });

  it("writes the description, retiring the older `notes:` key", async () => {
    // keyring carries `notes:` in the fixture; saving migrates it.
    await saveSupply({
      id: "keyring",
      name: "Key ring 25mm",
      purchases: bought(0.1),
      description: "Split rings, not solid ones.",
    });
    expect(
      loadConfig().supplies.find((s) => s.id === "keyring")!.description,
    ).toBe("Split rings, not solid ones.");

    const row = readConfig().split("- id: keyring")[1].split("- id:")[0];
    expect(row).toContain("description:");
    // The supply's own `notes:` is gone — the word now belongs to purchases.
    expect(row).not.toMatch(/^\s{4}notes:/m);
  });

  it("keeps the photo filename, and the file's comments", async () => {
    await saveSupply({
      id: "keyring",
      name: "Key ring 25mm",
      purchases: bought(0.1),
      image: "keyring.png",
    });
    expect(loadConfig().supplies.find((s) => s.id === "keyring")!.image).toBe(
      "keyring.png",
    );
    expect(readConfig()).toContain("# The landed-cost knobs");
  });

  it("clears the photo when the image is blank", async () => {
    await saveSupply({
      id: "keyring",
      name: "Key ring 25mm",
      purchases: bought(0.1),
      image: "",
    });
    expect(loadConfig().supplies.find((s) => s.id === "keyring")!.image).toBeNull();
  });
});

describe("deleteSupply", () => {
  it("removes the supply and takes its photo with it", async () => {
    // The writer resolves the images folder beside catalog.yaml, which here is
    // the throwaway copy — so this never touches the fixture's own image.
    const images = path.join(path.dirname(tempConfig), "assets", "supplies");
    mkdirSync(images, { recursive: true });
    const photo = path.join(images, "keyring.png");
    writeFileSync(photo, "not really a png, but a file");

    await deleteSupply("keyring");

    expect(loadConfig().supplies.map((s) => s.id)).toEqual([
      "jump-ring",
      "washer",
    ]);
    expect(existsSync(photo)).toBe(false);
  });

  it("is a no-op for an unknown id", async () => {
    await deleteSupply("not-there");
    expect(loadConfig().supplies).toHaveLength(3);
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
