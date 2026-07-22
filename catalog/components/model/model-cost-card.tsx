"use client";

import { Button, Card, Chip, Tooltip } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LuChevronDown, LuInfo, LuPencil, LuStar } from "react-icons/lu";

import { saveCostFilamentAction, saveMarkupAction } from "@/actions/model.action";
import { formatMoney } from "@/lib/cost";
import type { ModelCostGroup, ModelCostOption } from "@/lib/model-cost";

const FIELD =
  "rounded-lg border border-[var(--card-border)] bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--accent)]";

/** 1510 → "25 min"; 5400 → "1 h 30 min". */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/** One entry in a row's expandable breakdown. */
interface Detail {
  name: string;
  note?: string;
  amount: string;
  chip?: React.ReactNode;
}

/** A faint separator line inside a tooltip, adapting to the text colour. */
function HintDivider() {
  return <span className="my-1 block h-px bg-current opacity-20" />;
}

/** An ⓘ that reveals how a figure is calculated on hover/focus. */
function InfoTooltip({ text }: { text: React.ReactNode }) {
  return (
    <Tooltip delay={0}>
      {/* Tooltip.Trigger (not a bare <button>) wires the hover/focus handlers
          react-aria needs — a plain element never receives them. */}
      <Tooltip.Trigger
        aria-label="How this is calculated"
        className="inline-flex shrink-0 cursor-help items-center text-muted hover:text-[var(--foreground)]"
      >
        <LuInfo aria-hidden className="size-3.5" />
      </Tooltip.Trigger>
      <Tooltip.Content showArrow>
        <div className="max-w-72 whitespace-pre-line text-xs leading-relaxed">
          {text}
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

/**
 * One cost line. Every line shares the same layout — label, right-aligned value,
 * and a fixed chevron slot — so expandable and plain lines line up. A line with
 * a `breakdown` is a button that expands to show what it's made of; a line
 * without one is a static row with an empty chevron slot.
 */
function Row({
  label,
  value,
  strong,
  hint,
  breakdown,
}: {
  label: React.ReactNode;
  value: string;
  strong?: boolean;
  /** Explanation shown in the ⓘ tooltip — a string or structured node. */
  hint?: React.ReactNode;
  breakdown?: Detail[];
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(breakdown && breakdown.length > 0);

  return (
    <div className="flex flex-col">
      {/* label · ⓘ tooltip · right-aligned value · chevron toggle. Every row
          shares this layout, so plain and expandable rows line up. */}
      <div className="flex items-center gap-2 py-0.5">
        <span className={strong ? "font-semibold" : "text-muted"}>{label}</span>
        {hint && <InfoTooltip text={hint} />}
        <span
          className={`ml-auto tabular-nums ${strong ? "font-semibold" : ""}`}
        >
          {value}
        </span>
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label="Toggle breakdown"
            className="flex w-3.5 shrink-0 justify-center text-muted hover:text-[var(--foreground)]"
          >
            <LuChevronDown
              className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
      </div>

      {expandable && open && (
        <div className="mb-1 ml-1 flex flex-col gap-1 border-l border-[var(--card-border)] pl-3 pt-0.5 text-xs">
          {breakdown!.map((detail, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{detail.name}</span>
                {detail.chip}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {detail.note && (
                  <span className="text-muted">{detail.note}</span>
                )}
                <span className="w-16 text-right tabular-nums">
                  {detail.amount}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Price line — click the amount to type a target price. The markup needed to
 * hit it (given this part's landed cost and tax) is back-solved and saved to the
 * model, so the profit line then shows the real margin behind that price.
 */
function PriceRow({
  price,
  landed,
  taxPercent,
  currency,
  pending,
  onSetPrice,
}: {
  price: number;
  landed: number;
  taxPercent: number | null;
  currency: string;
  pending: boolean;
  onSetPrice: (markupPercent: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  function commit() {
    setEditing(false);
    const target = Number(value);
    if (!Number.isFinite(target) || target <= 0 || landed <= 0) {
      return;
    }
    // price = landed × (1 + markup) × (1 + tax)  ⇒  solve for markup.
    const taxFactor = 1 + (taxPercent ?? 0) / 100;
    const markup = (target / (landed * taxFactor) - 1) * 100;
    onSetPrice(Math.max(0, markup));
  }

  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="font-semibold">Price</span>
      <span className="ml-auto flex items-center gap-1">
        {editing ? (
          <span className="flex items-center">
            <span className="text-muted">{currency}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              className="w-20 rounded border border-[var(--accent)] bg-transparent px-1 py-0 text-right font-semibold tabular-nums outline-none"
            />
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setValue(price.toFixed(2));
              setEditing(true);
            }}
            title="Click to set a target price; the markup is adjusted to match"
            className="inline-flex items-center gap-1 font-semibold tabular-nums underline decoration-dotted decoration-muted underline-offset-4 hover:decoration-[var(--foreground)] disabled:opacity-60"
          >
            {formatMoney(price, currency)}
            <LuPencil className="size-3 text-muted" />
          </button>
        )}
      </span>
      <span className="w-3.5 shrink-0" />
    </div>
  );
}

/** One group's landed-cost breakdown. */
function GroupCost({
  group,
  supplyLines,
  packagingLines,
  rates,
  currency,
  pending,
  onSetMarkup,
  money,
}: {
  group: ModelCostGroup;
  supplyLines: ModelCostOption["cost"]["supplyLines"];
  packagingLines: ModelCostOption["cost"]["packagingLines"];
  rates: ModelCostOption["cost"]["rates"];
  currency: string;
  pending: boolean;
  onSetMarkup: (markupPercent: number) => void;
  money: (value: number) => string;
}) {
  // Turn resolved supply/packaging lines into breakdown rows (name · qty · cost).
  const supplyBreakdown = (
    lines: ModelCostOption["cost"]["supplyLines"],
  ): Detail[] =>
    lines.map((line) => ({
      name: line.supply?.name ?? line.item,
      note: `${line.qty}${line.supply?.unit ? ` ${line.supply.unit}` : "×"}`,
      amount: line.lineTotal !== null ? money(line.lineTotal) : "—",
      chip: !line.supply ? (
        <Chip size="sm" variant="soft" className="shrink-0">
          unknown
        </Chip>
      ) : undefined,
    }));
  // The part file's name, without its folder or the .gcode.3mf extension —
  // e.g. "out/MX_Raul_9_Verde_plate-1.gcode.3mf" → "MX_Raul_9_Verde_plate-1".
  const partName = (label: string) =>
    (label.split("/").pop() ?? label).replace(/\.(gcode\.)?3mf$/i, "");

  // "Failure risk (high)" or just "Failure risk" — the buffer's source.
  const riskLabel = rates.riskLevel
    ? `Failure risk (${rates.riskLevel})`
    : "Failure risk";

  // Filament cost, broken down: the rates up top, then the calculation below a
  // separator — price, buffer / then grams × buffer = buffered grams × price/kg.
  const totalGrams = group.files.reduce((sum, f) => sum + (f.grams ?? 0), 0);
  const bufferedGrams = totalGrams * rates.efficiency;
  const rate = rates.filamentPerKg;
  const rawHint =
    rate !== null ? (
      <>
        <div>Filament: {money(rate)}/kg</div>
        <div>
          {riskLabel}: ×{rates.efficiency}
        </div>
        <HintDivider />
        <div>
          {totalGrams.toFixed(1)} g × {rates.efficiency} ={" "}
          {bufferedGrams.toFixed(1)} g
        </div>
        <div>
          {bufferedGrams.toFixed(1)} g × {money(rate)}/kg ={" "}
          {money(group.rawMaterials)}
        </div>
      </>
    ) : (
      `Filament × ${rates.efficiency} waste buffer`
    );

  // Machine: the rate's parts up top, then hours × rate = cost below.
  const totalSeconds = group.files.reduce((sum, f) => sum + (f.seconds ?? 0), 0);
  const machineHours = totalSeconds / 3600;
  const m = rates.machine;
  const machineHint = m ? (
    <>
      <div>Printer wear: {money(m.depreciation)}/hr</div>
      <div>Electricity: {money(m.electricity)}/hr</div>
      <div>
        {riskLabel}: ×{m.buffer}
      </div>
      <HintDivider />
      <div>Rate: {money(m.perHour)}/hr</div>
      <div>
        {machineHours.toFixed(1)} h × {money(m.perHour)}/hr ={" "}
        {money(group.machine)}
      </div>
    </>
  ) : undefined;

  // Labor: the rate up top, then minutes × rate = cost below.
  const laborHint = (
    <>
      <div>Rate: {money(rates.laborPerHour)}/hr</div>
      <HintDivider />
      <div>
        {rates.laborMinutes} min × {money(rates.laborPerHour)}/hr ={" "}
        {money(group.labor)}
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-0.5">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {group.isEstimate ? "Estimate" : group.label}
        </p>
        {!group.isEstimate && group.fileCount > 0 && (
          <span className="text-xs text-muted">
            {group.fileCount} {group.fileCount === 1 ? "file" : "files"}
          </span>
        )}
      </div>

      {group.rawMaterials > 0 && (
        <Row
          label="Filament"
          value={money(group.rawMaterials)}
          hint={rawHint}
          breakdown={group.files.map((file) => ({
            name: partName(file.label),
            note: file.grams !== null ? `${file.grams.toFixed(1)} g` : undefined,
            amount: money(file.rawMaterials),
          }))}
        />
      )}
      {group.machine > 0 && (
        <Row
          label="Machine"
          value={money(group.machine)}
          hint={machineHint}
          breakdown={group.files.map((file) => ({
            name: partName(file.label),
            note:
              file.seconds !== null ? formatDuration(file.seconds) : undefined,
            amount: money(file.machine),
          }))}
        />
      )}
      {supplyLines.length > 0 && (
        <Row
          label="Supplies"
          value={money(group.purchased)}
          breakdown={supplyBreakdown(supplyLines)}
        />
      )}
      {packagingLines.length > 0 && (
        <Row
          label="Packaging"
          value={money(group.packaging)}
          breakdown={supplyBreakdown(packagingLines)}
        />
      )}
      {group.shipping > 0 && (
        <Row label="Shipping" value={money(group.shipping)} />
      )}
      {group.labor > 0 && (
        <Row label="Labor" value={money(group.labor)} hint={laborHint} />
      )}

      <Row label="Landed cost" value={money(group.landed)} strong />
      {group.profit !== null && (
        <Row
          label={`Profit (${group.markupPercent}%)`}
          value={money(group.profit)}
        />
      )}
      {group.tax !== null && (
        <>
          {group.profit !== null && (
            <Row label="Price before tax" value={money(group.total)} />
          )}
          <Row label={`Tax (${group.taxPercent}%)`} value={money(group.tax)} />
        </>
      )}
      {(group.tax !== null || group.profit !== null) && (
        <PriceRow
          price={group.price}
          landed={group.landed}
          taxPercent={group.taxPercent}
          currency={currency}
          pending={pending}
          onSetPrice={onSetMarkup}
        />
      )}
    </div>
  );
}

/**
 * The whole-model landed-cost card.
 *
 * The header dropdown chooses which filament to price from — each option is the
 * same model costed at that filament's rate. The model can remember a preferred
 * one (`cost_filament`): it pre-selects here, and changing the dropdown offers a
 * button to save the new choice. Costs are grouped by `out/` subfolder: the
 * **Estimate** (files directly in `out/`) is the reference price; each sale
 * batch (`out/juanito1/`) is its own total. Raw materials, Machine and Purchased
 * expand to show the per-file / per-supply detail behind each figure.
 */
export function ModelCostCard({
  options,
  slug,
  preferredFilament,
}: {
  options: ModelCostOption[];
  slug: string;
  preferredFilament: string | null;
}) {
  // Pre-select the saved preference when it's still a valid option.
  const validPreferred = options.some((o) => o.key === preferredFilament)
    ? preferredFilament
    : null;
  const router = useRouter();
  const [key, setKey] = useState(validPreferred ?? options[0]?.key);
  const [saved, setSaved] = useState(validPreferred);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = options.find((o) => o.key === key) ?? options[0];
  const cost = active.cost;
  const money = (value: number) => formatMoney(value, cost.currency);

  // Set a target price: save the back-solved markup, then re-read so every
  // group and filament option reprices from it.
  function setMarkup(markupPercent: number) {
    setError(null);
    startTransition(async () => {
      const result = await saveMarkupAction(slug, markupPercent);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  // Offer to save when a real filament (not the type-based default) is picked
  // that isn't already the saved preference.
  const canPrefer = options.length > 1 && key !== "default" && key !== saved;

  function setPreferred() {
    setError(null);
    startTransition(async () => {
      const result = await saveCostFilamentAction(slug, key!);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(key);
      }
    });
  }

  return (
    <Card>
      <Card.Header className="flex flex-wrap items-center justify-between gap-2">
        <Card.Title className="text-base">Cost</Card.Title>
        {options.length > 1 && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Filament to price from"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className={FIELD}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                  {o.key === saved ? " ★" : ""}
                </option>
              ))}
            </select>
            {canPrefer && (
              <Button
                size="sm"
                variant="secondary"
                isPending={pending}
                onPress={setPreferred}
              >
                <LuStar className="size-3.5" />
                Set preferred
              </Button>
            )}
          </div>
        )}
      </Card.Header>
      <Card.Content className="flex flex-col gap-5 text-sm">
        {options.length === 1 && options[0].key !== "default" && (
          <p className="-mt-2 text-xs text-muted">
            Priced from {options[0].label}.
          </p>
        )}
        {error && (
          <p className="-mt-2 text-xs text-[var(--accent-strong)]">{error}</p>
        )}

        {cost.groups.map((group) => (
          <GroupCost
            key={group.label}
            group={group}
            supplyLines={cost.supplyLines}
            packagingLines={cost.packagingLines}
            rates={cost.rates}
            currency={cost.currency}
            pending={pending}
            onSetMarkup={setMarkup}
            money={money}
          />
        ))}
      </Card.Content>
    </Card>
  );
}
