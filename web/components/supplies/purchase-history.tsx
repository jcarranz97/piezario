"use client";

import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Modal,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { LuExternalLink, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";

import { saveSupplyPurchasesAction } from "@/actions/inventory.action";
import type { SupplyItem } from "@/lib/inventory";

import { domain, money, perUnit } from "./format";
import {
  FIELD,
  type PurchaseRow,
  Req,
  blankRow,
  initialRows,
  usable,
} from "./supply-form";

/**
 * A supply's purchase history, editable one purchase at a time.
 *
 * The whole-supply form can edit these too, but reaching a single receipt
 * through it means opening a modal that also holds the name, the photo and
 * everything else — so correcting a date you mistyped is a trip through the
 * entire record. Here each row has its own pencil, and only the list is
 * written back (`saveSupplyPurchasesAction`).
 */
export function PurchaseHistory({
  supply,
  currency,
}: {
  supply: SupplyItem;
  currency: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The stored purchases as editable rows, newest first as the reader sorted
  // them. The file is the source of truth, re-read on every refresh — but this
  // must be memoised: `initialRows` mints a fresh key per call, so recomputing
  // it each render would give the open modal's row a key that no longer matches
  // any row, and every edit would look like a new purchase.
  const rows = useMemo(() => initialRows(supply), [supply]);

  function commit(next: PurchaseRow[]) {
    setError(null);
    const payload = next.filter(usable).map((row) => ({
      date: row.date,
      url: row.url,
      notes: row.notes,
      package_price: Number(row.packagePrice),
      package_qty: Number(row.packageQty),
      use_for_price: row.useForPrice,
    }));
    startTransition(async () => {
      const state = await saveSupplyPurchasesAction(supply.id, payload);
      if (state.error) {
        setError(state.error);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function save(row: PurchaseRow) {
    const exists = rows.some((r) => r.key === row.key);
    commit(exists ? rows.map((r) => (r.key === row.key ? row : r)) : [...rows, row]);
  }

  function remove(row: PurchaseRow) {
    if (rows.length === 1) {
      setError("A supply needs at least one purchase to have a price.");
      return;
    }
    commit(rows.filter((r) => r.key !== row.key));
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          No purchases recorded, so this has no price.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-left text-xs text-muted">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">From</th>
                <th className="py-2 pr-4 text-right font-medium">Paid</th>
                <th className="py-2 pr-4 text-right font-medium">
                  {supply.unit ?? "Units"}
                </th>
                <th className="py-2 pr-4 text-right font-medium">Each</th>
                <th className="py-2 pr-4 font-medium">Counts</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const paid = Number(row.packagePrice);
                const qty = Number(row.packageQty);
                const each = usable(row) ? paid / qty : null;
                return (
                  <Fragment key={row.key}>
                    <tr
                      className={`${
                        row.notes
                          ? ""
                          : "border-b border-[var(--card-border)] last:border-0"
                      } ${row.useForPrice ? "" : "text-muted"}`}
                    >
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {row.date || "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {row.url ? (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--accent-strong)] underline"
                          >
                            {domain(row.url)}
                            <LuExternalLink className="size-3" />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {money(Number.isFinite(paid) ? paid : null, currency)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {row.packageQty || "—"}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {perUnit(each, currency)}
                      </td>
                      <td className="py-2 pr-4">
                        {row.useForPrice ? (
                          <Chip size="sm" variant="soft">
                            in price
                          </Chip>
                        ) : (
                          <span className="text-xs">excluded</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit the purchase from ${row.date || "an unknown date"}`}
                            onPress={() => {
                              setError(null);
                              setEditing(row);
                            }}
                          >
                            <LuPencil className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete the purchase from ${row.date || "an unknown date"}`}
                            isPending={pending}
                            onPress={() => remove(row)}
                          >
                            <LuTrash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {/* A note spans the row rather than taking a column of its
                        own, which would squeeze the numbers. */}
                    {row.notes && (
                      <tr className="border-b border-[var(--card-border)] last:border-0">
                        <td colSpan={7} className="pb-2 text-xs text-muted">
                          {row.notes}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            setError(null);
            setEditing(blankRow());
          }}
        >
          <LuPlus className="size-3.5" />
          Add purchase
        </Button>
      </div>

      <Modal.Backdrop
        isOpen={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="w-full sm:max-w-[520px]">
            {editing && (
              <PurchaseForm
                key={editing.key}
                row={editing}
                unit={supply.unit}
                currency={currency}
                pending={pending}
                isNew={!rows.some((r) => r.key === editing.key)}
                onCancel={() => setEditing(null)}
                onSave={save}
              />
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

/** One purchase, on its own, with room to read what each field means. */
function PurchaseForm({
  row,
  unit,
  currency,
  pending,
  isNew,
  onCancel,
  onSave,
}: {
  row: PurchaseRow;
  unit: string | null;
  currency: string;
  pending: boolean;
  isNew: boolean;
  onCancel: () => void;
  onSave: (row: PurchaseRow) => void;
}) {
  const [draft, setDraft] = useState<PurchaseRow>(row);
  const set = (patch: Partial<PurchaseRow>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const paid = Number(draft.packagePrice);
  const qty = Number(draft.packageQty);
  const priceBad =
    draft.packagePrice.trim() === "" || !Number.isFinite(paid) || paid < 0;
  const qtyBad =
    draft.packageQty.trim() === "" || !Number.isFinite(qty) || qty <= 0;
  const each = !priceBad && !qtyBad ? paid / qty : null;

  return (
    <>
      <Modal.Header>
        <Modal.Heading>{isNew ? "Add purchase" : "Edit purchase"}</Modal.Heading>
      </Modal.Header>

      <Modal.Body className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        <label className="flex flex-col gap-1 text-sm">
          Date bought
          <input
            type="date"
            value={draft.date}
            onChange={(event) => set({ date: event.target.value })}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Where from
          <input
            type="url"
            inputMode="url"
            placeholder="https://www.amazon.com/dp/…"
            value={draft.url}
            onChange={(event) => set({ url: event.target.value })}
            className={FIELD}
          />
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Paid ({currency})
            <Req />
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="5.00"
              value={draft.packagePrice}
              onChange={(event) => set({ packagePrice: event.target.value })}
              className={`${FIELD} w-32`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            For how many {unit ?? "units"}
            <Req />
            <input
              type="number"
              step="1"
              min="1"
              inputMode="numeric"
              placeholder="100"
              value={draft.packageQty}
              onChange={(event) => set({ packageQty: event.target.value })}
              className={`${FIELD} w-28`}
            />
          </label>
          <p className="pb-1 text-sm text-muted">
            ={" "}
            <span className="font-medium text-[var(--foreground)]">
              {perUnit(each, currency)}
            </span>{" "}
            each
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Note
          <input
            type="text"
            placeholder="A coupon, postage, a bag that arrived short…"
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
            className={FIELD}
          />
        </label>

        <Checkbox
          isSelected={draft.useForPrice}
          onChange={(useForPrice) => set({ useForPrice })}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <span className="text-sm">
              Count this purchase toward the price
            </span>
          </Checkbox.Content>
        </Checkbox>
        <p className="-mt-2 text-xs text-muted">
          Untick the older ones and the price becomes what it costs you to
          restock today.
        </p>
      </Modal.Body>

      <Modal.Footer className="flex-col-reverse sm:flex-row sm:justify-end">
        <Button type="button" variant="tertiary" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          isPending={pending}
          isDisabled={priceBad || qtyBad}
          onPress={() => onSave(draft)}
        >
          Save
        </Button>
      </Modal.Footer>
    </>
  );
}
