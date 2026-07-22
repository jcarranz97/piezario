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
import { LuCopy, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";

import {
  type InventoryState,
  deleteFilamentAction,
  saveFilamentAction,
} from "@/actions/inventory.action";
import { ComboInput } from "@/components/forms/combo-input";
import type { FilamentColor, FilamentItem } from "@/lib/inventory";

/** A required-field asterisk for a HeroUI Label. */
function Req() {
  return (
    <span aria-hidden className="text-[var(--accent-strong)]">
      {" "}
      *
    </span>
  );
}

// No-width base so the colour rows can size their inputs (w-14, flex-1) without
// a `w-full` overriding them.
const INPUT =
  "rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

const initialState: InventoryState = { error: null };

/** A colour dot; falls back to a hollow ring when no hex is set. */
function Swatch({ hex, title }: { hex: string | null; title?: string }) {
  return (
    <span
      title={title}
      className="inline-block size-4 shrink-0 rounded-full border border-[var(--card-border)]"
      style={hex ? { background: hex } : undefined}
    />
  );
}

/** The swatches a filament is stocked in, shown on its card. */
function ColorDots({ colors }: { colors: FilamentColor[] }) {
  if (colors.length === 0) {
    return <span className="text-xs text-muted">No colors yet</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {colors.map((c, i) => (
        <Swatch key={`${c.name}-${i}`} hex={c.hex} title={c.name || c.hex || ""} />
      ))}
    </span>
  );
}

/**
 * The colours editor inside the form: a repeatable list of `{ name, hex }`
 * rows, mirrored into a hidden JSON field the save action parses. Being a
 * controlled child of the keyed form, it re-seeds from `defaultColors` whenever
 * a different filament (or a clone) opens.
 */
function ColorsInput({ defaultColors }: { defaultColors: FilamentColor[] }) {
  const [rows, setRows] = useState<FilamentColor[]>(defaultColors);

  const update = (i: number, patch: Partial<FilamentColor>) =>
    setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((cur) => [...cur, { name: "", hex: "#888888" }]);
  const removeAt = (i: number) =>
    setRows((cur) => cur.filter((_, j) => j !== i));

  const payload = rows.filter((r) => r.name.trim() || r.hex);

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="text-sm font-medium">Available colors</span>
      {rows.length === 0 && (
        <p className="text-xs text-muted">
          None yet. Add each colour you stock this product in.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            aria-label="Color hex"
            type="color"
            value={row.hex ?? "#888888"}
            onChange={(e) => update(i, { hex: e.target.value })}
            className={`${INPUT} h-10 w-14 shrink-0 p-1`}
          />
          <input
            aria-label="Color name"
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="Black"
            className={`${INPUT} min-w-0 flex-1`}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Remove color"
            onPress={() => removeAt(i)}
          >
            <LuTrash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" variant="ghost" onPress={add}>
          <LuPlus className="size-3.5" />
          Add color
        </Button>
      </div>
      <input type="hidden" name="colors" value={JSON.stringify(payload)} />
    </div>
  );
}

function money(value: number | null, currency: string): string {
  return value === null ? "—" : `${currency}${value.toFixed(2)}`;
}

/**
 * The Filaments tab: your spool inventory.
 *
 * Read straight from `catalog.yaml`'s `filaments:` section, searchable, and
 * editable — Add or Edit opens the form, Save writes back through the inventory
 * action (the only code that touches `catalog.yaml`). A price change here
 * reprices every model that pins the spool, which is why the whole layout
 * revalidates on save.
 */
export function FilamentsBrowser({
  filaments,
  currency,
}: {
  filaments: FilamentItem[];
  currency: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // The open form, or null when closed. `base` seeds the fields; `keepId` is
  // true only when editing in place — a clone or a fresh add leaves the id
  // blank so the save creates a new spool instead of overwriting one.
  const [editing, setEditing] = useState<{
    base: FilamentItem | null;
    keepId: boolean;
  } | null>(null);
  const [state, formAction, pending] = useActionState(
    saveFilamentAction,
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
      return filaments;
    }
    return filaments.filter((item) =>
      [item.name, item.material, item.brand, item.id, ...item.colors.map((c) => c.name)]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    );
  }, [filaments, query]);

  async function remove(item: FilamentItem) {
    if (!confirm(`Delete "${item.name}" from your filaments?`)) {
      return;
    }
    setDeleting(item.id);
    await deleteFilamentAction(item.id);
    setDeleting(null);
    router.refresh();
  }

  // Existing brands and types across the inventory, for the autocomplete hints.
  const allMaterials = useMemo(
    () => filaments.map((f) => f.material).filter((m): m is string => Boolean(m)),
    [filaments],
  );
  const allBrands = useMemo(
    () => filaments.map((f) => f.brand).filter((b): b is string => Boolean(b)),
    [filaments],
  );

  const current = editing?.base ?? null;
  const keepId = editing?.keepId ?? false;
  // Remount the form whenever a different target opens, so `defaultValue`s
  // refresh — React keeps the same inputs mounted otherwise.
  const formKey = editing
    ? `${keepId ? "edit" : "new"}:${current?.id ?? current?.name ?? "blank"}`
    : "closed";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchField
          aria-label="Search filaments"
          value={query}
          onChange={setQuery}
          className="min-w-56 flex-1"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search filaments…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Button
          size="sm"
          onPress={() => setEditing({ base: null, keepId: false })}
        >
          <LuPlus className="size-4" />
          Add filament
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
              <FilamentForm
                key={formKey}
                current={current}
                keepId={keepId}
                currency={currency}
                allMaterials={allMaterials}
                allBrands={allBrands}
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
              {filaments.length === 0
                ? "No filaments yet"
                : "No filaments match your search"}
            </p>
            {filaments.length === 0 && (
              <p className="mt-1 text-sm text-muted">
                Add a spool, or list it under <code>filaments:</code> in{" "}
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
                    {item.brand && (
                      <p className="truncate text-xs text-muted">{item.brand}</p>
                    )}
                  </div>
                  {item.material && (
                    <Chip size="sm" variant="soft">
                      {item.material}
                    </Chip>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <ColorDots colors={item.colors} />
                  {item.colors.length > 0 && (
                    <span className="ml-auto text-xs text-muted">
                      {item.colors.length}{" "}
                      {item.colors.length === 1 ? "color" : "colors"}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {money(item.pricePerKg, currency)}
                    <span className="text-xs font-normal text-muted"> / kg</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${item.name}`}
                      onPress={() => setEditing({ base: item, keepId: true })}
                    >
                      <LuPencil className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Clone ${item.name}`}
                      onPress={() =>
                        setEditing({
                          base: { ...item, id: "", name: `${item.name} copy` },
                          keepId: false,
                        })
                      }
                    >
                      <LuCopy className="size-3.5" />
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
 * The add/edit/clone form, inside the modal.
 *
 * Name, Type and Price are required. Validation is client-side and inline
 * (HeroUI `TextField` + `FieldError` for the plain fields, a matching message on
 * the Type autocomplete) — no native `required`, so no browser tooltip. The
 * error shows once a required field has been touched and left empty, and Save is
 * disabled until all three are filled, which is what actually blocks a bad save.
 */
function FilamentForm({
  current,
  keepId,
  currency,
  allMaterials,
  allBrands,
  error,
  formAction,
  pending,
  onCancel,
}: {
  current: FilamentItem | null;
  keepId: boolean;
  currency: string;
  allMaterials: string[];
  allBrands: string[];
  error: string | null;
  formAction: (payload: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current?.name ?? "");
  const [material, setMaterial] = useState(current?.material ?? "");
  const [price, setPrice] = useState(
    current?.pricePerKg != null ? String(current.pricePerKg) : "",
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const nameEmpty = name.trim() === "";
  const materialEmpty = material.trim() === "";
  const priceEmpty = price.trim() === "";
  const canSave = !nameEmpty && !materialEmpty && !priceEmpty;

  return (
    <form action={formAction}>
      <Modal.Header>
        <Modal.Heading>
          {keepId
            ? `Edit ${current?.name}`
            : current
              ? "Clone filament"
              : "Add filament"}
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

        {/* Editing keeps the id stable; adding or cloning leaves it blank so the
            save derives a fresh id from the name. */}
        <input
          type="hidden"
          name="id"
          value={keepId ? (current?.id ?? "") : ""}
        />

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
            <Input placeholder="Bambu PLA Matte Black" />
            <FieldError>A name is required.</FieldError>
          </TextField>

          <ComboInput
            name="material"
            label="Material"
            required
            hint="PLA, PETG, TPU… matched when costing."
            defaultValue={current?.material ?? ""}
            suggestions={allMaterials}
            placeholder="PLA"
            uppercase
            onChange={setMaterial}
            onBlur={() => touch("material")}
            error={
              touched.material && materialEmpty
                ? "A material is required."
                : undefined
            }
          />

          <ComboInput
            name="brand"
            label="Brand"
            defaultValue={current?.brand ?? ""}
            suggestions={allBrands}
            placeholder="Bambu Lab"
          />

          <TextField
            name="price_per_kg"
            value={price}
            onChange={setPrice}
            onBlur={() => touch("price")}
            isInvalid={Boolean(touched.price && priceEmpty)}
          >
            <Label>
              Price per kg ({currency})
              <Req />
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="24.99"
            />
            <FieldError>A price is required.</FieldError>
          </TextField>

          <TextField name="notes" defaultValue={current?.notes ?? ""}>
            <Label>Notes</Label>
            <Input />
          </TextField>

          <ColorsInput defaultColors={current?.colors ?? []} />
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
