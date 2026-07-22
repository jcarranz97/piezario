"use client";

import { Alert, Button, Card } from "@heroui/react";
import { useActionState, useState } from "react";
import { LuPlus, LuTrash2 } from "react-icons/lu";

import {
  type InventoryState,
  saveCostAction,
} from "@/actions/inventory.action";
import type { CostConfig } from "@/lib/config";

/** A section heading inside the cost form. */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 border-b border-[var(--card-border)] pb-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// Base input styling with no width, so a row can size its inputs (flex-1, w-32)
// without `w-full` overriding them. FIELD adds full width for standalone fields.
const INPUT =
  "rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const FIELD = `w-full ${INPUT}`;

const initialState: InventoryState = { error: null };

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

type Rate = { type: string; rate: string };

/**
 * The per-material overrides editor: repeatable `{ type, rate }` rows, mirrored
 * into a hidden JSON field the save action parses. Same shape as the colours and
 * supplies editors elsewhere.
 */
function RateRows({ defaultRates }: { defaultRates: Rate[] }) {
  const [rows, setRows] = useState<Rate[]>(defaultRates);

  const update = (i: number, patch: Partial<Rate>) =>
    setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((cur) => [...cur, { type: "", rate: "" }]);
  const removeAt = (i: number) =>
    setRows((cur) => cur.filter((_, j) => j !== i));

  const payload = rows
    .filter((r) => r.type.trim() && r.rate.trim() !== "")
    .map((r) => ({ type: r.type.trim(), rate: Number(r.rate) }));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Per-material overrides</span>
      <span className="text-xs text-muted">
        A price per kg for a specific material type, matched against what the
        slicer recorded (PLA, PETG…). Leave empty to price everything at the
        default above.
      </span>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            aria-label="Material type"
            value={row.type}
            onChange={(e) => update(i, { type: e.target.value })}
            placeholder="PETG"
            className={`${INPUT} flex-1 uppercase`}
          />
          <input
            aria-label="Price per kg"
            type="number"
            step="0.01"
            min="0"
            value={row.rate}
            onChange={(e) => update(i, { rate: e.target.value })}
            placeholder="27.99"
            className={`${INPUT} w-32 shrink-0`}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Remove override"
            onPress={() => removeAt(i)}
          >
            <LuTrash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" variant="ghost" onPress={add}>
          <LuPlus className="size-3.5" />
          Add material
        </Button>
      </div>
      <input type="hidden" name="by_type" value={JSON.stringify(payload)} />
    </div>
  );
}

