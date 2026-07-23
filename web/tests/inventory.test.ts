import { describe, expect, it } from "vitest";

import { getFilaments, getSupplies, resolveSupply } from "../lib/inventory";

describe("getFilaments", () => {
  it("returns every spool sorted by name", () => {
    const names = getFilaments().map((f) => f.name);
    expect(names).toEqual(["PETG Clear", "PLA Basic Black"]);
  });
});

describe("getSupplies", () => {
  it("returns supplies sorted by category then name", () => {
    const supplies = getSupplies();
    expect(supplies.map((s) => s.id)).toEqual(["keyring"]);
  });
});

describe("resolveSupply", () => {
  it("finds a supply by id, case-insensitively", () => {
    expect(resolveSupply("keyring")!.name).toBe("Key ring 25mm");
    expect(resolveSupply("KEYRING")!.id).toBe("keyring");
  });

  it("returns null for an unknown or empty id", () => {
    expect(resolveSupply("missing")).toBeNull();
    expect(resolveSupply(null)).toBeNull();
    expect(resolveSupply("")).toBeNull();
  });
});
