import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CatalogError } from "../lib/model-path";
import { deleteSupplyImage, saveSupplyImage } from "../lib/supply-image";
import { TEST_CONFIG } from "./setup";

/**
 * The writer resolves its folder from the config, so pointing
 * `CATALOG_SUPPLY_IMAGES_DIR` at a temp dir keeps every write out of the
 * checked-in fixture vault.
 */
let root: string;

beforeEach(() => {
  root = path.join(mkdtempSync(path.join(os.tmpdir(), "piezario-img-")), "sup");
  process.env.CATALOG_SUPPLY_IMAGES_DIR = root;
});

afterEach(() => {
  delete process.env.CATALOG_SUPPLY_IMAGES_DIR;
  process.env.CATALOG_CONFIG = TEST_CONFIG;
});

/** Real magic bytes, then filler — enough for the sniff, cheap to build. */
function image(kind: "png" | "webp" | "jpg", bytes = 32): File {
  const magic = {
    png: [0x89, 0x50, 0x4e, 0x47],
    webp: [0x52, 0x49, 0x46, 0x46],
    jpg: [0xff, 0xd8, 0xff],
  }[kind];
  const buffer = new Uint8Array(bytes);
  buffer.set(magic, 0);
  return new File([buffer], `whatever.${kind}`);
}

describe("saveSupplyImage", () => {
  it("names the file after the supply and creates the folder", async () => {
    const name = await saveSupplyImage("jump-ring-gold-4mm", image("webp"));
    expect(name).toBe("jump-ring-gold-4mm.webp");
    expect(existsSync(path.join(root, name))).toBe(true);
  });

  it("takes the extension from the content, not the filename", async () => {
    // A PNG uploaded as "photo.webp" is still a PNG.
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])], "a.webp");
    expect(await saveSupplyImage("ring", png)).toBe("ring.png");
  });

  it("refuses anything that isn't an image it can serve", async () => {
    const exe = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "x.png");
    await expect(saveSupplyImage("ring", exe)).rejects.toBeInstanceOf(
      CatalogError,
    );
    await expect(saveSupplyImage("ring", new File([], "x.png"))).rejects.toThrow(
      /empty/,
    );
  });

  it("caps the size, since the form is meant to shrink it first", async () => {
    await expect(
      saveSupplyImage("ring", image("png", 3 * 1024 * 1024)),
    ).rejects.toThrow(/2 MB/);
  });

  it("keeps a crafted id inside the folder", async () => {
    // Sanitising turns the separators into hyphens, so it cannot escape — and
    // an id that sanitises to nothing is refused outright.
    expect(await saveSupplyImage("../../etc/passwd", image("png"))).toBe(
      "etc-passwd.png",
    );
    await expect(saveSupplyImage("../..", image("png"))).rejects.toBeInstanceOf(
      CatalogError,
    );
  });

  it("removes the old file when the format changes", async () => {
    await saveSupplyImage("ring", image("png"));
    expect(existsSync(path.join(root, "ring.png"))).toBe(true);
    await saveSupplyImage("ring", image("webp"));
    expect(existsSync(path.join(root, "ring.webp"))).toBe(true);
    // Otherwise the png stays committed, referenced by nothing.
    expect(existsSync(path.join(root, "ring.png"))).toBe(false);
  });

  it("overwrites the photo a supply already had", async () => {
    await saveSupplyImage("ring", image("png", 8));
    await saveSupplyImage("ring", image("png", 64));
    expect(readFileSync(path.join(root, "ring.png"))).toHaveLength(64);
  });
});

describe("deleteSupplyImage", () => {
  it("removes the file", async () => {
    const name = await saveSupplyImage("ring", image("png"));
    await deleteSupplyImage(name);
    expect(existsSync(path.join(root, name))).toBe(false);
  });

  it("does nothing for a blank name or one it never wrote", async () => {
    await deleteSupplyImage("");
    await deleteSupplyImage(null);
    await deleteSupplyImage("nope.png");
  });

  it("refuses to follow a stored name out of the folder", async () => {
    const outside = path.join(root, "..", "keep.txt");
    await saveSupplyImage("ring", image("png")); // creates the folder
    writeFileSync(outside, "not ours");
    await deleteSupplyImage("../keep.txt");
    expect(existsSync(outside)).toBe(true);
  });
});