/** A cost value to its input string; null (unset) becomes "". */
function numStr(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * The Others tab: the cost settings from `catalog.yaml`'s `cost:` section.
 *
 * These are the figures the landed cost can't infer — spool price, machine
 * rate, labor rate, packaging, tax and markup. Saving writes back through the
 * inventory action (the only code that touches `catalog.yaml`) and revalidates
 * the layout, so every model's cost card reflects the change. Clearing a number
 * removes it, restoring the documented default.
 *
 * The inputs are **controlled**. React 19 resets an uncontrolled `<form
 * action>` after it submits, which would snap every field back to its old value
 * even though the save succeeded; controlled inputs keep what you typed.
 */
export function OthersBrowser({ cost }: { cost: CostConfig }) {
  const [state, formAction, pending] = useActionState(
    saveCostAction,
    initialState,
  );

  const [values, setValues] = useState<Record<string, string>>(() => ({
    currency: cost.currency,
    filament_per_kg: numStr(cost.filamentPerKg),
    risk_low: String(cost.failureRisk.low),
    risk_medium: String(cost.failureRisk.medium),
    risk_high: String(cost.failureRisk.high),
    printer_price: numStr(cost.printerPrice),
    maintenance_cost: numStr(cost.maintenanceCost),
    lifespan_hours: numStr(cost.lifespanHours),
    power_watts: numStr(cost.powerWatts),
    electricity_per_kwh: numStr(cost.electricityPerKwh),
    labor_per_hour: numStr(cost.laborPerHour),
    shipping_cost: numStr(cost.shippingCost),
    tax_percent: numStr(cost.taxPercent),
    markup_percent: numStr(cost.markupPercent),
  }));
  const bind = (name: string) => ({
    value: values[name] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  });

  const defaultRates: Rate[] = Object.entries(cost.filamentPerKgByType).map(
    ([type, rate]) => ({ type, rate: String(rate) }),
  );

  // The machine rate, recomputed live from what's typed, for the readout.
  const currentMachineRate = (() => {
    const printerPrice = Number(values.printer_price);
    const maintenance = Number(values.maintenance_cost) || 0;
    const lifespan = Number(values.lifespan_hours);
    const watts = Number(values.power_watts);
    const kwh = Number(values.electricity_per_kwh);
    // Medium risk for the preview — a reprint costs both material and machine.
    const buffer = Number(values.risk_medium) || 1;
    let rate = 0;
    let have = false;
    if (values.printer_price && Number.isFinite(printerPrice) && lifespan > 0) {
      rate += (printerPrice + maintenance) / lifespan;
      have = true;
    }
    if (
      values.power_watts &&
      values.electricity_per_kwh &&
      Number.isFinite(watts) &&
      Number.isFinite(kwh)
    ) {
      rate += (watts / 1000) * kwh;
      have = true;
    }
    return have ? rate * buffer : null;
  })();

  return (
    <Card>
      <Card.Header>
        <Card.Title className="text-base">Cost settings</Card.Title>
      </Card.Header>
      <Card.Content>
        <form
          action={formAction}
          className="flex flex-col gap-5"
          // Only the Save button saves. Pressing Enter in a field would
          // otherwise submit the whole form — an accidental save on every field.
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              event.target instanceof HTMLInputElement
            ) {
              event.preventDefault();
            }
          }}
        >
          {state.error && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{state.error}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          {state.success && (
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>Saved.</Alert.Description>
              </Alert.Content>
            </Alert>
          )}

          <Section title="Raw materials">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Currency"
                hint="The symbol shown before every figure."
              >
                <input
                  name="currency"
                  {...bind("currency")}
                  placeholder="$"
                  className={FIELD}
                />
              </Field>
              <Field
                label="Default price per kg"
                hint="Used when a material has no override below."
              >
                <input
                  name="filament_per_kg"
                  type="number"
                  step="0.01"
                  min="0"
                  {...bind("filament_per_kg")}
                  placeholder="24.99"
                  className={FIELD}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Failure risk factors</span>
              <span className="text-xs text-muted">
                Each part picks a risk level; its factor buffers cost for
                reprints. 1.1 = +10%.
              </span>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Low">
                  <input
                    name="risk_low"
                    type="number"
                    step="0.01"
                    min="1"
                    {...bind("risk_low")}
                    placeholder="1.1"
                    className={FIELD}
                  />
                </Field>
                <Field label="Medium">
                  <input
                    name="risk_medium"
                    type="number"
                    step="0.01"
                    min="1"
                    {...bind("risk_medium")}
                    placeholder="1.3"
                    className={FIELD}
                  />
                </Field>
                <Field label="High">
                  <input
                    name="risk_high"
                    type="number"
                    step="0.01"
                    min="1"
                    {...bind("risk_high")}
                    placeholder="1.7"
                    className={FIELD}
                  />
                </Field>
              </div>
            </div>
            <RateRows defaultRates={defaultRates} />
          </Section>

          <Section
            title="Machine cost"
            aside={
              currentMachineRate !== null ? (
                <span className="text-xs text-muted">
                  ≈ {cost.currency}
                  {currentMachineRate.toFixed(2)}/hr
                </span>
              ) : undefined
            }
          >
            <p className="text-xs text-muted">
              The hourly rate is (printer price + maintenance) ÷ lifespan hours,
              plus power, all times the efficiency factor above (a reprint wastes
              machine time too).
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Printer price" hint="What the printer cost.">
                <input
                  name="printer_price"
                  type="number"
                  step="0.01"
                  min="0"
                  {...bind("printer_price")}
                  placeholder="1000"
                  className={FIELD}
                />
              </Field>
              <Field
                label="Maintenance (lifetime)"
                hint="Repairs + maintenance over the printer's whole life."
              >
                <input
                  name="maintenance_cost"
                  type="number"
                  step="0.01"
                  min="0"
                  {...bind("maintenance_cost")}
                  placeholder="250"
                  className={FIELD}
                />
              </Field>
              <Field
                label="Lifespan (hours)"
                hint="Estimated running hours over its life."
              >
                <input
                  name="lifespan_hours"
                  type="number"
                  step="1"
                  min="0"
                  {...bind("lifespan_hours")}
                  placeholder="13140"
                  className={FIELD}
                />
              </Field>
              <Field
                label="Power (watts)"
                hint="Average draw while printing."
              >
                <input
                  name="power_watts"
                  type="number"
                  step="1"
                  min="0"
                  {...bind("power_watts")}
                  placeholder="150"
                  className={FIELD}
                />
              </Field>
              <Field
                label="Electricity per kWh"
                hint="Your power price."
              >
                <input
                  name="electricity_per_kwh"
                  type="number"
                  step="0.01"
                  min="0"
                  {...bind("electricity_per_kwh")}
                  placeholder="0.14"
                  className={FIELD}
                />
              </Field>
            </div>
          </Section>

          <Section title="Labor &amp; shipping">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Labor per hour"
                hint="A model supplies the minutes. Defaults to 20 when blank."
              >
                <input
                  name="labor_per_hour"
                  type="number"
                  step="0.01"
                  min="0"
                  {...bind("labor_per_hour")}
                  placeholder="20"
                  className={FIELD}
                />
              </Field>
              <Field
                label="Shipping"
                hint="Default shipping fee per part (packaging is a per-part supply list). A model can override it."
              >
                <input
                  name="shipping_cost"
                  type="number"
                  step="0.01"
                  min="0"
                  {...bind("shipping_cost")}
                  placeholder="5.50"
                  className={FIELD}
                />
              </Field>
            </div>
          </Section>

          <Section title="Pricing">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Tax (%)"
                hint="Sales tax, added on top of the price after the markup."
              >
                <input
                  name="tax_percent"
                  type="number"
                  step="0.01"
                  min="0"
                  {...bind("tax_percent")}
                  placeholder="8"
                  className={FIELD}
                />
              </Field>
              <Field
                label="Markup (%)"
                hint="Profit as a percentage of landed cost. 50 → price is 1.5× cost."
              >
                <input
                  name="markup_percent"
                  type="number"
                  step="0.01"
                  min="0"
                  {...bind("markup_percent")}
                  placeholder="50"
                  className={FIELD}
                />
              </Field>
            </div>
          </Section>

          <div className="flex items-center gap-2">
            <Button type="submit" isPending={pending}>
              Save changes
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card>
  );
}
