"use client";

import {
  Alert,
  Button,
  Checkbox,
  FieldError,
  Input,
  Label,
  Modal,
  TextArea,
  TextField,
} from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { LuPlus, LuTrash2, LuUpload } from "react-icons/lu";

import type { SupplyItem } from "@/lib/inventory";
import { supplyImageUrl } from "@/lib/urls";

import { perUnit } from "./format";
import { shrinkToWebp } from "./shrink-image";
import { SupplyThumb } from "./supply-thumb";

/**
 * The add/edit form for one supply, and the pieces it is built from.
 *
 * It lives apart from `supplies-browser.tsx` because it is opened from two
 * places now — the tab's card grid, and a supply's own page — and a form that
 * only one screen can reach is what sent you back to the list to edit anything.
 */

/** Common units offered in the datalist; any free-form value is accepted too. */
const UNITS = ["piece", "gram", "ml", "cm", "meter", "pair", "set"];

/**
 * Bare inputs inside the purchases rows. HeroUI's `TextField` carries its own
 * label and spacing, which fights a dense repeating row — same reasoning as
 * `INPUT` in `model/supplies-input.tsx`.
 */
export const FIELD =
  "rounded-lg border border-[var(--card-border)] bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--accent)]";

/** A required-field asterisk for a HeroUI Label. */
export function Req() {
  return (
    <span aria-hidden className="text-[var(--accent-strong)]">
      {" "}
      *
    </span>
  );
}

/**
 * The add/edit form, inside the modal.
 *
 * Name and Price are required, validated inline with HeroUI `TextField` +
 * `FieldError` (no native `required`, so no browser tooltip). The error shows
 * once a required field has been touched and left empty, and Save is disabled
 * until both are filled.
 *
 * The price is not typed in — it comes from the purchase history below, which
 * is how the thing is actually bought: a bag of 100 from one shop this month,
 * a bag of 20 from another the next. See `PurchasesField`.
 */
