import { describe, expect, it } from "vitest";

import { fileUrl, fontUrl, iconUrl, modelUrl } from "../lib/urls";

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
});
