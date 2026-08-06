import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { modelsRoot } from "./catalog";
import { configPath } from "./config";
import {
  APP_OWNED,
  type CatalogSource,
  type ChoiceOption,
  type CustomizeParam,
  type CustomizeSpec,
  type DependentDefault,
  type MultiField,
  type MultiFieldPart,
  type ParamGroup,
  type RawParam,
  defaultMultiField,
  groupParams,
  labelFromOpt,
} from "./customize-spec";
import { fontsRoot, getFonts } from "./fonts";
import { getIcons, iconsRoot } from "./icons";
import { getFilaments } from "./inventory";

/**
 * Reading a generator's parameters, and turning a submitted form back into a
 * safe command line.
 *
 * Two halves, and the second is the one that matters. Building the form is
 * convenience: ask the script what its options are and render them. Turning
 * the answers back into `argv` is a trust boundary — every value here came
 * from a browser — so nothing is passed through. A parameter the script did
 * not declare is dropped, a number that is not a number is rejected, and a
 * parameter that takes a *filesystem path* is refused outright unless the
 * frontmatter bound it to a catalog folder, in which case the browser sends an
 * id and the path is resolved here.
 *
 * That layer is written as if it were already public, because it is the piece
 * that survives the move to a hosted backend. The Next route around it is not.
 */

export interface CustomizeSchema {
  slug: string;
  script: string;
  /** What the customer sees first. */
  basic: CustomizeParam[];
  /** Everything else, grouped by flag prefix. */
  advanced: ParamGroup[];
}

export class CustomizeError extends Error {}

/** Absolute path to a model's folder, guarded against escaping `models/`. */
export function modelDir(slug: string): string {
  const root = modelsRoot();
  const dir = path.resolve(root, slug);
  const rel = path.relative(root, dir);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw new CustomizeError("That model is outside the catalog.");
  }
  return dir;
}

/**
 * The interpreter to run a generator with.
 *
 * A generator's dependencies (build123d, OCC, bd_warehouse) are heavy and
 * pinned per model, so each model folder carries its own `.venv`. There is no
 * fallback to a system python on purpose: importing the script in the wrong
 * interpreter fails deep inside OCC with a message that sends you looking in
 * the wrong place, and "run `uv venv` in the model folder" is the actual fix.
 */
export function generatorPython(dir: string): string {
  const venv = path.join(dir, ".venv", "bin", "python");
  if (!fs.existsSync(venv)) {
    throw new CustomizeError(
      `This model has no .venv — create one in ${path.basename(dir)}/ ` +
        `(uv venv .venv && uv pip install -r requirements) before customising it.`,
    );
  }
  return venv;
}

