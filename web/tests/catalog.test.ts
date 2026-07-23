import { describe, expect, it } from "vitest";

import { getModel, getModels, type Model } from "../lib/catalog";

// The scanner is async and re-reads the vault on each call; load once.
let models: Model[];
const bySlug = (slug: string) => models.find((m) => m.slug === slug);

describe("getModels (against the fixture vault)", () => {
  it("finds every leaf folder and nothing that isn't a model", async () => {
    models = await getModels();
    const slugs = models.map((m) => m.slug).sort();
    expect(slugs).toEqual([
      "decor/vase",
      "gadgets/box",
      "keychains/pets/chispi",
      "keychains/ysisi-nametag",
    ]);
    // Excluded category and the empty folder never appear.
    expect(slugs.some((s) => s.startsWith("scratch"))).toBe(false);
    expect(slugs).not.toContain("empty");
  });

  it("derives categories from the folder path", () => {
    expect(bySlug("keychains/ysisi-nametag")!.categories).toEqual(["keychains"]);
    expect(bySlug("keychains/pets/chispi")!.categories).toEqual([
      "keychains",
      "pets",
    ]);
    expect(bySlug("gadgets/box")!.categories).toEqual(["gadgets"]);
  });

  it("reads frontmatter and normalises tags, materials and supplies", () => {
    const m = bySlug("keychains/ysisi-nametag")!;
    expect(m.title).toBe("Ysisi Nametag");
    expect(m.description).toBe("A custom keychain nametag.");
    // Tags are lower-cased, de-duped and sorted.
    expect(m.tags).toEqual(["gift", "keychain"]);
    // Materials keep the author's case and order.
    expect(m.materials).toEqual(["PLA", "PETG"]);
    // Two lines for the same supply merge their quantities (2 + 1).
    expect(m.supplies).toEqual([{ item: "keyring", qty: 3 }]);
    expect(m.failureRisk).toBe("low");
    expect(m.laborMinutes).toBe(5);
    expect(m.markupPercent).toBe(60);
    expect(m.costFilament).toBe("pla-black");
    expect(m.date).toBe("2026-05-01");
    expect(m.cover).toBe("keychains/ysisi-nametag/cover.png");
  });

  it("derives a title and description when there is no frontmatter", () => {
    const chispi = bySlug("keychains/pets/chispi")!;
    expect(chispi.title).toBe("Chispi"); // from the folder name
    expect(chispi.hasReadme).toBe(false);

    const vase = bySlug("decor/vase")!;
    expect(vase.title).toBe("Vase");
    expect(vase.description).toMatch(/single-wall spiral vase/);
  });

  it("treats an out/ folder as output belonging to the model, not a category", () => {
    const box = bySlug("gadgets/box")!;
    // box stays a model even though it contains a subfolder.
    expect(box.title).toBe("Box");
    const outputs = box.files.filter((f) => f.isOutput).map((f) => f.name);
    expect(outputs).toContain("out/box.stl");
    expect(outputs).toContain("out/box.gcode.3mf");
    // Script + mesh/print present → parametric and printable capabilities.
    expect(box.capabilities.sort()).toEqual(["parametric", "printable"]);
  });

  it("detects a LICENSE file sitting in the folder", () => {
    const vase = bySlug("decor/vase")!;
    expect(vase.licenseFile).not.toBeNull();
    expect(vase.licenseFile!.name).toBe("LICENSE");
    expect(vase.licenseFile!.detected).toBe("MIT");
  });

  it("sorts an explicitly-dated model ahead of undated ones", () => {
    // ysisi-nametag is the only model with a `date:`, so it comes first.
    expect(models[0].slug).toBe("keychains/ysisi-nametag");
  });
});

describe("getModel", () => {
  it("returns a single model by slug, or null when unknown", async () => {
    expect((await getModel("decor/vase"))!.title).toBe("Vase");
    expect(await getModel("does/not/exist")).toBeNull();
  });
});
