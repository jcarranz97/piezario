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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuDownload, LuRefreshCw, LuSettings2 } from "react-icons/lu";

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

/** The starting value of one field, as a form string. */
function initialValue(param: CustomizeParam): string {
  if (param.type === "flag") {
    return param.default === true ? "on" : "";
  }
  return param.default === null || param.default === undefined
    ? ""
    : String(param.default);
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

  const [values, setValues] = useState<Record<string, string>>(() =>
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

  // Key order is not stable across edits, so sort it: two identical parameter
  // sets must produce the same string or everything below misfires.
  const signature = useMemo(
    () => JSON.stringify(values, Object.keys(values).sort()),
    [values],
  );

  const setValue = useCallback((name: string, next: string) => {
    setValues((current) => ({ ...current, [name]: next }));
  }, []);

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
        body: JSON.stringify({ slug, values }),
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
          <ParamField
            key={param.name}
            param={param}
            value={values[param.name] ?? ""}
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
                <ParamField
                  key={param.name}
                  param={param}
                  value={values[param.name] ?? ""}
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
