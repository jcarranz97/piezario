/**
 * The `customize:` frontmatter block, and the shape of a customiser form.
 *
 * A parametric model is a `click` script, and the script already knows its own
 * parameters — their flags, types, choices, defaults and help text. That schema
 * is read out of the script itself (see `customize.ts`), never declared here,
 * so adding an option to a generator makes it appear in the form with no edit
 * to this repo.
 *
 * What the frontmatter adds is the two things click cannot know: which few
 * parameters a customer should see first, and what a bare number means to one
 * ("0.75" is `3/4 cup`).
 *
 * This module is deliberately free of `node:fs` and of spawning, so the types
 * and the labelling rules can be shared with the client component that renders
 * the form.
 */

/** A catalog inventory a parameter's options can be drawn from. */
export type CatalogSource = "fonts" | "filaments";

/** How a parameter is rendered, after click's type is flattened. */
export type ParamType =
  | "float"
  | "integer"
  | "text"
  | "boolean"
  | "flag"
  | "choice"
  | "path";

/** One option, as `describe_generator.py` reports it. */
export interface RawParam {
  name: string;
  opt: string;
  aliases: string[];
  secondary: string | null;
  help: string;
  required: boolean;
  default: string | number | boolean | null;
  default_hint: string | null;
  type: ParamType;
  choices?: string[];
}

export interface ChoiceOption {
  label: string;
  value: string | number | boolean;
  /** "#rrggbb" when the choice is a colour, so the form can show a swatch. */
  hex?: string;
}

/** One field on the rendered form. */
export interface CustomizeParam {
  /** Python identifier — the form field name. */
  name: string;
  /** The long flag actually passed on the command line. */
  opt: string;
  label: string;
  help: string;
  type: ParamType;
  choices: ChoiceOption[] | null;
  default: string | number | boolean | null;
  /** `show_default="fitted to the handle"` — what happens if left blank. */
  defaultHint: string | null;
  required: boolean;
  placeholder: string | null;
  /**
   * Set when the parameter is bound to a catalog inventory (`from_catalog:`).
   *
   * `fonts` offers the fonts in `fonts/` and resolves the *path* on the server,
   * so the browser never names a file on disk. `filaments` offers the colours
   * you actually stock in `catalog.yaml` — a colour you have no spool of is not
   * a colour you can print, so a free-form picker would only invite orders you
   * cannot fill.
   */
  source: CatalogSource | null;
}

export interface ParamGroup {
  title: string;
  params: CustomizeParam[];
}

/**
 * Presentation overrides for one parameter, in either view.
 *
 * A script's own help text is written for someone reading `--help` in a
 * terminal, which is not always the same audience as the form. This is where a
 * model relabels a flag, or hides one that another parameter supersedes —
 * `--font` is dead weight once `--font-path` is a picker over the catalog's
 * own fonts.
 */
export interface FieldOverride {
  label: string | null;
  help: string | null;
  placeholder: string | null;
  hide: boolean;
}

export interface CustomizeSpec {
  /** Generator script, relative to the model folder. */
  script: string;
  /** Values that seed the form, overriding the script's own defaults. */
  defaults: Record<string, string | number | boolean>;
  /** Ordered Basic fields, keyed by flag, with their presentation overrides. */
  basic: BasicField[];
  /** Flags bound to a catalog inventory, e.g. `--font-path: fonts`. */
  fromCatalog: Record<string, CatalogSource>;
  /** Per-flag presentation overrides, keyed by flag. */
  fields: Record<string, FieldOverride>;
}

export interface BasicField {
  opt: string;
  label: string | null;
  placeholder: string | null;
  choices: ChoiceOption[] | null;
}

/**
 * Parameters the *app* owns, not the customer. Output naming, location and
 * formats are decided by the job runner: every run gets its own
 * content-hashed folder, and the preview reads the 3MF every generator
 * writes. Letting a form post these would let it write anywhere the server
 * can write.
 */
