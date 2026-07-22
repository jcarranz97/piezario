"use client";

import {
  Alert,
  Button,
  Card,
  Chip,
  FieldError,
  Input,
  Label,
  Modal,
  SearchField,
  TextField,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";

import {
  type InventoryState,
  deleteSupplyAction,
  saveSupplyAction,
} from "@/actions/inventory.action";
import type { SupplyItem } from "@/lib/inventory";

const initialState: InventoryState = { error: null };

/** Common units offered in the datalist; any free-form value is accepted too. */
const UNITS = ["piece", "gram", "ml", "cm", "meter", "pair", "set"];

/** A required-field asterisk for a HeroUI Label. */
function Req() {
  return (
    <span aria-hidden className="text-[var(--accent-strong)]">
      {" "}
      *
    </span>
  );
}

function money(value: number | null, currency: string): string {
  return value === null ? "—" : `${currency}${value.toFixed(2)}`;
}

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
          {filtered.map((item) => (
            <Card key={item.id}>
              <Card.Content className="flex flex-col gap-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.name}</p>
                    {item.category && (
                      <p className="truncate text-xs text-muted">
                        {item.category}
                      </p>
                    )}
                  </div>
                  {item.unit && (
                    <Chip size="sm" variant="soft">
                      {item.unit}
                    </Chip>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {money(item.price, currency)}
                    <span className="text-xs font-normal text-muted">
                      {" "}
                      / {item.unit ?? "unit"}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
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
                {item.notes && (
                  <p className="text-xs text-muted">{item.notes}</p>
                )}
              </Card.Content>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The add/edit form, inside the modal.
 *
 * Name and Price are required, validated inline with HeroUI `TextField` +
 * `FieldError` (no native `required`, so no browser tooltip). The error shows
 * once a required field has been touched and left empty, and Save is disabled
 * until both are filled.
 */
function SupplyForm({
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
  const [price, setPrice] = useState(
    current?.price != null ? String(current.price) : "",
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const nameEmpty = name.trim() === "";
  const priceEmpty = price.trim() === "";
  const canSave = !nameEmpty && !priceEmpty;

  return (
    <form action={formAction}>
      <Modal.Header>
        <Modal.Heading>
          {current ? `Edit ${current.name}` : "Add supply"}
        </Modal.Heading>
      </Modal.Header>

      <Modal.Body className="flex flex-col gap-4">
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

          <TextField name="unit" defaultValue={current?.unit ?? "piece"}>
            <Label>Unit</Label>
            <Input list="supply-units" placeholder="piece" />
            <datalist id="supply-units">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </TextField>

          <TextField
            name="price"
            value={price}
            onChange={setPrice}
            onBlur={() => touch("price")}
            isInvalid={Boolean(touched.price && priceEmpty)}
          >
            <Label>
              Price per unit ({currency})
              <Req />
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="0.05"
            />
            <FieldError>A price is required.</FieldError>
          </TextField>

          <TextField name="notes" defaultValue={current?.notes ?? ""}>
            <Label>Notes</Label>
            <Input />
          </TextField>
        </div>
      </Modal.Body>

      <Modal.Footer className="flex-col-reverse sm:flex-row sm:justify-end">
        <Button type="button" variant="tertiary" onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isPending={pending} isDisabled={!canSave}>
          Save
        </Button>
      </Modal.Footer>
    </form>
  );
}