/** Run a command to completion, capturing both streams. */
function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new CustomizeError("The generator took too long and was stopped."));
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new CustomizeError(err.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Introspection is slow — importing the script pulls in OCC — and the answer
 * only changes when the script does, so it is cached against the file's mtime.
 */
interface GeneratorSchema {
  params: RawParam[];
  /** Keyed by the flag whose default follows another field. */
  dependentDefaults: Record<string, DependentDefault>;
  /** Keyed by the repeatable flag whose one entry it describes. */
  multiFields: Record<string, MultiField>;
}

/**
 * `MULTI_FIELDS` as the describer reports it (snake_case, as Python wrote it),
 * mapped onto the camelCase the rest of the app reads.
 */
interface RawMultiField {
  add_label?: unknown;
  empty_label?: unknown;
  separator?: unknown;
  parts?: unknown;
}

function readMultiFields(raw: Record<string, RawMultiField>): Record<string, MultiField> {
  const out: Record<string, MultiField> = {};
  for (const [opt, spec] of Object.entries(raw ?? {})) {
    const parts = Array.isArray(spec?.parts) ? spec.parts : [];
    const mapped = parts.flatMap((part: Record<string, unknown>) => {
      const key = typeof part?.key === "string" ? part.key : "";
      if (!key) {
        return [];
      }
      const type: MultiFieldPart["type"] =
        part.type === "integer" || part.type === "float" || part.type === "choice"
          ? part.type
          : "text";
      const source: CatalogSource | null =
        part.source === "fonts" || part.source === "filaments" ||
        part.source === "icons"
          ? part.source
          : null;
      return [
        {
          key,
          label: typeof part.label === "string" ? part.label : key,
          type,
          placeholder:
            typeof part.placeholder === "string" ? part.placeholder : null,
          default: typeof part.default === "string" ? part.default : null,
          width: part.width === "narrow" ? ("narrow" as const) : ("wide" as const),
          source,
        },
      ];
    });
    if (mapped.length === 0) {
      continue;
    }
    out[opt] = {
      addLabel: typeof spec.add_label === "string" ? spec.add_label : "Add",
      emptyLabel: typeof spec.empty_label === "string" ? spec.empty_label : null,
      separator: typeof spec.separator === "string" ? spec.separator : "",
      parts: mapped,
    };
  }
  return out;
}

const schemaCache = new Map<string, { mtimeMs: number } & GeneratorSchema>();

async function describeGenerator(
  dir: string,
  script: string,
): Promise<GeneratorSchema> {
  const scriptPath = path.join(dir, script);
  const stat = fs.statSync(scriptPath, { throwIfNoEntry: false });
  if (!stat) {
    throw new CustomizeError(`No such generator: ${script}`);
  }

  const cached = schemaCache.get(scriptPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return {
      params: cached.params,
      dependentDefaults: cached.dependentDefaults,
      multiFields: cached.multiFields,
    };
  }

  const describer = path.join(process.cwd(), "scripts", "describe_generator.py");
  const { code, stdout, stderr } = await run(
    generatorPython(dir),
    [describer, scriptPath],
    { cwd: dir, timeoutMs: 120_000 },
  );

  let parsed: {
    params?: RawParam[];
    dependent_defaults?: Record<string, DependentDefault>;
    multi_fields?: Record<string, RawMultiField>;
    error?: string;
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new CustomizeError(
      `Could not read ${script}'s parameters. ${stderr.trim().split("\n").pop() ?? ""}`,
    );
  }
  if (code !== 0 || parsed.error || !parsed.params) {
    throw new CustomizeError(parsed.error ?? `${script} could not be inspected.`);
  }

  // Absent on every generator that does not declare it, which is all of them
  // but one — an older describer simply omits the key.
  const dependentDefaults = parsed.dependent_defaults ?? {};
  const multiFields = readMultiFields(parsed.multi_fields ?? {});
  schemaCache.set(scriptPath, {
    mtimeMs: stat.mtimeMs,
    params: parsed.params,
    dependentDefaults,
    multiFields,
  });
  return { params: parsed.params, dependentDefaults, multiFields };
}

/** The fonts in `fonts/`, as choices, for a parameter bound to that folder. */
async function fontChoices(): Promise<ChoiceOption[]> {
  return (await getFonts()).map((font) => ({
    label: font.style && font.style !== "Regular"
      ? `${font.family} ${font.style}`
      : font.family,
    value: font.id,
  }));
}

/**
 * The colours you stock, as choices.
 *
 * Deduplicated by hex across every filament product: two spools of the same
 * black are one choice to a customer. A colour entry with no `hex` cannot be
 * shown as a swatch and is skipped rather than rendered as a blank chip.
 */
function filamentColourChoices(): ChoiceOption[] {
  const seen = new Map<string, ChoiceOption>();
  for (const filament of getFilaments()) {
    for (const colour of filament.colors) {
      const hex = colour.hex?.trim().toLowerCase();
      if (!hex || seen.has(hex)) {
        continue;
      }
      seen.set(hex, { label: colour.name || hex, value: hex, hex });
    }
  }
  return [...seen.values()];
}

/** The SVGs in `icons/`, as choices, for a parameter bound to that folder. */
async function iconChoices(): Promise<ChoiceOption[]> {
  return (await getIcons()).map((icon) => ({
    label: icon.categories.length
      ? `${icon.categories.join("/")}/${icon.name}`
      : icon.name,
    value: icon.id,
  }));
}

/** Options for a parameter bound to a catalog inventory. */
async function catalogChoices(source: CatalogSource): Promise<ChoiceOption[]> {
  if (source === "fonts") return fontChoices();
  if (source === "icons") return iconChoices();
  return filamentColourChoices();
}

/**
 * Merge what the script declares with what the frontmatter presents, into the
 * form the page renders.
 */
export async function customizeSchema(
  slug: string,
  spec: CustomizeSpec,
): Promise<CustomizeSchema> {
  const dir = modelDir(slug);
  const { params: raw, dependentDefaults, multiFields } = await describeGenerator(
    dir,
    spec.script,
  );

  const basicByOpt = new Map(spec.basic.map((field) => [field.opt, field]));

  const build = async (param: RawParam): Promise<CustomizeParam | null> => {
    // Output naming and location belong to the job runner, never to a form.
    if (APP_OWNED.has(param.opt)) {
      return null;
    }
    const override = spec.fields[param.opt];
    if (override?.hide) {
      return null;
    }
    const source = spec.fromCatalog[param.opt] ?? null;
    // A path parameter that was not deliberately bound to a catalog folder is
    // dropped rather than rendered read-only: a field nobody can fill is just
    // clutter, and leaving it out of the schema is also what stops the runner
    // ever accepting a value for it.
    if (param.type === "path" && !source) {
      return null;
    }

    const field = basicByOpt.get(param.opt);
    const declared = field?.choices ?? null;
    const fromScript = param.choices
      ? param.choices.map((choice) => ({ label: choice, value: choice }))
      : null;
    // Merged, not replaced. `--pattern` on the lip balm holder takes one of
    // four motif *names* or the path to an SVG, so the frontmatter declares
    // the names and the binding adds the catalog's own artwork after them.
    const bound = source ? await catalogChoices(source) : null;
    const choices = bound
      ? [...(declared ?? []), ...bound]
      : (declared ?? fromScript);

    // A script's own default need not be usable by the control that renders
    // it, and the two bindings fail differently.
    //
    // `fonts` is a closed list: a family installed on my machine is not a
    // font in the catalog, and pre-selecting it would name something the
    // customer cannot see or check.
    //
    // `filaments` is open — any colour may be ordered — but the picker parses
    // hex, and dogcup.py defaults its paw to the CSS name "blue". So the test
    // there is the *format*, not the inventory.
    //
    // Either way the field starts empty rather than wrong, and an empty one
    // means the script's own default applies.
    // A repeatable flag has a LIST for a value, so its starting state is rows
    // rather than a value. Click's own default for one is `()`, which is the
    // honest answer — no rows, and the script applies whatever it does when
    // the flag is absent.
    const multiple = param.multiple
      ? (multiFields[param.opt] ?? defaultMultiField(labelFromOpt(param.opt)))
      : null;
    const seed = spec.defaults[param.opt] ?? param.default;
    const entries = multiple
      ? (Array.isArray(seed) ? seed : seed === null ? [] : [seed]).map(String)
      : [];

    let value: string | number | boolean | null = multiple
      ? null
      : Array.isArray(seed)
        ? null
        : seed;
    if (value !== null && source === "fonts") {
      if (!choices?.some((choice) => String(choice.value) === String(value))) {
        value = null;
      }
    } else if (value !== null && source === "filaments") {
      if (typeof value !== "string" || !HEX_COLOUR.test(value)) {
        value = null;
      }
    }

    return {
      name: param.name,
      opt: param.opt,
      secondary: param.secondary,
      label: field?.label ?? override?.label ?? labelFromOpt(param.opt),
      help: override?.help ?? param.help,
      type: param.type,
      choices,
      default: value,
      defaultHint: param.default_hint,
      required: param.required,
      placeholder: field?.placeholder ?? override?.placeholder ?? null,
      source,
      // Filled in below: it needs the controlling parameter, which may not be
      // built yet when this one is.
      dependsOn: null,
      multiple,
      entries,
    };
  };

  const params = (await Promise.all(raw.map(build))).filter(
    (p): p is CustomizeParam => p !== null,
  );
  const byOpt = new Map(params.map((param) => [param.opt, param]));

  // Resolve `--revision follows --variant` into names, which is what the
  // form's state is keyed by. A dependency naming a flag that was hidden,
  // app-owned or simply absent is dropped: a controller no one can see would
  // leave the field frozen at whatever it started as, which is worse than not
  // pre-filling it at all.
  for (const [opt, dep] of Object.entries(dependentDefaults)) {
    const param = byOpt.get(opt);
    const controller = byOpt.get(dep.on);
    if (!param || !controller || controller.opt === param.opt) {
      continue;
    }
    param.dependsOn = { name: controller.name, map: dep.map };
    // Seed the field from the controller's own starting value, so the form
    // opens showing the right letter rather than filling one in only after
    // the customer touches something.
    const start = controller.default;
    if (start !== null && start !== undefined) {
      const seeded = dep.map[String(start)];
      if (seeded !== undefined) {
        param.default = seeded;
      }
    }
  }

  // Basic keeps the frontmatter's order — it is a deliberate reading order,
  // not the order the options happen to be declared in.
  const basic: CustomizeParam[] = [];
  for (const field of spec.basic) {
    const param = byOpt.get(field.opt);
    if (param) {
      basic.push(param);
    }
  }

  const basicOpts = new Set(basic.map((param) => param.opt));
  const advanced = groupParams(params.filter((p) => !basicOpts.has(p.opt)));

  return { slug, script: spec.script, basic, advanced };
}

/**
 * Bounds on a number from a form. There is no per-parameter range to check
 * against — click does not carry one — so this only rejects what is not a
 * number at all. The generators validate their own combinations far better
 * than this could (a wall under 1.2 mm, a pitch under the tooth base) and say
 * what to do about it; those messages are surfaced rather than pre-empted.
 *
 * Deliberately loose. This was 100_000 to start with, sized as "no dimension
 * in millimetres is bigger than this", and it rejected the lip balm holder's
 * own default `--pattern-seed` of 20260730 — a seed is a number, not a
 * length, and click does not say which is which. The bound is only here to
 * catch input that is not a real number, so it is set where no legitimate
 * parameter of any kind will reach it.
 */
const MAX_MAGNITUDE = 1e12;

/** Longest a text parameter may be. A name on a handle, not an essay. */
const MAX_TEXT = 200;

/**
 * Most rows one repeatable field may post.
 *
 * Not a limit on what can be built — the generators refuse their own excesses
 * far better, and with a number that means something ("that is 1200 keycaps").
 * This is only a bound on how much argv one form may produce, so a page left
 * looping cannot hand `spawn` a hundred thousand arguments.
 */
const MAX_ENTRIES = 200;

/** The only shape a colour may take on its way to a generator. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/**
 * One entry of a repeatable option, split back into its parts.
 *
 * From the RIGHT, once per gap, which is the same rule the form joins by and
 * the generator reads back with. All three have to agree or the separator
 * means a different thing in each: `--icon` is a path and a count, and a path
 * may perfectly well contain a colon.
 */
function splitEntry(entry: string, parts: number, separator: string): string[] {
  if (parts <= 1 || !separator) {
    return [entry];
  }
  const out: string[] = [];
  let rest = entry;
  for (let i = 0; i < parts - 1; i += 1) {
    const at = rest.lastIndexOf(separator);
    if (at < 0) {
      break;
    }
    out.unshift(rest.slice(at + separator.length));
    rest = rest.slice(0, at);
  }
  out.unshift(rest);
  while (out.length < parts) {
    out.push("");
  }
  return out;
}

/**
 * One catalog-bound value, as the generator should receive it.
 *
 * The browser sends an id; this is where it becomes a path. Factored out of
 * the single-value branches below because a repeatable option needs the same
 * resolution applied to one PART of each row — and a second copy of the rule
 * would be a second place for `--icon` to disagree with `--pattern` about what
 * an icon id is.
 */
async function resolveFromCatalog(
  source: CatalogSource,
  text: string,
  param: CustomizeParam,
): Promise<string> {
  if (source === "fonts") {
    const font = (await getFonts()).find((entry) => entry.id === text);
    if (!font) {
      throw new CustomizeError(`No such font in the catalog: ${text}`);
    }
    return path.join(fontsRoot(), font.relPath);
  }
  if (source === "icons") {
    const icon = (await getIcons()).find((entry) => entry.id === text);
    if (icon) {
      return path.join(iconsRoot(), icon.relPath);
    }
    if (param.choices?.some((choice) => String(choice.value) === text)) {
      return text;
    }
    throw new CustomizeError(`${param.label}: ${text} is not one of the options.`);
  }
  const hex = text.toLowerCase();
  if (!HEX_COLOUR.test(hex)) {
    throw new CustomizeError(`${param.label} must be a colour like #c0392b.`);
  }
  return hex;
}

/**
 * Turn submitted values into `argv`.
 *
 * Everything is checked against the schema built above — which is built from
 * the script — so an unknown parameter cannot be introduced by the caller. The
 * process is spawned with an argument array and no shell, so quoting is not a
 * concern; the checks here are about *what the generator is asked to do*, not
 * about escaping.
 */
export async function toArgv(
  schema: CustomizeSchema,
  values: Record<string, unknown>,
): Promise<string[]> {
  const known = new Map<string, CustomizeParam>();
  for (const param of [...schema.basic, ...schema.advanced.flatMap((g) => g.params)]) {
    known.set(param.name, param);
  }

  const argv: string[] = [];
  for (const [name, raw] of Object.entries(values)) {
    const param = known.get(name);
    if (!param) {
      // Silently dropped, not an error: the form posts whatever it rendered,
      // and a stale field after a script edit should not fail the whole run.
      continue;
    }

    // A repeatable flag is emitted once per row, which is the whole point of
    // it: `--word JUAN:3 --word ORIANA:4`. Joining the rows into one value
    // would build a single keycap named "JUAN:3,ORIANA:4", which is worse
    // than failing because it succeeds.
    if (param.multiple) {
      const rows = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
      if (rows.length > MAX_ENTRIES) {
        throw new CustomizeError(
          `${param.label}: ${rows.length} entries is more than this form will send.`,
        );
      }
      const parts = param.multiple.parts;
      const separator = param.multiple.separator;
      const bound = parts.some((part) => part.source);

      for (const row of rows) {
        let entry = typeof row === "string" ? row.trim() : String(row ?? "");
        // A row left blank is a row someone added and did not fill. Passing it
        // through would ask the generator for a nameless item; dropping it is
        // what "I changed my mind about that row" means.
        if (entry === "") {
          continue;
        }
        if (entry.length > MAX_TEXT) {
          throw new CustomizeError(`${param.label} has an entry that is too long.`);
        }
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\u007f]/.test(entry)) {
          throw new CustomizeError(
            `${param.label} contains characters it cannot use.`,
          );
        }
        // A row whose parts are individually bound to a catalog folder: the
        // browser sent ids, and the paths are resolved HERE. Split with the
        // same right-to-left rule the client joins by and the script reads
        // back, or the three disagree about what the separator separates.
        if (bound) {
          const cells = splitEntry(entry, parts.length, separator);
          for (let at = 0; at < parts.length; at += 1) {
            const source = parts[at].source;
            if (source && cells[at]) {
              cells[at] = await resolveFromCatalog(source, cells[at], param);
            }
          }
          while (cells.length > 1 && cells[cells.length - 1].trim() === "") {
            cells.pop();
          }
          entry = cells.join(separator);
        }
        argv.push(param.opt, entry);
      }
      continue;
    }

    if (param.type === "flag") {
      const on = raw === true || raw === "true" || raw === "on";
      if (on) {
        argv.push(param.opt);
      } else if (param.secondary) {
        // A flag that has an "off" half cannot be turned off by staying
        // quiet: the script would apply its own default, which for
        // `--step/--no-step` is *on* and writes a 29 MB STEP file beside
        // every part. So say it explicitly.
        //
        // Not conditioned on the default being true, which was the first
        // attempt and silently did nothing: `default` here is the value the
        // form started from, and the frontmatter had already overridden it to
        // false. Passing the off-flag when the script would have been off
        // anyway costs nothing; failing to pass it costs 29 MB.
        argv.push(param.secondary);
      }
      continue;
    }

    const text = typeof raw === "string" ? raw.trim() : String(raw ?? "");

    // A blank number means "leave it to the script", which is a real setting:
    // `--paw-size` unset is "fitted to the floor", and forcing a 0 would mean
    // "no paw at all" instead. Blank text is passed through, because an empty
    // `--pet-name` deliberately means a plain handle.
    if (text === "" && (param.type !== "text" || param.source)) {
      continue;
    }

    if (param.source === "filaments") {
      // Any colour, not only a stocked one. The catalog's spools are the
      // presets in the picker because they are the answer to most orders,
      // but they are a shortcut rather than a limit: a customer asking for a
      // colour that is not on the shelf is a thing to price, not a thing to
      // refuse in a form.
      //
      // Still strict about the *shape*. Six hex digits and nothing else is
      // the only form that reaches the generator, so this remains an exact
      // allowlist of what a colour may look like.
      const hex = text.toLowerCase();
      if (!HEX_COLOUR.test(hex)) {
        throw new CustomizeError(
          `${param.label} must be a colour like #c0392b.`,
        );
      }
      argv.push(param.opt, hex);
      continue;
    }

    if (param.source === "icons") {
      // A declared name (`hearts`, `paws`, `none`) passes through as itself;
      // anything else must be an icon id, which resolves to a path here. The
      // browser never names a file, which is what keeps `--pattern` from
      // being an arbitrary-file parameter — click types it as plain text, so
      // the usual path guard does not cover it.
      const icon = (await getIcons()).find((entry) => entry.id === text);
      if (icon) {
        argv.push(param.opt, path.join(iconsRoot(), icon.relPath));
        continue;
      }
      // Not an icon id, so it has to be one of the names the frontmatter
      // declared. Checked against the schema's own list rather than by
      // guessing at the shape of the string.
      if (param.choices?.some((choice) => String(choice.value) === text)) {
        argv.push(param.opt, text);
        continue;
      }
      throw new CustomizeError(`${param.label}: ${text} is not one of the options.`);
    }

    if (param.source === "fonts") {
      // The browser sends a font id, never a path. Resolving it here is what
      // keeps `--font-path` from being an arbitrary-file parameter.
      const font = (await getFonts()).find((entry) => entry.id === text);
      if (!font) {
        throw new CustomizeError(`No such font in the catalog: ${text}`);
      }
      argv.push(param.opt, path.join(fontsRoot(), font.relPath));
      continue;
    }

    if (param.type === "float" || param.type === "integer") {
      const num = Number(text);
      if (!Number.isFinite(num) || Math.abs(num) > MAX_MAGNITUDE) {
        throw new CustomizeError(`${param.label} must be a number.`);
      }
      if (param.type === "integer" && !Number.isInteger(num)) {
        throw new CustomizeError(`${param.label} must be a whole number.`);
      }
      argv.push(param.opt, String(num));
      continue;
    }

    if (param.choices) {
      const match = param.choices.find(
        (choice) => String(choice.value) === text,
      );
      if (!match) {
        throw new CustomizeError(`${param.label}: ${text} is not one of the options.`);
      }
      argv.push(param.opt, String(match.value));
      continue;
    }

    if (text.length > MAX_TEXT) {
      throw new CustomizeError(`${param.label} is too long.`);
    }
    // Control characters have no meaning in any of these parameters and are a
    // reliable sign the value did not come from the form as intended.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(text)) {
      throw new CustomizeError(`${param.label} contains characters it cannot use.`);
    }
    argv.push(param.opt, text);
  }

  return argv;
}

