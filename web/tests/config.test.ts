import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  failureRiskFactor,
  isExcluded,
  loadConfig,
  matchesPattern,
} from "../lib/config";
import { TEST_VAULT } from "./setup";

describe("matchesPattern", () => {
  it("matches a bare pattern against the folder name at any depth", () => {
    expect(matchesPattern("out", "gadgets/box/out", ["out"])).toBe(true);
    expect(matchesPattern("out", "out", ["out"])).toBe(true);
    expect(matchesPattern("keep", "a/keep", ["out"])).toBe(false);
  });

  it("matches a pattern containing '/' against the relative path", () => {
    expect(matchesPattern("scratch", "examples/scratch", ["examples/scratch"])).toBe(
      true,
    );
    // Same name but a different path does not match a path-scoped pattern.
    expect(matchesPattern("scratch", "other/scratch", ["examples/scratch"])).toBe(
      false,
    );
  });

  it("treats '*' as a within-segment wildcard", () => {
    expect(matchesPattern("draft.bak", "x/draft.bak", ["*.bak"])).toBe(true);
    expect(matchesPattern("draft.txt", "x/draft.txt", ["*.bak"])).toBe(false);
  });
});

describe("isExcluded", () => {
  it("always excludes dotfiles and dot-folders", () => {
    expect(isExcluded(".git", ".git", [])).toBe(true);
    expect(isExcluded(".venv", "a/.venv", [])).toBe(true);
  });

  it("otherwise defers to the patterns", () => {
    expect(isExcluded("node_modules", "node_modules", ["node_modules"])).toBe(true);
    expect(isExcluded("models", "models", ["node_modules"])).toBe(false);
  });
});

describe("failureRiskFactor", () => {
  const cost = loadConfig().cost;

  it("maps a level to its factor, defaulting to medium", () => {
    expect(failureRiskFactor(cost, "low")).toBe(1.1);
    expect(failureRiskFactor(cost, "high")).toBe(1.7);
    expect(failureRiskFactor(cost, "medium")).toBe(1.3);
    expect(failureRiskFactor(cost, null)).toBe(1.3);
    expect(failureRiskFactor(cost, "nonsense")).toBe(1.3);
  });
});

describe("loadConfig (against the fixture vault)", () => {
  const config = loadConfig();

  it("resolves the roots relative to catalog.yaml", () => {
    expect(config.modelsDir).toBe(path.join(TEST_VAULT, "models"));
    expect(config.fontsDir).toBe(path.join(TEST_VAULT, "fonts"));
    expect(config.iconsDir).toBe(path.join(TEST_VAULT, "icons"));
    expect(config.file).toBe(path.join(TEST_VAULT, "catalog.yaml"));
  });

  it("reads the exclude and output-dir lists", () => {
    expect(config.exclude).toEqual(["node_modules", "scratch"]);
    expect(config.outputDirs).toEqual(["out"]);
  });

  it("parses the cost section, upper-casing the per-material keys", () => {
    expect(config.cost.currency).toBe("$");
    expect(config.cost.filamentPerKg).toBe(20);
    expect(config.cost.filamentPerKgByType).toEqual({ PLA: 18, PETG: 25 });
    expect(config.cost.failureRisk).toEqual({ low: 1.1, medium: 1.3, high: 1.7 });
    expect(config.cost.markupPercent).toBe(50);
    expect(config.cost.taxPercent).toBe(8);
  });

  it("parses filaments and supplies, keeping ids and colours", () => {
    expect(config.filaments.map((f) => f.id)).toEqual(["pla-black", "petg-clear"]);
    const black = config.filaments.find((f) => f.id === "pla-black")!;
    expect(black.material).toBe("PLA");
    expect(black.colors).toEqual([{ name: "Black", hex: "#000000" }]);
    expect(config.supplies).toHaveLength(3);
    expect(config.supplies[0]).toMatchObject({
      id: "keyring",
      unit: "piece",
      price: 0.1,
      category: "Hardware",
      image: "keyring.png",
    });
  });

  it("reads a legacy packaged supply as one purchase", () => {
    const bag = config.supplies.find((s) => s.id === "jump-ring")!;
    expect(bag.purchases).toHaveLength(1);
    expect(bag.purchases[0]).toMatchObject({
      packagePrice: 5,
      packageQty: 100,
      useForPrice: true,
    });
    // What the cost card reads: $5 for 100 is 5c each.
    expect(bag.price).toBe(0.05);
  });

  it("reads a legacy bare price as a purchase of one, keeping its link", () => {
    const single = config.supplies.find((s) => s.id === "keyring")!;
    expect(single.price).toBe(0.1);
    expect(single.purchases).toEqual([
      {
        date: null,
        url: "https://www.amazon.com/dp/EXAMPLE",
        notes: null,
        packagePrice: 0.1,
        packageQty: 1,
        useForPrice: true,
      },
    ]);
  });

  it("weights the average by quantity, not by purchase", () => {
    const washer = config.supplies.find((s) => s.id === "washer")!;
    // $25 spent on 110 units. A plain mean of 50c and 20c would be 35c, and
    // would let the 10-unit purchase count as much as the 100-unit one.
    expect(washer.price).toBeCloseTo(25 / 110, 10);
    expect(washer.price).not.toBeCloseTo(0.35, 2);
  });

  it("leaves an unticked purchase out of the price but keeps it on record", () => {
    const washer = config.supplies.find((s) => s.id === "washer")!;
    expect(washer.purchases).toHaveLength(3);
    const excluded = washer.purchases.find((p) => !p.useForPrice)!;
    expect(excluded.packagePrice).toBe(100);
    // Counting it would drag 22.7c up past a dollar.
    expect(washer.price!).toBeLessThan(0.25);
  });

  it("sorts purchases newest first, reading dates quoted or not", () => {
    const washer = config.supplies.find((s) => s.id === "washer")!;
    expect(washer.purchases.map((p) => p.date)).toEqual([
      "2026-08-01", // unquoted in the fixture — js-yaml hands us a Date
      "2026-07-01", // quoted — a plain string
      "2026-06-01",
    ]);
  });

  it("reads the description, and the older `notes:` spelling of it", () => {
    expect(config.supplies.find((s) => s.id === "washer")!.description).toBe(
      "Zinc-plated. The M6 ones, not M5.",
    );
    expect(config.supplies.find((s) => s.id === "keyring")!.description).toBe(
      "Split rings, not solid ones.",
    );
  });

  it("keeps a note against the purchase it belongs to", () => {
    const washer = config.supplies.find((s) => s.id === "washer")!;
    // Newest first, and only that one carries a note.
    expect(washer.purchases[0].notes).toBe("Free postage over $15.");
    expect(washer.purchases[1].notes).toBeNull();
  });

  it("keeps an http(s) purchase link and drops anything else", () => {
    const washer = config.supplies.find((s) => s.id === "washer")!;
    expect(washer.purchases.find((p) => p.url)!.url).toBe(
      "https://shop.example.com/washers",
    );
    // The value is typed into a form and rendered as an href, so a scheme that
    // would execute on click never reaches the UI.
    const ring = config.supplies.find((s) => s.id === "jump-ring")!;
    expect(ring.purchases[0].url).toBeNull();
  });

  it("resolves the supply images folder from the config", () => {
    expect(config.supplyImagesDir).toBe(
      path.join(TEST_VAULT, "assets", "supplies"),
    );
  });
});
