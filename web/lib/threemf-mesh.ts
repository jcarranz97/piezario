import { unzipSync } from "fflate";

/**
 * Reading the *geometry* out of a 3MF, one mesh per coloured part.
 *
 * `threemf.ts` next door reads a sliced 3MF for costing: filaments, times,
 * weights. This reads the other half, the thing that has to be looked at. They
 * are kept apart because they share nothing but the zip: that one parses
 * G-code metadata a slicer wrote, this one parses the mesh a generator wrote.
 *
 * The reason to do this at all is that a 3MF keeps the part split a
 * multi-material print is *about*. A dog cup is one object with three parts,
 * the cup, the paw and the name, each carrying its own colour and its own
 * filament slot. An STL is one undifferentiated mesh, which is why the preview
 * used to be grey: the split simply is not in the file.
 *
 * This module deliberately imports nothing but `fflate`, so it runs in the
 * browser. That is the point: the mesh is hundreds of thousands of floats and
 * shipping it as JSON from a route would be far larger and slower than sending
 * the 3MF itself, which the file route already serves.
 */

export interface MeshPart {
  /** Part name from the file, e.g. "paw" (the model's own stem is stripped). */
  name: string;
  /** "#rrggbb" for display. */
  color: string;
  /** Bambu filament slot, when the sidecar config names one. */
  extruder: number | null;
  /** Flat xyz triples. */
  positions: Float32Array;
  indices: Uint32Array;
}

/** One attribute off an opening tag. */
function attr(tag: string, key: string): string | null {
  const match = tag.match(new RegExp(`\\b${key}="([^"]*)"`));
  return match ? match[1] : null;
}

/**
 * 3MF writes `#RRGGBBAA`; three.js wants `#RRGGBB`.
 *
 * The alpha is dropped rather than honoured. These are opaque plastics, and a
 * translucent preview would read as a rendering artifact rather than as a
 * material choice.
 */
function displayColour(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6,8}$/.test(hex)) {
    return null;
  }
  return `#${hex.slice(0, 6).toLowerCase()}`;
}

/**
 * The `<basematerials>` table: display colour and name, in `pindex` order.
 *
 * The generators name each material after the part it belongs to
 * ("custom-paw"), so this doubles as the part naming and the whole read stays
 * inside the model XML.
 */
function parseBaseMaterials(xml: string): { name: string; color: string | null }[] {
  const block = xml.match(/<basematerials\b[\s\S]*?<\/basematerials>/);
  if (!block) {
    return [];
  }
  const out: { name: string; color: string | null }[] = [];
  for (const tag of block[0].match(/<base\b[^>]*>/g) ?? []) {
    out.push({
      name: attr(tag, "name") ?? "",
      color: displayColour(attr(tag, "displaycolor")),
    });
  }
  return out;
}

/**
 * Filament slot per part, from `Metadata/model_settings.config`.
 *
 * This is the one that actually prints: Bambu Studio picks filament from this
 * sidecar and ignores the colour tags in the model body. Worth surfacing, so
 * the preview can say which slot a colour will come out of.
 */
function parseExtruders(xml: string): number[] {
  const out: number[] = [];
  for (const part of xml.match(/<part\b[\s\S]*?<\/part>/g) ?? []) {
    const meta = part.match(/<metadata\s+key="extruder"\s+value="(\d+)"/);
    out.push(meta ? Number(meta[1]) : 1);
  }
  return out;
}

/** Vertices and triangles of one `<mesh>`. */
function parseMesh(body: string): { positions: Float32Array; indices: Uint32Array } {
  const coords: number[] = [];
  const verts = body.match(/<vertex\b[^>]*>/g) ?? [];
  for (const tag of verts) {
    coords.push(
      Number(attr(tag, "x") ?? 0),
      Number(attr(tag, "y") ?? 0),
      Number(attr(tag, "z") ?? 0),
    );
  }

  const tris: number[] = [];
  for (const tag of body.match(/<triangle\b[^>]*>/g) ?? []) {
    tris.push(
      Number(attr(tag, "v1") ?? 0),
      Number(attr(tag, "v2") ?? 0),
      Number(attr(tag, "v3") ?? 0),
    );
  }

  return { positions: new Float32Array(coords), indices: new Uint32Array(tris) };
}

/** Strip the file's own stem: "custom-paw" reads better as "paw". */
function shortName(name: string, index: number): string {
  const dash = name.lastIndexOf("-");
  const tail = dash > 0 ? name.slice(dash + 1) : name;
  return tail || `part ${index + 1}`;
}

/**
 * Every printable part in a 3MF, with the colour it was written with.
 *
 * Objects that only assemble other objects (a `<components>` wrapper, which is
 * how a Bambu 3MF makes several parts arrive as one object) carry no mesh and
 * are skipped: their children are already in the list.
 */
export function parseThreeMfMesh(buffer: ArrayBuffer): MeshPart[] {
  const entries = unzipSync(new Uint8Array(buffer));
  const modelKey = Object.keys(entries).find((key) =>
    key.toLowerCase().endsWith("3dmodel.model"),
  );
  if (!modelKey) {
    throw new Error("This 3MF has no model inside it.");
  }

  const decoder = new TextDecoder();
  const xml = decoder.decode(entries[modelKey]);
  const materials = parseBaseMaterials(xml);

  const settingsKey = Object.keys(entries).find((key) =>
    key.toLowerCase().endsWith("model_settings.config"),
  );
  const extruders = settingsKey ? parseExtruders(decoder.decode(entries[settingsKey])) : [];

  const parts: MeshPart[] = [];
  // Objects do not nest in this format, so a non-greedy match per object is
  // safe and avoids walking the whole document with an XML parser.
  const objects = xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g);
  for (const [, attrs, body] of objects) {
    if (!body.includes("<vertex")) {
      continue;
    }
    const { positions, indices } = parseMesh(body);
    if (positions.length === 0 || indices.length === 0) {
      continue;
    }

    const pindex = Number(attr(`<object${attrs}>`, "pindex") ?? NaN);
    const material = Number.isInteger(pindex) ? materials[pindex] : undefined;
    const index = parts.length;

    parts.push({
      name: shortName(material?.name ?? "", index),
      // A part with no material tag still has to render as something, and a
      // mid grey reads as "no colour was specified" rather than as a choice.
      color: material?.color ?? "#b9c2d0",
      extruder: extruders[index] ?? null,
      positions,
      indices,
    });
  }

  if (parts.length === 0) {
    throw new Error("This 3MF has no meshes in it.");
  }
  return parts;
}