/**
 * Where generated files go: outside `models/`, under the catalog folder.
 *
 * Deliberately not in the model's own `out/`. That folder is catalog content —
 * it is listed in `output_dirs:` and its files show up in the model's Files
 * card — and a customer's one-off variant is not content, it is an artifact.
 * Keeping them apart means customising a model never edits the catalog.
 */
export function generatedRoot(): string {
  return path.join(path.dirname(configPath()), ".piezario", "generated");
}

/**
 * A fingerprint of every generator in the catalog: path, size and mtime of
 * each `.py` under `models/`, hashed.
 *
 * It is deliberately catalog-wide rather than per-model. A generator is not a
 * closed thing — `color-swatch-container/swatch_container.py` imports the card
 * from `color-swatch/color_swatch.py` so the two can never disagree about how
 * thick a card is, and several models keep a copy of `bambu3mf.py`. There is
 * no honest way to find a script's real inputs from the outside short of
 * running it, so this takes the safe side of the trade: any script edit
 * anywhere invalidates every cached job.
 *
 * That costs one regeneration after an edit. The other direction cost an
 * afternoon: a fixed generator, a re-run that never ran, and a stale file that
 * looked exactly like a fresh one.
 *
 * `stat` only — the contents are never read. A few hundred stats is well under
 * a millisecond, and mtime is what a text editor changes.
 */
