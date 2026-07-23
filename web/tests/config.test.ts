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
    expect(config.supplies).toHaveLength(1);
    expect(config.supplies[0]).toMatchObject({
      id: "keyring",
      unit: "piece",
      price: 0.1,
      category: "Hardware",
    });
  });
});
