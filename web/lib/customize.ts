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
  type ParamGroup,
  type RawParam,
  groupParams,
  labelFromOpt,
} from "./customize-spec";
import { fontsRoot, getFonts } from "./fonts";
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
const schemaCache = new Map<string, { mtimeMs: number; params: RawParam[] }>();

async function describeGenerator(
  dir: string,
  script: string,
): Promise<RawParam[]> {
  const scriptPath = path.join(dir, script);
  const stat = fs.statSync(scriptPath, { throwIfNoEntry: false });
  if (!stat) {
    throw new CustomizeError(`No such generator: ${script}`);
  }

  const cached = schemaCache.get(scriptPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.params;
  }

  const describer = path.join(process.cwd(), "scripts", "describe_generator.py");
  const { code, stdout, stderr } = await run(
    generatorPython(dir),
    [describer, scriptPath],
    { cwd: dir, timeoutMs: 120_000 },
  );

  let parsed: { params?: RawParam[]; error?: string };
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

  schemaCache.set(scriptPath, { mtimeMs: stat.mtimeMs, params: parsed.params });
  return parsed.params;
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

/** Options for a parameter bound to a catalog inventory. */
async function catalogChoices(source: CatalogSource): Promise<ChoiceOption[]> {
  return source === "fonts" ? fontChoices() : filamentColourChoices();
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
  const raw = await describeGenerator(dir, spec.script);

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
    const choices = source ? await catalogChoices(source) : (declared ?? fromScript);

    // A script's own default need not be something the catalog stocks:
    // dogcup.py defaults its paw to "blue", and there may be no blue spool.
    // Offering it as a pre-selected option would promise a colour that
    // cannot be printed, so the field starts empty instead and the script's
    // default applies unless the customer picks one of yours.
    let value: string | number | boolean | null =
      spec.defaults[param.opt] ?? param.default;
    if (
      source &&
      value !== null &&
      !choices?.some((choice) => String(choice.value) === String(value))
    ) {
      value = null;
    }

    return {
      name: param.name,
      opt: param.opt,
      label: field?.label ?? override?.label ?? labelFromOpt(param.opt),
      help: override?.help ?? param.help,
      type: param.type,
      choices,
      default: value,
      defaultHint: param.default_hint,
      required: param.required,
      placeholder: field?.placeholder ?? override?.placeholder ?? null,
      source,
    };
  };

  const params = (await Promise.all(raw.map(build))).filter(
    (p): p is CustomizeParam => p !== null,
  );
  const byOpt = new Map(params.map((param) => [param.opt, param]));

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
 * number at all, plus magnitudes no dimension in millimetres could mean. The
 * generators validate their own combinations far better than this could (a
 * wall under 1.2 mm, a pitch under the tooth base) and say what to do about
 * it; those messages are surfaced to the customer rather than pre-empted.
 */
const MAX_MAGNITUDE = 100_000;

/** Longest a text parameter may be. A name on a handle, not an essay. */
const MAX_TEXT = 200;

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

    if (param.type === "flag") {
      if (raw === true || raw === "true" || raw === "on") {
        argv.push(param.opt);
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
      // An allowlist of the hexes in `catalog.yaml`, so the only colours that
      // can be ordered are colours there is a spool for.
      const colour = filamentColourChoices().find((c) => c.value === text.toLowerCase());
      if (!colour) {
        throw new CustomizeError(`${param.label}: no filament in the catalog is ${text}.`);
      }
      argv.push(param.opt, String(colour.value));
      continue;
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
 * A stable id for one set of parameters, so the same request twice is free.
 * The argv *is* the identity of the output — same flags, same geometry.
 */
export function paramsHash(slug: string, argv: string[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([slug, argv]))
    .digest("hex")
    .slice(0, 16);
}
