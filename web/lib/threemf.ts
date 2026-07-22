import fs from "node:fs/promises";
import path from "node:path";

import { unzipSync } from "fflate";

import type { ModelFile } from "./catalog";
import { loadConfig } from "./config";
import { type CostEstimate, estimateCost } from "./cost";

/**
 * Reading tool assignments out of `.3mf` files.
 *
 * A 3MF is a ZIP. Bambu Studio (and the build123d exporter) records which
 * extruder each part is printed with in `Metadata/model_settings.config`, and a
 * full Bambu *project* also carries the actual filament colours in
 * `Metadata/project_settings.config`.
 *
 * Why bother: when a folder holds several variants of the same model, they are
 * only interchangeable if they agree about what each tool means. If `paw` is
 * tool 2 in one file and tool 3 in another, opening them together in Bambu
 * Studio silently prints one of them in the wrong colour — a mistake you find
 * out about after the print. Comparing the files up front turns that into a
 * warning on the page.
 */

/** Don't read absurd files, and don't compare an unbounded number of them. */
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 16;

export interface ThreeMfPart {
  /** Part name as stored, e.g. "Frida-paw". */
  name: string;
  /** Name with the object prefix removed, e.g. "paw" — comparable across files. */
  role: string;
  extruder: number;
}

/**
 * What the slicer worked out, when the project was saved *after* slicing.
 *
 * This is the only place a real filament weight exists — geometry alone can't
 * tell you grams, because that depends on infill, walls, supports and the
 * profile. A project saved before slicing carries an empty `slice_info`, so
 * every field here is optional.
 */
export interface ThreeMfFilament {
  id: number;
  grams: number | null;
  metres: number | null;
  type: string | null;
  colour: string | null;
}

export interface ThreeMfSlice {
  grams: number | null;
  /** Predicted print time, in seconds. */
  seconds: number | null;
  printer: string | null;
  nozzle: string | null;
  supports: boolean | null;
  /** Plain array, not a Map: this crosses into a client component. */
  filaments: ThreeMfFilament[];
}

export interface ThreeMfInfo {
  /** Display name, e.g. "out/Frida.3mf". */
  label: string;
  parts: ThreeMfPart[];
  /** Extruder number → colour, when the project settings carry them. */
  colours: Map<number, string>;
  slice: ThreeMfSlice | null;
}

/**
 * The outcome of comparing a model's 3MFs.
 *
 * Deliberately reports the clean case too: "no warning" and "never checked"
 * look identical on a page, and the whole value of the check is knowing it
 * ran.
 */
/** What one file assigns to each tool, for display next to that file. */
export interface ThreeMfFileSummary {
  /** Matches `ModelFile.name`, so the file table can look it up. */
  label: string;
  tools: Array<{ extruder: number; colour: string | null; roles: string[] }>;
  /** What the slicer recorded, or null when the file was never sliced. */
  slice: ThreeMfSlice | null;
  /** Cost from the configured rates, when there is enough to price. */
  cost: CostEstimate | null;
}

export interface ThreeMfReport {
  /** Per-file tool assignments. Populated even for a single file. */
  files: ThreeMfFileSummary[];
  /** Files actually opened and compared. Fewer than 2 means no comparison. */
  checked: string[];
  /** Tools used by more than one file — the ones a comparison was possible on. */
  comparedTools: number[];
  /**
   * Tools the files disagree about. Only the count and the fact of the
   * disagreement are surfaced: the per-file colours are already listed against
   * each file, so repeating them in the alert says nothing new.
   */
  conflictingTools: number[];
  /** True when real filament colours were compared, not just part roles. */
  usedColours: boolean;
}

function attr(xml: string, key: string): string | null {
  const match = new RegExp(
    `<metadata\\s+key="${key}"\\s+value="([^"]*)"`,
    "i",
  ).exec(xml);
  return match ? match[1] : null;
}

/**
 * Parse `model_settings.config`.
 *
 * Hand-rolled rather than pulling in an XML parser: the file is a flat list of
 * `<object>` / `<part>` elements with `<metadata key= value=>` children, and
 * that shape is all we need.
 */
