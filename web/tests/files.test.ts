import { describe, expect, it } from "vitest";

import {
  capabilitiesFor,
  classify,
  formatSize,
  type FileKind,
} from "../lib/files";

describe("classify", () => {
  it("maps known extensions to their kind, case-insensitively", () => {
    expect(classify("part.3mf")).toBe("print");
    expect(classify("PART.GCODE")).toBe("print");
    expect(classify("mesh.stl")).toBe("mesh");
    expect(classify("solid.step")).toBe("cad");
    expect(classify("gen.py")).toBe("script");
    expect(classify("cover.PNG")).toBe("image");
    expect(classify("readme.md")).toBe("doc");
  });

  it("falls back to 'other' for unknown or extension-less names", () => {
    expect(classify("thing.xyz")).toBe("other");
    expect(classify("Makefile")).toBe("other");
    // A leading dot is not an extension.
    expect(classify(".gitignore")).toBe("other");
  });
});

describe("capabilitiesFor", () => {
  it("derives capabilities from the kinds present", () => {
    expect(capabilitiesFor(["mesh"])).toEqual(["printable"]);
    expect(capabilitiesFor(["print"])).toEqual(["printable"]);
    expect(capabilitiesFor(["script"])).toEqual(["parametric"]);
    expect(capabilitiesFor(["cad"])).toEqual(["editable"]);
  });

  it("orders printable, parametric, editable and dedupes overlapping kinds", () => {
    const kinds: FileKind[] = ["cad", "script", "mesh", "print", "image", "doc"];
    expect(capabilitiesFor(kinds)).toEqual([
      "printable",
      "parametric",
      "editable",
    ]);
  });

  it("returns nothing when no kind implies a capability", () => {
    expect(capabilitiesFor(["image", "doc", "other"])).toEqual([]);
  });
});

describe("formatSize", () => {
  it("keeps bytes under 1 KiB as bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
  });

  it("scales up and keeps one decimal below 10 units", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("rounds to a whole number at 10 units and above", () => {
    expect(formatSize(20 * 1024 * 1024)).toBe("20 MB");
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});
