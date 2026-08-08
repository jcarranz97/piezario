import { beforeAll, describe, expect, it } from "vitest";

import { type Model, getModels } from "../lib/catalog";
import { loadConfig } from "../lib/config";
import { MAX_COMPONENT_DEPTH, resolveComponents } from "../lib/kit-cost";
import type { ComponentRollup } from "../lib/model-cost";

/**
 * Turning a README's `components:` into a priced rollup, against the fixture
 * vault. The arithmetic itself is pinned down in `kit-cost.test.ts`.
 */

let models: Model[];
let index: Map<string, Model>;

const bySlug = (slug: string) => index.get(slug)!;
const roll = (slug: string): Promise<ComponentRollup> =>
  resolveComponents(bySlug(slug), index, loadConfig());
const line = (rollup: ComponentRollup, slug: string) =>
  rollup.lines.find((entry) => entry.slug === slug)!;

beforeAll(async () => {
  models = await getModels();
  index = new Map(models.map((model) => [model.slug, model]));
});

describe("resolveComponents", () => {
  it("prices every line and keeps the ones it cannot", async () => {
    const kit = await roll("kits/starter-kit");
    expect(kit.lines.map((l) => l.slug)).toEqual([
      "keychains/ysisi-nametag",
      "gadgets/box",
      "ghosts/nope",
    ]);
    expect(kit.totalCost).toBeCloseTo(
      kit.lines.reduce((sum, l) => sum + l.lineCost, 0),
      10,
    );
  });

  it("surfaces a slug that names no model instead of dropping it", async () => {
    const missing = line(await roll("kits/starter-kit"), "ghosts/nope");
    expect(missing.issue).toBe("missing");
    expect(missing.lineCost).toBe(0);
    expect(missing.lineProfit).toBe(0);
    // The title falls back to the slug, so the card can still name the problem.
    expect(missing.title).toBe("ghosts/nope");
    expect(missing.note).toMatch(/renamed or moved/);
  });

  it("honours the per-line include, and always brings the print", async () => {
    const kit = await roll("kits/starter-kit");
    const nametag = line(kit, "keychains/ysisi-nametag");
    const box = line(kit, "gadgets/box");

    // ysisi-nametag: default include, so its 3 key rings ($0.30) and 5 minutes
    // of labour ($1.67) carry over — but not packaging or shipping.
    const config = loadConfig();
    const labour = (5 / 60) * (config.cost.laborPerHour ?? 20);
    expect(nametag.unitCost).toBeCloseTo(0.3 + labour, 8);
    // Its own 60% markup rides along, which is the whole point of retail mode.
    expect(nametag.unitProfit).toBeCloseTo(nametag.unitCost * 0.6, 8);
    expect(nametag.lineCost).toBeCloseTo(nametag.unitCost * 2, 8);

    // box: `include: []`, and its out/ 3MF is an empty placeholder with no
    // slice — so there is nothing at all to price, and it says so rather than
    // quietly costing zero.
    expect(box.unitCost).toBe(0);
    expect(box.issue).toBe("unpriceable");
    expect(box.note).toMatch(/Nothing to price/);
  });

  it("warns when a part has no sliced file, but not when it is a kit", async () => {
    // A part whose .3mf never made it into an output folder prices its print at
    // nothing — the mx-clicker-base shape, and the one that silently undercuts.
    const partKit: Model = {
      ...bySlug("kits/plain"),
      components: [
        { model: "keychains/ysisi-nametag", qty: 1, include: ["labor"] },
      ],
    };
    const part = (await resolveComponents(partKit, index, loadConfig())).lines[0];
    expect(part.fileCount).toBe(0);
    expect(part.issue).toBe("no-print");
    expect(part.note).toMatch(/output folder/);

    // A component that is itself a kit has no geometry by design, so the same
    // "no sliced file" fact is not a problem worth flagging.
    const nested = (await roll("kits/loop-a")).lines[0];
    expect(nested.fileCount).toBe(0);
    expect(nested.issue).toBeNull();
  });

  it("divides a multi-up plate by its yield", async () => {
    // gadgets/plate is 100 g / 1 h with `yield: 4`, so a line for it is one
    // widget rather than the whole plate.
    const plate = bySlug("gadgets/plate");
    const kit: Model = {
      ...bySlug("kits/plain"),
      components: [{ model: "gadgets/plate", qty: 1, include: [] }],
    };
    const only = (await resolveComponents(kit, index, loadConfig())).lines[0];

    expect(only.issue).toBeNull();
    expect(only.yieldUnits).toBe(4);
    expect(only.fileCount).toBe(1);
    // 25 g and 15 min per widget, not 100 g and an hour.
    expect(only.plateGrams).toBeCloseTo(25, 6);
    expect(only.plateSeconds).toBeCloseTo(900, 6);
    // 25 g × 1.1 low-risk buffer @ $18/kg (its cost_filament-less PLA match).
    expect(only.unitCost).toBeGreaterThan(0);
    expect(only.unitCost).toBeLessThan(0.75);
    expect(plate.yieldUnits).toBe(4);
  });

  it("uses each component's own labour basis, not the kit's", async () => {
    // gadgets/plate declares 2 minutes *per plate* of 4, so a line for it
    // carries 30 seconds of work rather than two minutes.
    const rate = loadConfig().cost.laborPerHour ?? 20;
    const kit: Model = {
      ...bySlug("kits/plain"),
      components: [{ model: "gadgets/plate", qty: 1, include: ["labor"] }],
    };
    const perPlate = (await resolveComponents(kit, index, loadConfig())).lines[0];

    // The same model read as per-part, for the contrast.
    const asPerPart = new Map(index);
    asPerPart.set("gadgets/plate", {
      ...bySlug("gadgets/plate"),
      laborBasis: "part",
    });
    const perPart = (await resolveComponents(kit, asPerPart, loadConfig()))
      .lines[0];

    expect(perPart.unitCost - perPlate.unitCost).toBeCloseTo(
      ((2 / 60) * rate * 3) / 4, // the three quarters that were being charged
      8,
    );
  });

  it("stops at a cycle instead of recursing forever", async () => {
    // loop-a contains loop-b, which contains loop-a.
    const a = await roll("kits/loop-a");
    expect(a.lines).toHaveLength(1);
    const b = a.lines[0];
    expect(b.slug).toBe("kits/loop-b");
    expect(b.issue).toBeNull();

    // loop-b resolves, but *its* line back to loop-a is refused — so loop-b
    // prices at exactly its own 1 minute of labour and nothing more. Anything
    // above that would mean the loop had been walked at least once.
    const labourRate = loadConfig().cost.laborPerHour ?? 20;
    expect(b.unitCost).toBeCloseTo(labourRate / 60, 8);

    // The same from the other end, so neither direction is the special case.
    const inner = await resolveComponents(
      bySlug("kits/loop-b"),
      index,
      loadConfig(),
    );
    expect(inner.lines[0].slug).toBe("kits/loop-a");
    expect(inner.lines[0].unitCost).toBeCloseTo(labourRate / 60, 8);
  });

  it("refuses a chain nested deeper than the cap", async () => {
    // A synthetic chain: each link contains the next, deeper than the limit.
    const chain: Model[] = [];
    const depth = MAX_COMPONENT_DEPTH + 2;
    for (let i = 0; i < depth; i += 1) {
      chain.push({
        ...bySlug("kits/plain"),
        slug: `chain/${i}`,
        title: `Chain ${i}`,
        components:
          i + 1 < depth
            ? [{ model: `chain/${i + 1}`, qty: 1, include: ["labor"] }]
            : [],
      });
    }
    const deepIndex = new Map(index);
    for (const link of chain) {
      deepIndex.set(link.slug, link);
    }

    let rollup = await resolveComponents(chain[0], deepIndex, loadConfig());
    let hops = 0;
    // Walk down the chain until a line refuses to go further.
    while (rollup.lines.length > 0 && rollup.lines[0].issue === null) {
      hops += 1;
      rollup = await resolveComponents(
        deepIndex.get(rollup.lines[0].slug)!,
        deepIndex,
        loadConfig(),
      );
      if (hops > depth + 2) {
        throw new Error("the chain never terminated");
      }
    }
    expect(hops).toBeLessThanOrEqual(depth);
  });

  it("returns the empty rollup for a model that composes nothing", async () => {
    const plain = await roll("kits/plain");
    expect(plain.lines).toEqual([]);
    expect(plain.totalCost).toBe(0);
    expect(plain.totalProfit).toBe(0);
  });

  it("prices a component listed twice to the same figures", async () => {
    const kit: Model = {
      ...bySlug("kits/plain"),
      components: [
        { model: "keychains/ysisi-nametag", qty: 1, include: ["supplies"] },
        { model: "gadgets/plate", qty: 2, include: ["supplies"] },
      ],
    };
    const first = (await resolveComponents(kit, index, loadConfig())).lines;
    const second = (await resolveComponents(kit, index, loadConfig())).lines;
    // The per-render memo must not make the second read differ from the first.
    expect(second).toEqual(first);
  });
});