function parseModelSettings(xml: string): ThreeMfPart[] {
  const parts: ThreeMfPart[] = [];

  for (const objectMatch of xml.matchAll(
    /<object\b[^>]*>([\s\S]*?)<\/object>/gi,
  )) {
    const body = objectMatch[1];
    // The object's own name comes before the first <part>, so read it there.
    const header = body.split("<part")[0];
    const objectName = attr(header, "name") ?? "";
    // A part without its own `extruder` inherits the object's.
    const objectExtruder = attr(header, "extruder");

    for (const partMatch of body.matchAll(/<part\b[^>]*>([\s\S]*?)<\/part>/gi)) {
      const partBody = partMatch[1];
      const name = attr(partBody, "name");
      const raw = attr(partBody, "extruder") ?? objectExtruder;
      // `Number(null)` is 0, not NaN, so a missing value would otherwise
      // invent a tool 0 that no slicer ever assigned.
      const extruder = raw === null ? Number.NaN : Number(raw);
      if (!name || !Number.isInteger(extruder) || extruder < 1) {
        continue;
      }
      // "Frida-paw" in Frida.3mf and "dogcup-paw" in dogcup.3mf are the same
      // role; without stripping the prefix every file would look unique and
      // nothing could ever be compared.
      const prefix = `${objectName}-`;
      const role =
        objectName && name.startsWith(prefix) ? name.slice(prefix.length) : name;
      parts.push({ name, role, extruder });
    }
  }

  return parts;
}

/**
 * `#0000FFFF` → `#0000FF`. 3MF stores display colours as RGBA; the alpha is
 * almost always FF and carrying it around only makes the hex harder to read.
 */
function normaliseColour(value: string): string {
  const hex = value.trim().toUpperCase();
  return /^#[0-9A-F]{8}$/.test(hex) && hex.endsWith("FF")
    ? hex.slice(0, 7)
    : hex;
}

/**
 * Pull per-part colours out of `3D/3dmodel.model`.
 *
 * The core 3MF spec puts them in `<basematerials>`, keyed by the same part
 * names that `model_settings.config` assigns extruders to — which is how a
 * plain exported 3MF (no Bambu project settings) still knows what colour each
 * part is meant to be. Only the head of the file is scanned: this element sits
 * in the first few KB, long before the megabytes of mesh data.
 */
function parseBaseMaterials(xml: string): Map<string, string> {
  const colours = new Map<string, string>();
  for (const match of xml.matchAll(
    /<base\b[^>]*\bname="([^"]*)"[^>]*\bdisplaycolor="([^"]*)"/gi,
  )) {
    colours.set(match[1], normaliseColour(match[2]));
  }
  return colours;
}

/** Read a `key="x" value="y"` style metadata value from a plate block. */
function plateMeta(xml: string, key: string): string | null {
  const match = new RegExp(
    `<metadata\\s+key="${key}"\\s+value="([^"]*)"`,
    "i",
  ).exec(xml);
  return match ? match[1] : null;
}

function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse `Metadata/slice_info.config`.
 *
 * Totals are summed across plates, since a project can hold several and the
 * useful headline is "what will this cost me in filament". Returns null when
 * the file carries no plate at all — the shape a project saved before slicing
 * has, which must not be mistaken for "weighs nothing".
 */