export function SupplyForm({
  current,
  currency,
  error,
  formAction,
  pending,
  onCancel,
}: {
  current: SupplyItem | null;
  currency: string;
  error: string | null;
  formAction: (payload: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current?.name ?? "");
  const [unit, setUnit] = useState(current?.unit ?? "piece");
  const [rows, setRows] = useState<PurchaseRow[]>(() => initialRows(current));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const nameEmpty = name.trim() === "";
  const priced = rows.filter(usable);
  const counted = priced.filter((row) => row.useForPrice);
  const canSave = !nameEmpty && counted.length > 0;

  const image = useSupplyImage(current);

  return (
    <form
      action={(payload) => {
        // The picked file is resized in the browser, so the shrunk copy goes
        // in place of whatever the file input holds.
        if (image.action === "replace" && image.file) {
          payload.set("image", image.file);
        }
        formAction(payload);
      }}
    >
      <Modal.Header>
        <Modal.Heading>
          {current ? `Edit ${current.name}` : "Add supply"}
        </Modal.Heading>
      </Modal.Header>

      {/* The body scrolls, the footer does not: this form grew a description,
          a purchase history and a photo, and without a cap the Save button
          ends up below the bottom of the screen. */}
      <Modal.Body className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        {error && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        <input type="hidden" name="id" value={current?.id ?? ""} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="name"
            value={name}
            onChange={setName}
            onBlur={() => touch("name")}
            isInvalid={Boolean(touched.name && nameEmpty)}
          >
            <Label>
              Name
              <Req />
            </Label>
            <Input placeholder="Gold jump ring 4mm" />
            <FieldError>A name is required.</FieldError>
          </TextField>

          <TextField name="category" defaultValue={current?.category ?? ""}>
            <Label>Category</Label>
            <Input placeholder="findings" />
          </TextField>

          <TextField name="unit" value={unit} onChange={setUnit}>
            <Label>Unit</Label>
            <Input list="supply-units" placeholder="piece" />
            <datalist id="supply-units">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </TextField>

          {/* Prose, not a label: this is where "the packs hold 24 pairs but
              are sold as 48" goes, which a one-line input truncates. */}
          <TextField
            name="description"
            defaultValue={current?.description ?? ""}
            className="sm:col-span-2"
          >
            <Label>Description</Label>
            <TextArea
              rows={2}
              placeholder="What it is, and anything that stays true between purchases."
            />
          </TextField>

          <div className="sm:col-span-2">
            <PurchasesField
              rows={rows}
              setRows={setRows}
              unit={unit}
              currency={currency}
              showError={Boolean(touched.purchases) && counted.length === 0}
              onBlur={() => touch("purchases")}
            />
          </div>

          <div className="sm:col-span-2">
            <ImageField image={image} alt={name} />
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer className="flex-col-reverse sm:flex-row sm:justify-end">
        <Button type="button" variant="tertiary" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          isPending={pending}
          isDisabled={!canSave || image.busy}
        >
          Save
        </Button>
      </Modal.Footer>
    </form>
  );
}

/** One editable purchase row. Everything is a string until it is submitted. */
export interface PurchaseRow {
  key: number;
  date: string;
  url: string;
  notes: string;
  packagePrice: string;
  packageQty: string;
  useForPrice: boolean;
}

let nextKey = 0;

export function blankRow(): PurchaseRow {
  return {
    key: (nextKey += 1),
    // Today, because you are almost always recording a purchase you just made.
    date: new Date().toISOString().slice(0, 10),
    url: "",
    notes: "",
    packagePrice: "",
    packageQty: "1",
    useForPrice: true,
  };
}

export function initialRows(current: SupplyItem | null): PurchaseRow[] {
  const rows = (current?.purchases ?? []).map((purchase) => ({
    key: (nextKey += 1),
    date: purchase.date ?? "",
    url: purchase.url ?? "",
    notes: purchase.notes ?? "",
    packagePrice:
      purchase.packagePrice != null ? String(purchase.packagePrice) : "",
    packageQty: purchase.packageQty != null ? String(purchase.packageQty) : "1",
    useForPrice: purchase.useForPrice,
  }));
  return rows.length > 0 ? rows : [blankRow()];
}

/** A row worth submitting: it at least says what was paid. */
export function usable(row: PurchaseRow): boolean {
  const price = Number(row.packagePrice);
  const qty = Number(row.packageQty);
  return (
    row.packagePrice.trim() !== "" &&
    Number.isFinite(price) &&
    price >= 0 &&
    Number.isFinite(qty) &&
    qty > 0
  );
}

/**
 * The purchase history editor.
 *
 * The same supply is rarely bought twice at the same price, so this keeps each
 * purchase rather than overwriting one number, and the per-unit price is the
 * **quantity-weighted** average of the ones ticked: everything spent over
 * everything it bought. Weighted matters — 10 units at $0.50 and 100 at $0.20
 * is $0.227 each, and averaging the two rates would say $0.35, letting a small
 * purchase count as much as a big one.
 *
 * Ticking only the newest is the other useful setting: that makes the price
 * what it costs to restock today, which is the number to price your work
 * against, since it is what you will pay to replace what you sold. Both
 * figures are shown so a drift between them is visible.
 */
export function PurchasesField({
  rows,
  setRows,
  unit,
  currency,
  showError,
  onBlur,
}: {
  rows: PurchaseRow[];
  setRows: (update: (rows: PurchaseRow[]) => PurchaseRow[]) => void;
  unit: string;
  currency: string;
  showError: boolean;
  onBlur: () => void;
}) {
  const update = (key: number, patch: Partial<PurchaseRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const payload = rows.filter(usable).map((row) => ({
    date: row.date,
    url: row.url,
    notes: row.notes,
    package_price: Number(row.packagePrice),
    package_qty: Number(row.packageQty),
    use_for_price: row.useForPrice,
  }));

  const counted = payload.filter((row) => row.use_for_price);
  const spent = counted.reduce((sum, row) => sum + row.package_price, 0);
  const units = counted.reduce((sum, row) => sum + row.package_qty, 0);
  const average = units > 0 ? spent / units : null;

  // "Latest" by date, falling back to the last row typed.
  const latest = [...counted]
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .at(-1);
  const latestEach = latest ? latest.package_price / latest.package_qty : null;
  const drifted =
    average !== null &&
    latestEach !== null &&
    counted.length > 1 &&
    Math.abs(latestEach - average) / average > 0.1;

  return (
    <div className="flex flex-col gap-2" onBlur={onBlur}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          Purchases
          <Req />
        </span>
        <span className="text-xs text-muted">
          Tick the ones the price should come from
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex flex-col gap-2 rounded-lg border border-[var(--card-border)] p-3"
          >
            <div className="flex items-center gap-3">
              <Checkbox
                isSelected={row.useForPrice}
                onChange={(useForPrice) => update(row.key, { useForPrice })}
                aria-label="Count this purchase toward the price"
                className="shrink-0"
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                </Checkbox.Content>
              </Checkbox>
              <input
                aria-label="Date bought"
                type="date"
                value={row.date}
                onChange={(event) =>
                  update(row.key, { date: event.target.value })
                }
                className={`${FIELD} w-40 shrink-0`}
              />
              <input
                aria-label="Where it was bought"
                type="url"
                inputMode="url"
                placeholder="https://www.amazon.com/dp/…"
                value={row.url}
                onChange={(event) =>
                  update(row.key, { url: event.target.value })
                }
                className={`${FIELD} min-w-0 flex-1`}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Remove this purchase"
                isDisabled={rows.length === 1}
                onPress={() =>
                  setRows((current) => current.filter((r) => r.key !== row.key))
                }
              >
                <LuTrash2 className="size-3.5" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 pl-8">
              <label className="flex items-center gap-2 text-xs text-muted">
                Paid ({currency})
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="5.00"
                  value={row.packagePrice}
                  onChange={(event) =>
                    update(row.key, { packagePrice: event.target.value })
                  }
                  className={`${FIELD} w-28`}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                for
                <input
                  type="number"
                  step="1"
                  min="1"
                  inputMode="numeric"
                  placeholder="100"
                  value={row.packageQty}
                  onChange={(event) =>
                    update(row.key, { packageQty: event.target.value })
                  }
                  className={`${FIELD} w-24`}
                />
                {unit.trim() || "units"}
              </label>
              {usable(row) && (
                <span className="text-xs text-muted">
                  ={" "}
                  {perUnit(
                    Number(row.packagePrice) / Number(row.packageQty),
                    currency,
                  )}{" "}
                  each
                </span>
              )}
            </div>

            <div className="pl-8">
              <input
                aria-label="Note about this purchase"
                type="text"
                placeholder="Note — a coupon, postage, a bag that arrived short…"
                value={row.notes}
                onChange={(event) =>
                  update(row.key, { notes: event.target.value })
                }
                className={`${FIELD} w-full`}
              />
            </div>
          </div>
        ))}
      </div>

      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onPress={() => setRows((current) => [...current, blankRow()])}
        >
          <LuPlus className="size-3.5" />
          Add purchase
        </Button>
      </div>

      {showError ? (
        <p className="text-xs text-[var(--danger)]">
          At least one purchase, with what you paid, has to be ticked.
        </p>
      ) : (
        <p className="text-xs text-muted">
          <span className="font-medium text-[var(--foreground)]">
            {perUnit(average, currency)}
          </span>{" "}
          per {unit.trim() || "unit"}
          {counted.length > 1 && (
            <>
              {" "}
              — {currency}
              {spent.toFixed(2)} across {units} over {counted.length} purchases
            </>
          )}
          {drifted && (
            <>
              . Your most recent was{" "}
              <span className="font-medium text-[var(--foreground)]">
                {perUnit(latestEach, currency)}
              </span>{" "}
              — tick only that one to price against what restocking costs today.
            </>
          )}
        </p>
      )}

      <input type="hidden" name="purchases" value={JSON.stringify(payload)} />
    </div>
  );
}

