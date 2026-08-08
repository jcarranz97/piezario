import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveModelReadme, updateModelFrontmatter } from "../lib/write";
import { TEST_VAULT } from "./setup";

/**
 * The README writer, against a throwaway COPY of the fixture vault's models —
 * `lib/write.ts` is one of the three sanctioned writers, so it must never touch
 * the checked-in fixtures.
 */

let modelsDir: string;
const readme = (slug: string) =>
  matter(readFileSync(path.join(modelsDir, slug, "README.md"), "utf8"));

beforeEach(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "piezario-readme-"));
  modelsDir = path.join(dir, "models");
  cpSync(path.join(TEST_VAULT, "models"), modelsDir, { recursive: true });
  process.env.CATALOG_MODELS_DIR = modelsDir;
});

afterEach(() => {
  delete process.env.CATALOG_MODELS_DIR;
});

describe("saveModelReadme", () => {
  it("round-trips components, yield and the discount", async () => {
    await saveModelReadme(
      "kits/plain",
      {
        components: [
          { model: "clickers/base", qty: 3, include: ["supplies", "labor"] },
          { model: "keychains/lip-balm", qty: 1, include: [] },
        ],
        yield: 21,
        labor_basis: "plate",
        discount_percent: 15,
      },
      "# Plain\n\nBody text.",
    );

    const { data, content } = readme("kits/plain");
    expect(data.labor_basis).toBe("plate");
    expect(data.components).toEqual([
      { model: "clickers/base", qty: 3, include: ["supplies", "labor"] },
      { model: "keychains/lip-balm", qty: 1, include: [] },
    ]);
    expect(data.yield).toBe(21);
    expect(data.discount_percent).toBe(15);
    // The body is hand-written prose and must survive a metadata edit.
    expect(content.trim()).toBe("# Plain\n\nBody text.");
  });

  it("deletes the keys rather than writing an empty list or a zero", async () => {
    await saveModelReadme(
      "kits/plain",
      {
        components: [{ model: "clickers/base", qty: 1, include: [] }],
        yield: 4,
        discount_percent: 10,
      },
      "body",
    );
    expect(readme("kits/plain").data.components).toHaveLength(1);

    // Removing the last component must stop the model being a kit, rather than
    // leaving `components: []` behind for the reader to interpret.
    await saveModelReadme(
      "kits/plain",
      { components: [], yield: "", labor_basis: "", discount_percent: "" },
      "body",
    );
    const { data } = readme("kits/plain");
    expect(data).not.toHaveProperty("components");
    expect(data).not.toHaveProperty("yield");
    // "part" is the default, so it is never written — only "plate" is a fact.
    expect(data).not.toHaveProperty("labor_basis");
    expect(data).not.toHaveProperty("discount_percent");
  });

  it("leaves frontmatter keys it does not manage alone", async () => {
    // A key no version of the app knows about must survive a save untouched.
    const target = path.join(modelsDir, "kits/plain/README.md");
    writeFileSync(
      target,
      "---\ntitle: Plain\nrevisions:\n  hook:\n    rev: C\n---\n\nBody.\n",
    );

    await saveModelReadme("kits/plain", { components: [] }, "Body.");

    expect(readme("kits/plain").data.revisions).toEqual({ hook: { rev: "C" } });
  });
});

describe("updateModelFrontmatter", () => {
  it("writes the discount without touching the body or the other keys", async () => {
    // This is the path the cost card's target-price editor takes.
    await updateModelFrontmatter("keychains/ysisi-nametag", {
      discount_percent: 12.5,
    });

    const { data, content } = readme("keychains/ysisi-nametag");
    expect(data.discount_percent).toBe(12.5);
    expect(data.title).toBe("Ysisi Nametag");
    expect(data.markup_percent).toBe(60);
    expect(content).toMatch(/A custom keychain nametag for Ysisi/);
  });
});