function parseSliceInfo(xml: string): ThreeMfSlice | null {
  const plates = [...xml.matchAll(/<plate\b[^>]*>([\s\S]*?)<\/plate>/gi)];
  if (plates.length === 0) {
    return null;
  }

  let grams: number | null = null;
  let seconds: number | null = null;
  let printer: string | null = null;
  let nozzle: string | null = null;
  let supports: boolean | null = null;
  const filaments = new Map<number, ThreeMfFilament>();

  for (const [, body] of plates) {
    const plateGrams = num(plateMeta(body, "weight"));
    if (plateGrams !== null) {
      grams = (grams ?? 0) + plateGrams;
    }
    const prediction = num(plateMeta(body, "prediction"));
    if (prediction !== null) {
      seconds = (seconds ?? 0) + prediction;
    }
    printer ??= plateMeta(body, "printer_model_id");
    nozzle ??= plateMeta(body, "nozzle_diameters");
    const used = plateMeta(body, "support_used");
    if (used !== null && supports === null) {
      supports = used === "true";
    }

    for (const filament of body.matchAll(/<filament\b[^>]*\/>/gi)) {
      const tag = filament[0];
      const read = (key: string): string | null => {
        const match = new RegExp(`\\b${key}="([^"]*)"`, "i").exec(tag);
        return match ? match[1] : null;
      };
      const id = num(read("id"));
      if (id === null) {
        continue;
      }
      const existing = filaments.get(id);
      const usedGrams = num(read("used_g"));
      filaments.set(id, {
        id,
        grams:
          usedGrams === null
            ? (existing?.grams ?? null)
            : (existing?.grams ?? 0) + usedGrams,
        metres: num(read("used_m")) ?? existing?.metres ?? null,
        type: read("type") ?? existing?.type ?? null,
        colour: read("color")
          ? normaliseColour(read("color")!)
          : (existing?.colour ?? null),
      });
    }
  }

  return {
    grams,
    seconds,
    printer,
    nozzle,
    supports,
    filaments: [...filaments.values()].sort((a, b) => a.id - b.id),
  };
}

/** Pull `filament_colour` out of a Bambu project's settings JSON. */
function parseColours(json: string): Map<number, string> {
  const colours = new Map<number, string>();
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const list = data.filament_colour ?? data.filament_colours;
    if (Array.isArray(list)) {
      list.forEach((value, index) => {
        if (typeof value === "string" && value.trim()) {
          // Extruder numbers are 1-based in model_settings.
          colours.set(index + 1, value.trim().toUpperCase());
        }
      });
    }
  } catch {
    // A project file we can't parse simply contributes no colours.
  }
  return colours;
}

async function readOne(
  absPath: string,
  label: string,
): Promise<ThreeMfInfo | null> {
  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_BYTES) {
    return null;
  }

  let entries: Record<string, Uint8Array>;
  try {
    const buffer = await fs.readFile(absPath);
    // Only inflate the two small config entries — a 3MF's mesh is megabytes
    // and decompressing it here would be pure waste.
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (file) =>
        file.name === "Metadata/model_settings.config" ||
        file.name === "Metadata/project_settings.config" ||
        file.name === "Metadata/slice_info.config" ||
        file.name === "3D/3dmodel.model",
    });
  } catch {
    return null; // not a readable zip
  }

  const decode = (name: string): string | null => {
    const data = entries[name];
    return data ? new TextDecoder().decode(data) : null;
  };

  const modelSettings = decode("Metadata/model_settings.config");
  const projectSettings = decode("Metadata/project_settings.config");
  if (!modelSettings && !projectSettings) {
    return null;
  }

  const parts = modelSettings ? parseModelSettings(modelSettings) : [];
  const sliceInfo = decode("Metadata/slice_info.config");
  const slice = sliceInfo ? parseSliceInfo(sliceInfo) : null;

  // Three sources, strongest first: a Bambu project says which real spool is
  // loaded, the slice result says what was actually used, and basematerials
  // only says what colour the designer drew the part in.
  let colours = projectSettings ? parseColours(projectSettings) : new Map();
  if (colours.size === 0 && slice) {
    for (const filament of slice.filaments) {
      if (filament.colour) {
        colours.set(filament.id, filament.colour);
      }
    }
  }
  if (colours.size === 0) {
    const mesh = entries["3D/3dmodel.model"];
    if (mesh) {
      const head = new TextDecoder().decode(mesh.subarray(0, 64 * 1024));
      const byName = parseBaseMaterials(head);
      for (const part of parts) {
        const colour = byName.get(part.name);
        if (colour && !colours.has(part.extruder)) {
          colours.set(part.extruder, colour);
        }
      }
    }
  }

  return { label, parts, colours, slice };
}

