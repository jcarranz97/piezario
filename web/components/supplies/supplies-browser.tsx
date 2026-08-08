"use client";

import { Button, Card, Chip, Modal, SearchField } from "@heroui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { LuExternalLink, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";

import {
  type InventoryState,
  deleteSupplyAction,
  saveSupplyAction,
} from "@/actions/inventory.action";
import type { SupplyItem } from "@/lib/inventory";
import { supplyUrl } from "@/lib/urls";

import { domain, money, perUnit, plural } from "./format";
import { SupplyForm } from "./supply-form";
import { SupplyThumb } from "./supply-thumb";

const initialState: InventoryState = { error: null };

/**
 * The Supplies tab: consumables that aren't printed — rings, chains, glue.
 *
 * Same shape as the Filaments tab, read from `catalog.yaml`'s `supplies:`
 * section and edited through the inventory action. Each supply carries its own
 * **unit** (piece, gram, ml…), so a model can say "2 pieces of chain" or "5
 * grams of resin" and the cost resolves from the per-unit price here.
 */
export function SuppliesBrowser({
  supplies,
  currency,
}: {
  supplies: SupplyItem[];
  currency: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SupplyItem | "new" | null>(null);
  const [state, formAction, pending] = useActionState(
    saveSupplyAction,
    initialState,
  );
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (state.success) {
      setEditing(null);
      router.refresh();
    }
  }, [state, router]);


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return supplies;
    }
    return supplies.filter((item) =>
      [item.name, item.category, item.unit, item.id]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    );
  }, [supplies, query]);

  async function remove(item: SupplyItem) {
    if (!confirm(`Delete "${item.name}" from your supplies?`)) {
      return;
    }
    setDeleting(item.id);
    await deleteSupplyAction(item.id);
    setDeleting(null);
    router.refresh();
  }

  const current = editing === "new" ? null : editing;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchField
          aria-label="Search supplies"
          value={query}
          onChange={setQuery}
          className="min-w-56 flex-1"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search supplies…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Button size="sm" onPress={() => setEditing("new")}>
          <LuPlus className="size-4" />
          Add supply
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
          <Modal.Dialog className="w-full sm:max-w-[640px]">
            {editing !== null && (
              <SupplyForm
                key={current?.id ?? "new"}
                current={current}
                currency={currency}
                error={state.error}
                formAction={formAction}
                pending={pending}
                onCancel={() => setEditing(null)}
              />
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {filtered.length === 0 ? (
        <Card variant="transparent" className="py-12 text-center">
          <Card.Content>
            <p className="font-medium">
              {supplies.length === 0
                ? "No supplies yet"
                : "No supplies match your search"}
            </p>
            {supplies.length === 0 && (
              <p className="mt-1 text-sm text-muted">
                Add a supply, or list it under <code>supplies:</code> in{" "}
                <code>catalog.yaml</code>.
              </p>
            )}
          </Card.Content>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            // The newest purchase is what the card describes: what you last
            // paid, and the shop to reorder from.
            const latest = item.purchases[0] ?? null;
            const counted = item.purchases.filter((p) => p.useForPrice).length;
            const link = item.purchases.find((p) => p.url)?.url ?? null;
            return (
            <Card key={item.id}>
              <Card.Content className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  {/* The photo and the name lead to the supply's own page —
                      not the whole card, which would swallow the buttons. */}
                  <Link
                    href={supplyUrl(item.id)}
                    className="flex min-w-0 flex-1 items-start gap-3"
                  >
                    <SupplyThumb image={item.image} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium hover:underline">
                        {item.name}
                      </span>
                      {item.category && (
                        <span className="block truncate text-xs text-muted">
                          {item.category}
                        </span>
                      )}
                    </span>
                  </Link>
                  {item.unit && (
                    <Chip size="sm" variant="soft">
                      {item.unit}
                    </Chip>
                  )}
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">
                      {perUnit(item.price, currency)}
                      <span className="text-xs font-normal text-muted">
                        {" "}
                        / {item.unit ?? "unit"}
                      </span>
                    </span>
                    {/* What was actually paid last time, so the derived
                        per-unit price is never the only figure on screen —
                        and, when several purchases are averaged, that it is
                        an average rather than a receipt. Skipped when it
                        would only repeat the line above: one purchase of one
                        unit says nothing the price hasn't. */}
                    {latest?.packagePrice != null &&
                      latest.packageQty != null &&
                      (latest.packageQty > 1 || item.purchases.length > 1) && (
                        <p className="truncate text-xs text-muted">
                          {money(latest.packagePrice, currency)} per{" "}
                          {plural(latest.packageQty, item.unit)}
                          {counted > 1 && ` · avg of ${counted}`}
                        </p>
                      )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Straight to the listing — reordering is the reason this
                        is on the card rather than only in the form. The reader
                        has already dropped anything that isn't http(s). */}
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Buy ${item.name} at ${domain(link)}`}
                        title={domain(link)}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-[var(--accent-strong)]"
                      >
                        <LuExternalLink className="size-3.5" />
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${item.name}`}
                      onPress={() => setEditing(item)}
                    >
                      <LuPencil className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${item.name}`}
                      isPending={deleting === item.id}
                      onPress={() => remove(item)}
                    >
                      <LuTrash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {item.description && (
                  <p className="line-clamp-2 text-xs text-muted">
                    {item.description}
                  </p>
                )}
              </Card.Content>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

