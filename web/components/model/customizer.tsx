"use client";

import {
  Alert,
  Button,
  Chip,
  ColorArea,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  Label,
  Switch,
  Tooltip,
} from "@heroui/react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuDownload, LuPlus, LuRefreshCw, LuSettings2, LuX } from "react-icons/lu";

import type { CustomizeParam, ParamGroup } from "@/lib/customize-spec";

import { MeshPreview } from "./mesh-preview";

/**
 * The customiser: a form built from a generator's own parameters.
 *
 * Two views, the way a slicer has them. **Basic** is the handful of fields the
 * model's README nominates — for a dog cup, the size and the pet's name, which
 * is genuinely the whole order. **Advanced** is every remaining option the
 * script declares, grouped by flag prefix. The advanced fields are always
 * mounted, just hidden: a value typed there, then toggled away, is still part
 * of the part you asked for, and silently dropping it would be a nasty way to
 * lose a setting.
 *
 * Nothing here knows anything about dog cups. Everything rendered comes from
 * the schema the server read out of the script.
 */

const FIELD =
  "w-full rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

/** A colour the picker can parse. CSS names like "blue" are not one. */
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Shown when a colour field has no usable value yet; never submitted alone. */
const PICKER_FALLBACK = "#cccccc";

export interface JobView {
  id: string;
  status: "queued" | "running" | "done" | "error";
  log: string[];
  files: { name: string; size: number }[];
  error: string | null;
  elapsedMs: number | null;
  cached: boolean;
}

/** The starting value of one field: a string, or rows for a repeatable one. */
function initialValue(param: CustomizeParam): string | string[] {
  if (param.multiple) {
    return param.entries;
  }
  if (param.type === "flag") {
    return param.default === true ? "on" : "";
  }
  return param.default === null || param.default === undefined
    ? ""
    : String(param.default);
}

/**
 * One entry of a repeatable option, split back into the boxes that made it.
 *
 * Split from the RIGHT, once per gap between parts, which mirrors what the
 * script does when it reads the entry back: `--word` is a name and a count, so
 * `MARIA:JOSE:2` is the name `MARIA:JOSE` seen twice, not the name `MARIA`.
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
 * The boxes joined back into the one string the flag receives.
 *
 * Trailing empties are dropped, so a name with the count left blank sends
 * `JUAN` rather than `JUAN:` — the script's own default for the count is then
 * what applies, which is what an empty box should mean.
 */
function joinEntry(values: string[], separator: string): string {
  const kept = [...values];
  while (kept.length > 1 && kept[kept.length - 1].trim() === "") {
    kept.pop();
  }
  return kept.join(separator);
}

/**
 * Is this a row somebody added and never filled?
 *
 * Judged on the FIRST part alone, which is the one that identifies the entry:
 * a name with no count is still a name, a count with no name is not an order.
 */
function rowIsBlank(cells: string[]): boolean {
  return (cells[0] ?? "").trim() === "";
}

/**
 * The form's state, as the payload the generator is asked for.
 *
 * Unfilled rows are dropped here rather than sent. They are not a rare
 * accident — pressing Enter hands you a fresh one every time, and the last one
 * is still sitting there when you press Generate — and they are not harmless:
 * an untouched row on the keycap form joins to `:1`, which is a perfectly
 * valid entry meaning "one cap with no letter on it". A blank keycap would
 * arrive on the plate with nobody having asked for one, which is the kind of
 * wrong that gets printed before it gets noticed.
 *
 * Dropping them here also keeps them out of the staleness signature, so adding
 * a row you have not filled in yet does not announce that the preview is out
 * of date.
 */
function payloadFor(
  params: CustomizeParam[],
  values: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = { ...values };
  for (const param of params) {
    const spec = param.multiple;
    const rows = out[param.name];
    if (!spec || !Array.isArray(rows)) {
      continue;
    }
    out[param.name] = rows.filter(
      (row) => !rowIsBlank(splitEntry(row, spec.parts.length, spec.separator)),
    );
  }
  return out;
}