type SupplyImage = ReturnType<typeof useSupplyImage>;

/**
 * The photo half of the form: what it is now, and what to do about it.
 *
 * Three outcomes have to stay distinguishable on the server — left alone,
 * replaced, cleared — so the choice travels as `image_action` rather than
 * being guessed from whether a file arrived.
 */
function useSupplyImage(current: SupplyItem | null) {
  const existing = current?.image ?? "";
  const [action, setAction] = useState<"keep" | "replace" | "remove">("keep");
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each preview holds a blob alive until it is revoked; the cleanup runs when
  // the url changes as well as on unmount, so picking twice leaks nothing.
  useEffect(() => {
    if (!objectUrl) {
      return;
    }
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  async function pick(picked: File) {
    if (!picked.type.startsWith("image/")) {
      setError("That file isn't an image.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const shrunk = await shrinkToWebp(picked);
      setFile(shrunk);
      setObjectUrl(URL.createObjectURL(shrunk));
      setAction("replace");
    } catch {
      setError("That image could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setFile(null);
    setObjectUrl(null);
    setError(null);
    // Nothing to remove server-side if the supply never had a photo — this is
    // someone undoing a pick they hadn't saved yet.
    setAction(existing ? "remove" : "keep");
  }

  const preview =
    objectUrl ?? (action === "remove" || !existing ? null : supplyImageUrl(existing));

  return { action, existing, file, preview, busy, error, pick, clear };
}

function ImageField({ image, alt }: { image: SupplyImage; alt: string }) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Photo</span>
      <div
        className="flex items-center gap-4 rounded-lg border border-dashed border-[var(--card-border)] p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const dropped = event.dataTransfer.files?.[0];
          if (dropped) {
            void image.pick(dropped);
          }
        }}
      >
        {image.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.preview}
            alt={alt}
            className="size-20 shrink-0 rounded-lg border border-[var(--card-border)] object-cover"
          />
        ) : (
          <SupplyThumb image={null} size={80} />
        )}

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              isPending={image.busy}
              onPress={() => input.current?.click()}
            >
              <LuUpload className="size-3.5" />
              {image.preview ? "Replace" : "Choose photo"}
            </Button>
            {image.preview && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onPress={image.clear}
              >
                <LuTrash2 className="size-3.5" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">
            {image.error ??
              "Drop a photo here, so you recognise this supply without reading its name."}
          </p>
        </div>
      </div>

      {/* Unnamed: the form submits the resized copy, never what was picked. */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) {
            void image.pick(picked);
          }
          // Reset, so picking the same file twice fires onChange again.
          event.target.value = "";
        }}
      />
      <input type="hidden" name="image_action" value={image.action} />
      <input type="hidden" name="image_current" value={image.existing} />
    </div>
  );
}
