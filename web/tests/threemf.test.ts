import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ModelFile } from "../lib/catalog";
import { analyseThreeMf } from "../lib/threemf";

/**
 * A 3MF is a ZIP. We synthesise minimal ones (just the two config entries the
 * parser reads) so the analyzer runs against real archives, not mocks.
 */
function modelSettings(objectName: string, parts: Array<[string, number]>): string {
  const body = parts
    .map(
      ([name, extruder]) => `
    <part id="${extruder}" subtype="normal_part">
      <metadata key="name" value="${name}"/>
      <metadata key="extruder" value="${extruder}"/>
    </part>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="${objectName}"/>${body}
  </object>
</config>`;
}

function sliceInfo(
  filaments: Array<{ id: number; grams: number; color: string; type?: string }>,
): string {
  const rows = filaments
    .map(
      (f) =>
        `    <filament id="${f.id}" type="${f.type ?? "PLA"}" used_g="${f.grams}" used_m="1.0" color="${f.color}"/>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="weight" value="${filaments.reduce((s, f) => s + f.grams, 0)}"/>
    <metadata key="prediction" value="3600"/>
    <metadata key="printer_model_id" value="C11"/>
    <metadata key="nozzle_diameters" value="0.4"/>
${rows}
  </plate>
</config>`;
}

function write3mf(
  dir: string,
  name: string,
  entries: Record<string, string>,
): ModelFile {
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [k, strToU8(v)]),
    ),
  );
  writeFileSync(path.join(dir, name), zipped);
  return { name, relPath: name, kind: "print", size: zipped.length };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "piezario-3mf-"));
});

afterAll(() => {
  // The OS temp dir is disposable; nothing here touches the fixture vault.
});

describe("analyseThreeMf", () => {
  it("parses parts, extruders, colours and the slice of a single 3MF", async () => {
    const file = write3mf(dir, "Frida.3mf", {
      "Metadata/model_settings.config": modelSettings("Frida", [
        ["Frida-body", 1],
        ["Frida-paw", 2],
      ]),
      "Metadata/slice_info.config": sliceInfo([
        { id: 1, grams: 8, color: "#000000FF" },
        { id: 2, grams: 4.5, color: "#FF0000FF" },
      ]),
    });

    const report = await analyseThreeMf([file], dir);
    expect(report.files).toHaveLength(1);
    const s = report.files[0];

    expect(s.label).toBe("Frida.3mf");
    // The RGBA alpha is dropped when it's FF.
    const tool2 = s.tools.find((t) => t.extruder === 2)!;
    expect(tool2.colour).toBe("#FF0000");
    expect(tool2.roles).toEqual(["paw"]); // object prefix stripped from the role

    expect(s.slice).not.toBeNull();
    expect(s.slice!.grams).toBeCloseTo(12.5, 10);
    expect(s.slice!.seconds).toBe(3600);
    expect(s.slice!.filaments.map((f) => f.id)).toEqual([1, 2]);

    // A single file can't disagree with anything.
    expect(report.checked).toEqual([]);
    expect(report.conflictingTools).toEqual([]);
    // With enough config in the vault, a cost is priced.
    expect(s.cost).not.toBeNull();
  });

  it("flags a tool the files disagree about", async () => {
    const a = write3mf(dir, "a.3mf", {
      "Metadata/model_settings.config": modelSettings("A", [["A-paw", 2]]),
      "Metadata/slice_info.config": sliceInfo([
        { id: 2, grams: 5, color: "#FF0000FF" }, // red
      ]),
    });
    const b = write3mf(dir, "b.3mf", {
      "Metadata/model_settings.config": modelSettings("B", [["B-paw", 2]]),
      "Metadata/slice_info.config": sliceInfo([
        { id: 2, grams: 5, color: "#00FF00FF" }, // green — clashes on tool 2
      ]),
    });

    const report = await analyseThreeMf([a, b], dir);
    expect(report.checked.sort()).toEqual(["a.3mf", "b.3mf"]);
    expect(report.comparedTools).toContain(2);
    expect(report.conflictingTools).toContain(2);
  });

  it("agrees when both files assign a tool the same way", async () => {
    const a = write3mf(dir, "c.3mf", {
      "Metadata/model_settings.config": modelSettings("C", [["C-paw", 2]]),
      "Metadata/slice_info.config": sliceInfo([{ id: 2, grams: 5, color: "#0000FFFF" }]),
    });
    const b = write3mf(dir, "d.3mf", {
      "Metadata/model_settings.config": modelSettings("D", [["D-paw", 2]]),
      "Metadata/slice_info.config": sliceInfo([{ id: 2, grams: 5, color: "#0000FFFF" }]),
    });

    const report = await analyseThreeMf([a, b], dir);
    expect(report.comparedTools).toContain(2);
    expect(report.conflictingTools).toEqual([]);
  });

  it("returns an empty report for a file that isn't a readable 3MF", async () => {
    writeFileSync(path.join(dir, "junk.3mf"), "not a zip");
    const report = await analyseThreeMf(
      [{ name: "junk.3mf", relPath: "junk.3mf", kind: "print", size: 9 }],
      dir,
    );
    expect(report.files).toEqual([]);
  });

  it("ignores files that aren't 3MFs at all", async () => {
    const report = await analyseThreeMf(
      [{ name: "readme.md", relPath: "readme.md", kind: "doc", size: 1 }],
      dir,
    );
    expect(report.files).toEqual([]);
  });
});