/**
 * Compare every `.3mf` belonging to a model and report extruders the files
 * disagree about.
 *
 * An extruder only counts as conflicting when at least two files actually use
 * it and mean different things by it. A file that simply doesn't use tool 3 is
 * not in conflict with one that does — that's a variant, not a mistake.
 */
export async function analyseThreeMf(
  files: ModelFile[],
  root: string,
  /** Waste buffer for the per-file cost display; defaults to the global one. */
  efficiency?: number,
): Promise<ThreeMfReport> {
  const empty: ThreeMfReport = {
    files: [],
    checked: [],
    comparedTools: [],
    conflictingTools: [],
    usedColours: false,
  };

  const candidates = files
    .filter((file) => file.name.toLowerCase().endsWith(".3mf"))
    .slice(0, MAX_FILES);
  if (candidates.length === 0) {
    return empty;
  }

  const costConfig = loadConfig().cost;
  const infos: ThreeMfInfo[] = [];
  for (const file of candidates) {
    const info = await readOne(path.resolve(root, file.relPath), file.name);
    if (info) {
      infos.push(info);
    }
  }
  if (infos.length === 0) {
    return empty;
  }

  // Per-file summaries are worth having even for one file: knowing which
  // colour sits on which tool is useful before you open anything.
  const summaries: ThreeMfFileSummary[] = infos.map((info) => {
    const tools = new Set([
      ...info.parts.map((part) => part.extruder),
      ...info.colours.keys(),
    ]);
    for (const filament of info.slice?.filaments ?? []) {
      tools.add(filament.id);
    }
    return {
      label: info.label,
      tools: [...tools]
        .sort((a, b) => a - b)
        .map((extruder) => ({
          extruder,
          colour: info.colours.get(extruder) ?? null,
          roles: [
            ...new Set(
              info.parts
                .filter((part) => part.extruder === extruder)
                .map((part) => part.role),
            ),
          ].sort(),
        })),
      slice: info.slice,
      cost: info.slice
        ? estimateCost(info.slice, costConfig, null, efficiency)
        : null,
    };
  });

  // A single file can't disagree with anything, but its summary still stands.
  if (infos.length < 2) {
    return { ...empty, files: summaries };
  }

  const everyFileHasColours = infos.every((info) => info.colours.size > 0);
  const extruders = new Set<number>();
  for (const info of infos) {
    for (const part of info.parts) {
      extruders.add(part.extruder);
    }
    for (const key of info.colours.keys()) {
      extruders.add(key);
    }
  }

  const conflictingTools: number[] = [];
  const comparedTools: number[] = [];
  for (const extruder of [...extruders].sort((a, b) => a - b)) {
    // Both signals are checked, not just the stronger one. Two files can agree
    // that tool 2 is blue while disagreeing about *which parts* print on it —
    // comparing colour alone would call that clean and it isn't.
    const byColour = new Map<string, string[]>();
    const byRoles = new Map<string, string[]>();

    for (const info of infos) {
      const colour = info.colours.get(extruder);
      if (colour) {
        byColour.set(colour, [...(byColour.get(colour) ?? []), info.label]);
      }
      const roles = [
        ...new Set(
          info.parts
            .filter((part) => part.extruder === extruder)
            .map((part) => part.role),
        ),
      ].sort();
      if (roles.length > 0) {
        const key = roles.join(", ");
        byRoles.set(key, [...(byRoles.get(key) ?? []), info.label]);
      }
    }

    const colourFiles = [...byColour.values()].flat().length;
    const roleFiles = [...byRoles.values()].flat().length;
    if (colourFiles < 2 && roleFiles < 2) {
      continue; // only one file uses this tool, so there was nothing to compare
    }
    comparedTools.push(extruder);

    const colourClash = byColour.size > 1 && colourFiles > 1;
    const roleClash = byRoles.size > 1 && roleFiles > 1;
    if (colourClash || roleClash) {
      conflictingTools.push(extruder);
    }
  }

  return {
    files: summaries,
    checked: infos.map((info) => info.label),
    comparedTools,
    conflictingTools,
    usedColours: everyFileHasColours,
  };
}