/**
 * A repeatable option: rows you add to and remove from, like the Supplies card.
 *
 * The rows are held as the joined strings that go on the command line, not as
 * objects — the form's job is to make the separator invisible, not to invent a
 * second representation of an entry that then has to be converted somewhere.
 */
function MultiField({
  param,
  rows,
  onChange,
}: {
  param: CustomizeParam;
  rows: string[];
  onChange: (next: string[]) => void;
}) {
  // Which box to put the cursor in after the next render, as `row:part`. A row
  // added by Enter is useless if you then have to reach for the mouse to type
  // in it, and a newly mounted input cannot focus itself from the handler that
  // created it — it does not exist yet.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const boxes = useRef(new Map<string, HTMLInputElement | null>());

  useEffect(() => {
    if (!focusKey) {
      return;
    }
    boxes.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, rows.length]);

  const spec = param.multiple;
  if (!spec) {
    return null;
  }

  const cellsOf = (row: number) =>
    splitEntry(rows[row] ?? "", spec.parts.length, spec.separator);

  const setPart = (row: number, part: number, next: string) => {
    const cells = cellsOf(row);
    cells[part] = next;
    const updated = [...rows];
    updated[row] = joinEntry(cells, spec.separator);
    onChange(updated);
  };

  const add = () => {
    // A new row opens on whatever the script said a fresh entry looks like —
    // for `--word` that is a count of 1, which is the answer nine times in ten.
    onChange([
      ...rows,
      joinEntry(spec.parts.map((part) => part.default ?? ""), spec.separator),
    ]);
    setFocusKey(`${rows.length}:0`);
  };

  /**
   * Enter carries on down the list rather than doing nothing.
   *
   * On the last row it adds another and puts the cursor in it, which is how
   * you type a list of names without touching the mouse. On any earlier row it
   * steps to the next one instead of inserting into the middle — Enter in a
   * list means "next", and a row appearing between two filled ones would be a
   * surprise every time.
   *
   * An unfilled row adds nothing: hitting Enter twice would otherwise leave a
   * trail of empty rows behind the cursor.
   */
  const onEnter = (event: KeyboardEvent<HTMLInputElement>, row: number) => {
    if (event.key !== "Enter") {
      return;
    }
    // There is no <form> here, but Enter in a text input is a submit gesture
    // in enough browsers' muscle memory that letting it bubble is a risk.
    event.preventDefault();
    if (row < rows.length - 1) {
      setFocusKey(`${row + 1}:0`);
      return;
    }
    if (rowIsBlank(cellsOf(row))) {
      return;
    }
    add();
  };

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="text-sm font-medium">{param.label}</span>
      {param.help && <span className="text-xs text-muted">{param.help}</span>}

      {rows.length === 0 && spec.emptyLabel && (
        <span className="text-xs text-muted">{spec.emptyLabel}</span>
      )}

      {rows.map((row, index) => {
        const cells = splitEntry(row, spec.parts.length, spec.separator);
        return (
          <div key={index} className="flex items-end gap-2">
            {spec.parts.map((part, at) => (
              <label
                key={part.key}
                className={`flex flex-col gap-1 ${
                  part.width === "narrow" ? "w-20 shrink-0" : "flex-1"
                }`}
              >
                {/* The part labels sit on every row rather than once above
                    them: the rows are added and removed, so a header would be
                    a label pointing at whatever happened to be first. */}
                <span className="text-xs text-muted">{part.label}</span>
                {part.type === "choice" ? (
                  // The options come from the PARAM, not the part: the part
                  // only says which catalog it is bound to, and the server
                  // filled the list from that binding when it built the
                  // schema. An icon row is a picker over `icons/`.
                  <select
                    value={cells[at] ?? ""}
                    onChange={(event) => setPart(index, at, event.target.value)}
                    className={FIELD}
                  >
                    <option value="">{part.placeholder ?? "—"}</option>
                    {(param.choices ?? []).map((choice) => (
                      <option key={String(choice.value)} value={String(choice.value)}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    ref={(node) => {
                      boxes.current.set(`${index}:${at}`, node);
                    }}
                    type={part.type === "text" ? "text" : "number"}
                    step={part.type === "float" ? "any" : undefined}
                    min={part.type === "integer" ? 1 : undefined}
                    value={cells[at] ?? ""}
                    placeholder={part.placeholder ?? undefined}
                    onChange={(event) => setPart(index, at, event.target.value)}
                    onKeyDown={(event) => onEnter(event, index)}
                    className={FIELD}
                  />
                )}
              </label>
            ))}
            <button
              type="button"
              aria-label={`Remove ${param.label} ${index + 1}`}
              onClick={() => onChange(rows.filter((_, at) => at !== index))}
              className="mb-1 rounded-lg border border-[var(--card-border)] p-2 text-muted hover:border-[var(--accent)]"
            >
              <LuX className="size-3.5" />
            </button>
          </div>
        );
      })}

      <div>
        <Button size="sm" variant="ghost" onPress={add}>
          <LuPlus className="size-3.5" />
          {spec.addLabel}
        </Button>
      </div>
    </div>
  );
}

function fileUrlFor(jobId: string, name: string): string {
  return `/api/customize/${jobId}/files/${encodeURIComponent(name)}`;
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: CustomizeParam;
  value: string;
  onChange: (next: string) => void;
}) {
  const hint = param.help || undefined;

  if (param.type === "flag") {
    return (
      <label className="flex items-start gap-3 py-1">
        <input
          type="checkbox"
          checked={value === "on"}
          onChange={(event) => onChange(event.target.checked ? "on" : "")}
          className="mt-1 size-4 accent-[var(--accent)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{param.label}</span>
          {hint && <span className="text-xs text-muted">{hint}</span>}
        </span>
      </label>
    );
  }

  if (param.source === "filaments") {
    // A full picker, with the catalog's own colours as the presets inside it.
    //
    // The presets are the spools you actually stock, which is the answer for
    // most orders and the one that needs no thought. The area and hue slider
    // are there because customers ask for colours that are not on the shelf,
    // and refusing to *show* such a colour does not make the request go away
    // — it just moves the conversation off the page.
    const swatch = HEX.test(value) ? value : PICKER_FALLBACK;
    // Name the colour when it is one of yours; otherwise the hex is the only
    // honest label, and it doubles as the flag that this is a special order.
    const preset = param.choices?.find(
      (choice) => String(choice.value).toLowerCase() === value.toLowerCase(),
    );

    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{param.label}</span>
        <ColorPicker
          value={swatch}
          onChange={(colour) => onChange(colour.toString("hex").toLowerCase())}
        >
          <ColorPicker.Trigger className="flex items-center gap-2">
            <ColorSwatch size="lg" />
            <Label className="cursor-pointer text-sm">
              {preset ? preset.label : swatch}
            </Label>
          </ColorPicker.Trigger>
          {/* A fixed width, because the popover otherwise sizes itself to the
              preset grid: a full filament line is thirty swatches, and left to
              itself that stretched the colour area wide enough to push the hue
              slider off the screen. The presets wrap inside this instead. */}
          <ColorPicker.Popover className="w-[260px] max-w-[calc(100vw-2rem)]">
            <ColorArea
              aria-label={`${param.label} area`}
              className="h-[150px] w-full"
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
            >
              <ColorArea.Thumb />
            </ColorArea>
            <ColorSlider
              aria-label={`${param.label} hue`}
              channel="hue"
              className="gap-1 px-1"
              colorSpace="hsb"
            >
              <Label>Hue</Label>
              <ColorSlider.Output className="text-muted" />
              <ColorSlider.Track>
                <ColorSlider.Thumb />
              </ColorSlider.Track>
            </ColorSlider>
            {param.choices && param.choices.length > 0 && (
              <ColorSwatchPicker
                className="max-h-[104px] flex-wrap justify-center gap-1 overflow-y-auto px-1"
                size="xs"
              >
                {param.choices.map((choice) => (
                  // The tooltip goes *inside* the item, not around it: a
                  // ColorSwatchPicker is a react-aria collection and builds
                  // itself from its direct children, so wrapping the item
                  // hides it from the collection entirely.
                  <ColorSwatchPicker.Item
                    key={String(choice.value)}
                    color={String(choice.value)}
                    aria-label={choice.label}
                  >
                    <Tooltip delay={150}>
                      {/* size-full: the trigger sits between the item and the
                          swatch, and a plain block collapses to 0x0 there —
                          the swatch has no intrinsic size and fills its
                          parent. Without this the whole grid renders blank. */}
                      <Tooltip.Trigger className="size-full">
                        <ColorSwatchPicker.Swatch />
                      </Tooltip.Trigger>
                      {/* Names the spool before it is chosen — "Cocoa Brown"
                          is the thing being ordered, and a grid of thirty
                          circles is otherwise a guessing game. */}
                      <Tooltip.Content>{choice.label}</Tooltip.Content>
                    </Tooltip>
                  </ColorSwatchPicker.Item>
                ))}
              </ColorSwatchPicker>
            )}
          </ColorPicker.Popover>
        </ColorPicker>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{param.label}</span>
      {param.choices ? (
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        >
          {/* A choice-typed parameter that is not required can be left to the
              script, which is not the same as any of the options. Name what
              that means where the model says — a bare dash is fine for a
              tuning knob and not for a field a customer is reading. */}
          {!param.required && !param.choices.some((c) => String(c.value) === value) && (
            <option value="">
              {param.placeholder ?? param.defaultHint ?? "—"}
            </option>
          )}
          {param.choices.map((choice) => (
            <option key={String(choice.value)} value={String(choice.value)}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={param.type === "float" || param.type === "integer" ? "number" : "text"}
          step={param.type === "float" ? "any" : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          // `show_default="fitted to the handle"` is often the only written
          // record of what happens when an option is left alone, so it earns
          // the placeholder rather than being buried in the hint.
          placeholder={param.placeholder ?? param.defaultHint ?? undefined}
          className={FIELD}
        />
      )}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

/**
 * One field, whichever kind it is. The two views render the same thing, so the
 * choice between a box and a list of rows is made in one place.
 */
function Field({
  param,
  value,
  onChange,
}: {
  param: CustomizeParam;
  value: string | string[] | undefined;
  onChange: (next: string | string[]) => void;
}) {
  if (param.multiple) {
    return (
      <MultiField
        param={param}
        rows={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    );
  }
  return (
    <ParamField
      param={param}
      value={typeof value === "string" ? value : ""}
      onChange={onChange}
    />
  );
}

export function Customizer({
  slug,
  basic,
  advanced,
}: {
  slug: string;
  basic: CustomizeParam[];
  advanced: ParamGroup[];
}) {
  const allParams = [...basic, ...advanced.flatMap((group) => group.params)];

  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(allParams.map((param) => [param.name, initialValue(param)])),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** Which of a multi-part result the viewer is showing. */
  const [shown, setShown] = useState(0);
  /**
   * The parameters the result on screen was built from.
   *
   * A run takes seconds to minutes, so the form cannot regenerate as you
   * type — which means the preview and the fields drift apart the moment
   * anything is touched. People read a preview as live and were changing a
   * colour, seeing no change, and concluding the app was broken. Holding on
   * to what was actually generated is what lets the UI say otherwise.
   */
  const [generatedFor, setGeneratedFor] = useState<string | null>(null);

  // What actually gets asked for, which is not quite what is on screen: rows
  // nobody filled in are not part of the order. See payloadFor.
  const payload = useMemo(() => payloadFor(allParams, values), [allParams, values]);

  // Key order is not stable across edits, so sort it: two identical parameter
  // sets must produce the same string or everything below misfires.
  const signature = useMemo(
    () => JSON.stringify(payload, Object.keys(payload).sort()),
    [payload],
  );

  const setValue = useCallback((name: string, next: string | string[]) => {
    setValues((current) => {
      const updated = { ...current, [name]: next };
      // Only a single-valued field can control another one: a dependent
      // default is keyed by the controller's value, and a list has none.
      if (typeof next !== "string") {
        return updated;
      }
      // Fields whose default follows this one move WITH it. The joint study's
      // revision letter is C for the snap and B for the tongue: a box that
      // keeps saying C after the connector changes engraves the wrong letter
      // on real parts, and the parts are printed by the time anyone notices.
      //
      // It overwrites whatever was typed there, deliberately. The alternative
      // is tracking whether each field was hand-edited and leaving stale ones
      // alone, which preserves a value that is now wrong — and silently, which
      // is the failure this exists to prevent. Re-typing a letter is cheap;
      // re-printing a set of coupons is not.
      for (const dependent of allParams) {
        if (dependent.dependsOn?.name !== name) {
          continue;
        }
        updated[dependent.name] = dependent.dependsOn.map[next] ?? "";
      }
      return updated;
    });
  }, [allParams]);

  // Polling, not streaming: a run is tens of seconds and the only thing that
  // changes is a status and a log tail, so a one-second GET is plenty and
  // keeps the route a plain JSON endpoint the future backend can serve too.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) {
      return;
    }
    const id = job.id;
    pollRef.current = setInterval(async () => {
      const response = await fetch(`/api/customize/${id}`);
      if (!response.ok) {
        return;
      }
      setJob(await response.json());
    }, 1000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [job]);

  async function generate() {
    setError(null);
    setStarting(true);
    try {
      const response = await fetch("/api/customize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, values: payload }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not start the generator.");
        setJob(null);
        return;
      }
      setShown(0);
      setGeneratedFor(signature);
      setJob(body);
    } catch {
      setError("Could not reach the generator.");
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || job?.status === "queued" || job?.status === "running";
  // The 3MF is what the preview reads: it keeps the part split, so the paw
  // and the name arrive as their own meshes in their own colours.
  //
  // A generator may write more than one. The lip balm holder writes a barrel
  // and a cap, which are two separate prints that screw together — showing
  // only the first would quietly hide half the part.
  const previews =
    job?.status === "done"
      ? job.files.filter((file) => file.name.endsWith(".3mf"))
      : [];
  const preview = previews[shown] ?? previews[0];
  // Stale means: there is a result, and the form no longer describes it.
  const stale =
    job?.status === "done" && generatedFor !== null && generatedFor !== signature;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[var(--card-border)] p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <LuSettings2 className="size-4" /> Customize
        </h2>
        {/* The difficulty knob, the way a slicer has one: the same part, with
            either the two fields that describe an order or every knob the
            script exposes. */}
        <Switch
          isSelected={showAdvanced}
          onChange={setShowAdvanced}
          className="flex flex-row items-center gap-2 text-sm"
        >
          <span className={showAdvanced ? "font-medium" : "text-muted"}>
            Advanced
          </span>
          {/* Content is the interactive part (react-aria's SwitchButton); the
              track and thumb live inside it, not beside it. */}
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {basic.map((param) => (
          <Field
            key={param.name}
            param={param}
            value={values[param.name]}
            onChange={(next) => setValue(param.name, next)}
          />
        ))}
      </div>

      {/* Hidden, not unmounted — see the note at the top of this file. */}
      <div className={showAdvanced ? "flex flex-col gap-5" : "hidden"}>
        {advanced.map((group) => (
          <fieldset key={group.title} className="flex flex-col gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
              {group.title}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {group.params.map((param) => (
                <Field
                  key={param.name}
                  param={param}
                  value={values[param.name]}
                  onChange={(next) => setValue(param.name, next)}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onPress={generate} isPending={busy}>
          {busy ? "Generating…" : stale ? "Re-generate" : "Generate"}
        </Button>
        {/* Say which of the three states this is, in the same place each
            time. "Stale" wins over the timing line: how long the last run
            took stops being the useful fact the moment it stops matching the
            form. */}
        {stale ? (
          <span className="text-sm font-medium text-[var(--accent-strong)]">
            Parameters changed — re-generate to see them.
          </span>
        ) : (
          job?.status === "done" && (
            <span className="text-sm text-muted">
              {job.cached
                ? "Already generated — served from cache."
                : `Done in ${((job.elapsedMs ?? 0) / 1000).toFixed(1)} s.`}
            </span>
          )
        )}
      </div>

      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {job?.status === "error" && job.error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>The generator refused</Alert.Title>
            {/* These scripts say exactly what is wrong and what to change
                ("--bore 24 leaves only 0.40 mm of wall … cap it at 22.40"), so
                the message is shown as written rather than paraphrased. */}
            <Alert.Description className="whitespace-pre-wrap">
              {job.error}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {busy && job && job.log.length > 0 && (
        <pre className="max-h-40 overflow-auto rounded-lg border border-[var(--card-border)] bg-black/5 p-3 text-xs dark:bg-white/5">
          {job.log.slice(-12).join("\n")}
        </pre>
      )}

      {job?.status === "done" && (
        <div className="flex flex-col gap-4">
          {previews.length > 1 && (
            // One button per part. Named from the file stem, since that is
            // what the generator called it ("custom-body" -> "body").
            <div className="flex flex-wrap gap-2">
              {previews.map((file, index) => {
                const stem = file.name.replace(/\.3mf$/, "");
                const dash = stem.lastIndexOf("-");
                return (
                  <Button
                    key={file.name}
                    size="sm"
                    variant={index === shown ? "primary" : "ghost"}
                    onPress={() => setShown(index)}
                  >
                    {dash > 0 ? stem.slice(dash + 1) : stem}
                  </Button>
                );
              })}
            </div>
          )}
          {preview && (
            // The message goes *on* the viewer, not only beside the button:
            // the viewer is where someone is looking when they wonder why
            // their change did nothing. Dimmed rather than hidden, so the
            // old part is still there to compare against.
            <div className="relative">
              <div className={stale ? "opacity-40 transition-opacity" : undefined}>
                <MeshPreview url={fileUrlFor(job.id, preview.name)} />
              </div>
              {stale && (
                <div className="absolute inset-0 grid place-items-center rounded-xl bg-[var(--background)]/60 backdrop-blur-[1px]">
                  <div className="flex flex-col items-center gap-2 px-4 text-center">
                    <p className="text-sm font-medium">
                      This is the previous version
                    </p>
                    <p className="max-w-xs text-xs text-muted">
                      The parameters have changed since it was generated.
                    </p>
                    <Button size="sm" onPress={generate} isPending={busy}>
                      <LuRefreshCw className="size-3.5" />
                      Re-generate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {stale && (
            <p className="text-xs text-muted">
              These files are the previous version too.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {job.files.map((file) => (
              // A plain anchor, not a Button: this is a download, and only a
              // real <a download> gets the browser to save the file rather
              // than navigate to it.
              <a
                key={file.name}
                href={`${fileUrlFor(job.id, file.name)}?download`}
                download={file.name}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
              >
                <LuDownload className="size-3.5" />
                {file.name}
                <Chip size="sm" variant="soft">
                  {(file.size / 1024).toFixed(0)} KB
                </Chip>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
