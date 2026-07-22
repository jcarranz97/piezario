/**
 * File classification.
 *
 * The catalog's whole job is answering "what do I actually have for this
 * model?" — only a script? only a downloaded .3mf? the full chain from
 * generator to editable solid to sliceable mesh? That question is answered
 * entirely by the file extensions sitting in the model's folder, so the
 * mapping below is the closest thing this project has to a schema.
 */

export type FileKind =
  | "print" // ready to slice / already sliced
  | "mesh" // triangle soup, needs slicing
  | "cad" // parametric B-rep source, editable in CAD
  | "script" // code that generates the geometry
  | "image" // photos, renders, previews
  | "doc" // notes, datasheets
  | "other";

const EXTENSIONS: Record<string, FileKind> = {
  // Slicer project files carry plate layout, supports and filament choices.
  ".3mf": "print",
  ".gcode": "print",
  // Meshes.
  ".stl": "mesh",
  ".obj": "mesh",
  ".ply": "mesh",
  // Real solids you can still edit.
  ".step": "cad",
  ".stp": "cad",
  ".fcstd": "cad",
  ".f3d": "cad",
  ".blend": "cad",
  ".scad": "cad",
  // Generators.
  ".py": "script",
  ".sh": "script",
  ".js": "script",
  ".ts": "script",
  // Images.
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".svg": "image",
  // Docs.
  ".md": "doc",
  ".txt": "doc",
  ".pdf": "doc",
};

/** Human labels for the file-kind chips. */
export const KIND_LABELS: Record<FileKind, string> = {
  print: "Print file",
  mesh: "Mesh",
  cad: "CAD source",
  script: "Script",
  image: "Image",
  doc: "Doc",
  other: "Other",
};

export function classify(filename: string): FileKind {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) {
    return "other";
  }
  return EXTENSIONS[filename.slice(dot).toLowerCase()] ?? "other";
}

/**
 * What you can *do* with a model, derived from the kinds of files present.
 * This is what the grid filters on — "show me everything I can still tweak"
 * is a more useful question than "show me everything with a .py in it".
 */
export type Capability = "printable" | "parametric" | "editable";

export const CAPABILITY_LABELS: Record<Capability, string> = {
  printable: "Ready to print",
  parametric: "Script-generated",
  editable: "CAD-editable",
};

export const CAPABILITY_HINTS: Record<Capability, string> = {
  printable: "Has a mesh or slicer file you can send to the printer",
  parametric: "Has a script that regenerates the geometry from parameters",
  editable: "Has a real B-rep solid you can still open and modify in CAD",
};

export function capabilitiesFor(kinds: Iterable<FileKind>): Capability[] {
  const present = new Set(kinds);
  const out: Capability[] = [];
  if (present.has("print") || present.has("mesh")) {
    out.push("printable");
  }
  if (present.has("script")) {
    out.push("parametric");
  }
  if (present.has("cad")) {
    out.push("editable");
  }
  return out;
}

/** Bytes → "4.9 MB", for the file table. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
