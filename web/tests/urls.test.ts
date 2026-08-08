import { describe, expect, it } from "vitest";

import {
  fileUrl,
  fontUrl,
  iconUrl,
  modelUrl,
  supplyImageUrl,
  supplyUrl,
} from "../lib/urls";

describe("url builders", () => {
  it("encodes each path segment but keeps the separators", () => {
    expect(fileUrl("keychains/GAME BOY+GBA.3mf")).toBe(
      "/files/keychains/GAME%20BOY%2BGBA.3mf",
    );
    expect(modelUrl("keychains/ysisi nametag")).toBe(
      "/models/keychains/ysisi%20nametag",
    );
  });

  it("does not encode the slashes between segments", () => {
    expect(fileUrl("a/b/c.png")).toBe("/files/a/b/c.png");
  });

  it("adds a ?download suffix only when asked", () => {
    expect(fontUrl("sans/Inter.ttf")).toBe("/font-files/sans/Inter.ttf");
    expect(fontUrl("sans/Inter.ttf", { download: true })).toBe(
      "/font-files/sans/Inter.ttf?download",
    );
    expect(iconUrl("ui/home.svg")).toBe("/icon-files/ui/home.svg");
    expect(iconUrl("ui/home.svg", { download: true })).toBe(
      "/icon-files/ui/home.svg?download",
    );
  });

  it("builds a supply photo url from its filename", () => {
    expect(supplyImageUrl("jump-ring-gold-4mm.webp")).toBe(
      "/supply-files/jump-ring-gold-4mm.webp",
    );
    // Ids are lower-kebab, but a file dropped in by hand need not be.
    expect(supplyImageUrl("bolsa de celofán.png")).toBe(
      "/supply-files/bolsa%20de%20celof%C3%A1n.png",
    );
  });

  it("builds a supply's page url from its id", () => {
    expect(supplyUrl("jump-ring-gold-4mm")).toBe(
      "/supplies/jump-ring-gold-4mm",
    );
    // An id written by hand can hold anything the writer didn't normalise.
    expect(supplyUrl("bolsa 5x3")).toBe("/supplies/bolsa%205x3");
  });
});