export const APP_OWNED = new Set(["--outdir", "--name", "--stl", "--fcstd"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Accept `--cups` and `cups` alike; the frontmatter reads better either way. */
export function normaliseOpt(opt: string): string {
  const trimmed = opt.trim();
  return trimmed.startsWith("--") ? trimmed : `--${trimmed}`;
}

function asChoices(value: unknown): ChoiceOption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const out: ChoiceOption[] = [];
  for (const entry of value) {
    // `{label, value}` is the full form. A bare scalar is its own label, which
    // is what a list of plain strings should mean.
    if (typeof entry === "string" || typeof entry === "number") {
      out.push({ label: String(entry), value: entry });
      continue;
    }
    const row = asRecord(entry);
    const value_ = row.value;
    if (
      typeof value_ !== "string" &&
      typeof value_ !== "number" &&
      typeof value_ !== "boolean"
    ) {
      continue;
    }
    out.push({ label: String(row.label ?? value_), value: value_ });
  }
  return out.length > 0 ? out : null;
}

/**
 * Read the `customize:` block. Returns null when the model has none, which is
 * every model that is not script-generated — the customiser simply does not
 * appear on those pages.
 */
export function parseCustomizeSpec(value: unknown): CustomizeSpec | null {
  const block = asRecord(value);
  const script = typeof block.script === "string" ? block.script.trim() : "";
  if (!script) {
    return null;
  }
  // A generator lives in the model folder next to its README. Anything that
  // climbs out of it is not a generator for this model.
  if (script.includes("/") || script.includes("\\") || script.startsWith(".")) {
    return null;
  }

  const defaults: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(asRecord(block.defaults))) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      defaults[normaliseOpt(key)] = raw;
    }
  }

  const basic: BasicField[] = [];
  if (Array.isArray(block.basic)) {
    for (const entry of block.basic) {
      // A bare string is the common case: show this flag, as the script
      // describes it.
      if (typeof entry === "string") {
        basic.push({
          opt: normaliseOpt(entry),
          label: null,
          placeholder: null,
          choices: null,
        });
        continue;
      }
      const row = asRecord(entry);
      const opt = typeof row.opt === "string" ? normaliseOpt(row.opt) : null;
      if (!opt) {
        continue;
      }
      basic.push({
        opt,
        label: typeof row.label === "string" ? row.label : null,
        placeholder:
          typeof row.placeholder === "string" ? row.placeholder : null,
        choices: asChoices(row.choices),
      });
    }
  }

  const fields: Record<string, FieldOverride> = {};
  for (const [key, raw] of Object.entries(asRecord(block.fields))) {
    const row = asRecord(raw);
    fields[normaliseOpt(key)] = {
      label: typeof row.label === "string" ? row.label : null,
      help: typeof row.help === "string" ? row.help : null,
      placeholder: typeof row.placeholder === "string" ? row.placeholder : null,
      hide: row.hide === true,
    };
  }

  const fromCatalog: Record<string, CatalogSource> = {};
  for (const [key, raw] of Object.entries(asRecord(block.from_catalog))) {
    if (raw === "fonts" || raw === "filaments") {
      fromCatalog[normaliseOpt(key)] = raw;
    }
  }

  return {
    script,
    defaults,
    basic,
    fromCatalog,
    fields,
  };
}

/**
 * "--handle-width" → "Handle width". The flag is the only label a script
 * guarantees, so this is what every field falls back to.
 */
export function labelFromOpt(opt: string): string {
  const words = opt.replace(/^--/, "").split("-").filter(Boolean);
  if (words.length === 0) {
    return opt;
  }
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) +
    (words.length > 1 ? ` ${words.slice(1).join(" ")}` : "");
}

/**
 * Group the Advanced fields by their flag prefix: `--paw-size`, `--paw-emboss`
 * and `--paw-color` collect under "Paw".
 *
 * Derived rather than declared, because the generators already name their
 * options this way — the prefix *is* the grouping, and asking each model's
 * frontmatter to restate it would be one more thing to keep in sync. A prefix
 * earns a heading only when at least two options share it; the rest fall
 * together under "General", which keeps a lone `--freeboard` from becoming a
 * section of one.
 */
export function groupParams(params: CustomizeParam[]): ParamGroup[] {
  const prefixOf = (opt: string) => {
    const parts = opt.replace(/^--/, "").split("-");
    return parts.length > 1 ? parts[0] : "";
  };

  const counts = new Map<string, number>();
  for (const param of params) {
    const prefix = prefixOf(param.opt);
    if (prefix) {
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  const groups = new Map<string, CustomizeParam[]>();
  const order: string[] = [];
  for (const param of params) {
    const prefix = prefixOf(param.opt);
    const title =
      prefix && (counts.get(prefix) ?? 0) >= 2
        ? prefix.charAt(0).toUpperCase() + prefix.slice(1)
        : "General";
    if (!groups.has(title)) {
      groups.set(title, []);
      order.push(title);
    }
    groups.get(title)!.push(param);
  }

  // "General" is the leftovers, so it reads better last than wherever its
  // first member happened to fall.
  return order
    .sort((a, b) => Number(a === "General") - Number(b === "General"))
    .map((title) => ({ title, params: groups.get(title)! }));
}
