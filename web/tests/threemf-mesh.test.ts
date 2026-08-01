import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseThreeMfMesh } from "../lib/threemf-mesh";

/**
 * The 3MF mesh reader.
 *
 * Built against a synthetic file rather than a checked-in fixture: the shape
 * that matters here is the *structure* a generator writes (a basematerials
 * table, one object per coloured part, a components object assembling them,
 * and a sidecar naming filament slots), and writing it out inline documents
 * that structure far better than a binary blob would.
 */

/** One tetrahedron, enough to be a real mesh. */
function meshXml(offset: number): string {
  const vertices = [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
  ]
    .map(([x, y, z]) => `<vertex x="${x + offset}" y="${y}" z="${z}"/>`)
    .join("");
  const triangles = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ]
    .map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
    .join("");
  return `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh>`;
}

function buildThreeMf(): ArrayBuffer {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter"><resources>
<basematerials id="6">
<base name="cup-body" displaycolor="#FFFFFFFF"/>
<base name="cup-paw" displaycolor="#0000FFFF"/>
</basematerials>
<object id="1" type="model" pid="6" pindex="0">${meshXml(0)}</object>
<object id="2" type="model" pid="6" pindex="1">${meshXml(20)}</object>
<object id="5" type="model"><components><component objectid="1"/><component objectid="2"/></components></object>
</resources>
<build><item objectid="5" transform="1 0 0 0 1 0 0 0 1 78 128 0"/></build>
</model>`;

  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config><object id="5">
<part id="1" subtype="normal_part"><metadata key="name" value="cup-body"/><metadata key="extruder" value="1"/></part>
<part id="2" subtype="normal_part"><metadata key="name" value="cup-paw"/><metadata key="extruder" value="3"/></part>
</object></config>`;

  const zipped = zipSync({
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(settings),
  });
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

describe("parseThreeMfMesh", () => {
  const parts = parseThreeMfMesh(buildThreeMf());

  it("returns one part per coloured mesh, and skips the assembly object", () => {
    // Object 5 holds only <components>, so it is not a fourth part — its
    // children are already in the list.
    expect(parts).toHaveLength(2);
  });

  it("carries each part's own colour, dropping the 3MF alpha channel", () => {
    expect(parts.map((p) => p.color)).toEqual(["#ffffff", "#0000ff"]);
  });

  it("names parts from the material table, without the file's own stem", () => {
    expect(parts.map((p) => p.name)).toEqual(["body", "paw"]);
  });

  it("reads the filament slot from the sidecar, not from the colour", () => {
    // The slot is what actually prints; two parts can share a colour and
    // differ here, or differ in colour and share a slot.
    expect(parts.map((p) => p.extruder)).toEqual([1, 3]);
  });

  it("keeps each part's geometry to itself", () => {
    for (const part of parts) {
      expect(part.positions.length / 3).toBe(4);
      expect(part.indices.length / 3).toBe(4);
      // Indices are per-object in 3MF; a part must never index into another's
      // vertices, which is the bug that shows up as geometry exploding.
      expect(Math.max(...part.indices)).toBeLessThan(part.positions.length / 3);
    }
    // The two tetrahedra were written 20 mm apart and must stay apart.
    expect(parts[1].positions[0] - parts[0].positions[0]).toBe(20);
  });

  it("refuses a zip that is not a 3MF", () => {
    const notA3mf = zipSync({ "readme.txt": strToU8("hello") });
    const buffer = notA3mf.buffer.slice(
      notA3mf.byteOffset,
      notA3mf.byteOffset + notA3mf.byteLength,
    ) as ArrayBuffer;
    expect(() => parseThreeMfMesh(buffer)).toThrow(/no model/i);
  });
});