function generatorsStamp(): string {
  const hash = crypto.createHash("sha256");
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: nothing to fingerprint, not an error
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip the heavy folders that cannot change what a generator builds.
        if (entry.name === ".venv" || entry.name === "__pycache__") {
          continue;
        }
        walk(full);
      } else if (entry.name.endsWith(".py")) {
        try {
          const st = fs.statSync(full);
          hash.update(`${full}:${st.size}:${st.mtimeMs}\n`);
        } catch {
          // Raced with a delete; leaving it out is the correct fingerprint.
        }
      }
    }
  };
  try {
    walk(modelsRoot());
  } catch {
    // No catalog configured yet. An empty fingerprint is the honest answer:
    // it degrades to the old argv-only key rather than throwing on the way to
    // a download.
  }
  return hash.digest("hex");
}

/**
 * A stable id for one set of parameters, so the same request twice is free.
 *
 * The argv is *most* of the identity of the output, and for a long time this
 * hashed nothing else — which was wrong in a way that only shows up after you
 * edit a generator. The flags had not changed, so the hash had not changed, so
 * the run was served from cache and the fixed script never ran. The bug looked
 * like it had survived the fix. So the script fingerprint is in the key too:
 * same flags AND same generators, same geometry.
 */
export function paramsHash(slug: string, argv: string[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([slug, argv, generatorsStamp()]))
    .digest("hex")
    .slice(0, 16);
}
