"use client";

import { Accordion } from "@heroui/react";
import { useState, useTransition } from "react";
import { LuExternalLink } from "react-icons/lu";

import { openFileAction } from "@/actions/model.action";
import type { ModelFile } from "@/lib/catalog";
import { formatMoney } from "@/lib/cost";
import { formatSize } from "@/lib/files";
import type { ThreeMfFileSummary } from "@/lib/threemf";

/** 1510 → "25 min"; 5400 → "1 h 30 min". */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function Swatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full border border-[var(--card-border)]"
      style={{ background: colour }}
    />
  );
}

/** One label/value line inside a panel. */
function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/**
 * What the slicer recorded — or, when the project was saved before slicing,
 * how to make it exist. That second case is the common one, so it's worth
 * saying plainly rather than leaving the panel empty.
 */
function SlicePanel({
  slice,
  cost,
}: {
  slice: ThreeMfFileSummary["slice"];
  cost: ThreeMfFileSummary["cost"];
}) {
  if (!slice) {
    return (
      <p className="text-xs leading-relaxed text-muted">
        No slice information in this file. Saving a project in Bambu Studio
        keeps your settings but not the slice result — to record the filament
        weight and print time, use{" "}
        <strong className="font-medium">
          File → Export → Export plate sliced file
        </strong>{" "}
        and keep the resulting <code>.gcode.3mf</code> in this folder.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      {slice.grams !== null && (
        <Detail
          label="Filament"
          value={<strong>{slice.grams.toFixed(1)} g</strong>}
        />
      )}
      {slice.seconds !== null && (
        <Detail label="Print time" value={formatDuration(slice.seconds)} />
      )}
      {slice.printer && <Detail label="Printer" value={slice.printer} />}
      {slice.nozzle && <Detail label="Nozzle" value={`${slice.nozzle} mm`} />}
      {slice.supports !== null && (
        <Detail label="Supports" value={slice.supports ? "Yes" : "No"} />
      )}

      {cost && (
        // This file's slice of the landed cost — material (with the waste
        // buffer) plus machine time. Purchased parts, packaging, labor, tax and
        // markup are per-model, shown in the Cost card, not per file.
        <div className="mt-1 flex flex-col gap-1 border-t border-[var(--card-border)] pt-1">
          {cost.rawMaterials !== null && (
            <Detail
              label="Filament"
              value={formatMoney(cost.rawMaterials, cost.currency)}
            />
          )}
          {cost.machine !== null && (
            <Detail
              label="Machine cost"
              value={formatMoney(cost.machine, cost.currency)}
            />
          )}
          <Detail
            label="Subtotal"
            value={
              <strong>{formatMoney(cost.subtotal, cost.currency)}</strong>
            }
          />
        </div>
      )}

      {slice.filaments.length > 0 && (
        <div className="mt-1 flex flex-col gap-1 border-t border-[var(--card-border)] pt-1">
          {slice.filaments.map((filament) => (
            <div key={filament.id} className="flex items-center gap-2">
              {filament.colour && <Swatch colour={filament.colour} />}
              <span className="font-medium">T{filament.id}</span>
              {filament.type && <span className="text-muted">{filament.type}</span>}
              <span className="ml-auto text-right text-muted">
                {filament.metres !== null && `${filament.metres.toFixed(2)} m`}
                {filament.metres !== null && filament.grams !== null && " · "}
                {filament.grams !== null && `${filament.grams.toFixed(2)} g`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Which colour sits on which tool, and what each one prints. */
function ToolsPanel({ tools }: { tools: ThreeMfFileSummary["tools"] }) {
  if (tools.length === 0) {
    return (
      <p className="text-xs text-muted">
        This file records no tool assignments.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      {tools.map((tool) => (
        <div key={tool.extruder} className="flex items-center gap-2">
          {tool.colour ? <Swatch colour={tool.colour} /> : <span className="size-2.5" />}
          <span className="font-medium">T{tool.extruder}</span>
          {tool.colour && <span className="font-mono">{tool.colour}</span>}
          {tool.roles.length > 0 && (
            <span
              className="ml-auto truncate text-right text-muted"
              title={tool.roles.join(", ")}
            >
              {tool.roles.join(", ")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * One file in the Files card.
 *
 * The whole row opens the file in its application on the machine running the
 * catalog. For a `.3mf` the row also carries two collapsed panels — what the
 * slicer recorded, and which colour is on which tool — so the detail is one
 * click away without crowding a folder that holds a dozen files.
 */
export function FileRow({
  file,
  summary,
}: {
  file: ModelFile;
  summary?: ThreeMfFileSummary;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await openFileAction(file.relPath);
      if (result.error) {
        setError(result.error);
      }
    });
  }

  // HeroUI's `.accordion__trigger` is a plain CSS class carrying `px-4 py-4`,
  // which plain utilities can't outrank — hence the `!` modifiers. Card-sized
  // padding would swamp these rows in a narrow sidebar. The indicator carries
  // `ml-auto`, so the label goes first and the chevron trails, as HeroUI
  // intends; putting the indicator first drags the label to the right edge.
  const trigger =
    "flex w-full items-center gap-1.5 px-0! py-1! text-left text-xs text-muted hover:text-[var(--foreground)]";

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={open}
        disabled={pending}
        title={`Open ${file.name}`}
        className="group flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-[var(--accent-strong)] disabled:opacity-60"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate font-mono text-xs">{file.name}</span>
          <LuExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
          {/* Grams only exist when the project was saved after slicing, so
              this is the headline when present — it's what you actually want
              to know before starting a print. */}
          {summary?.slice?.grams != null && (
            <span className="font-medium text-[var(--foreground)]">
              {summary.slice.grams.toFixed(1)} g
            </span>
          )}
          {summary?.cost && (
            // This file's material + machine cost. The finished-part price
            // (with supplies, packaging, labor and markup) is in the Cost card.
            <span
              className="font-medium text-[var(--foreground)]"
              title="Material + machine cost for this file"
            >
              {formatMoney(summary.cost.subtotal, summary.cost.currency)}
            </span>
          )}
          {summary?.slice?.seconds != null && (
            <span>{formatDuration(summary.slice.seconds)}</span>
          )}
          <span>{formatSize(file.size)}</span>
        </span>
      </button>

      {summary && (
        // Indented behind a guide line, the same way the folder tree marks
        // nesting — otherwise the panels read as loose items in the section
        // rather than as belonging to the file above them.
        <div className="mb-2 ml-1 border-l border-[var(--card-border)] pl-3">
          <Accordion hideSeparator>
            <Accordion.Item id="slice">
              <Accordion.Heading>
                <Accordion.Trigger className={trigger}>
                  Slice information
                  <Accordion.Indicator className="size-3" />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="pb-2">
                  <SlicePanel slice={summary.slice} cost={summary.cost} />
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item id="tools">
              <Accordion.Heading>
                <Accordion.Trigger className={trigger}>
                  Colors and tools
                  <Accordion.Indicator className="size-3" />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="pb-2">
                  <ToolsPanel tools={summary.tools} />
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </div>
      )}

      {error && (
        <p className="pb-2 text-xs text-[var(--accent-strong)]">{error}</p>
      )}
    </div>
  );
}
