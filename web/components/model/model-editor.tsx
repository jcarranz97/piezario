"use client";

import { Alert, Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { type SaveModelState, saveModelAction } from "@/actions/model.action";
import { TagInput } from "@/components/forms/tag-input";
import type { Model } from "@/lib/catalog";
import type { SupplyItem } from "@/lib/inventory";

import { type ComponentOption, ComponentsInput } from "./components-input";
import { MarkdownEditor } from "./markdown-editor";
import { SuppliesInput } from "./supplies-input";

const STATUSES = ["", "idea", "wip", "printed"];

const initialState: SaveModelState = { error: null };

/**
 * Shared styling for the plain inputs, matching the tag input's border.
 *
 * `FIELD_BASE` carries no width, so a field that shares its row with another
 * (the labour minutes + basis pair) can size its parts with `flex-1` / `w-32`.
 * Adding a width utility next to `FIELD`'s `w-full` does not override it —
 * both are width utilities in the same layer, so which one wins depends on
 * stylesheet order rather than on the order you wrote them.
 */
const FIELD_BASE =
  "rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const FIELD = `w-full ${FIELD_BASE}`;

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

/**
 * The model edit form.
 *
 * Everything here maps onto YAML frontmatter in the model's README, except the
 * body, which is the markdown underneath it. Leaving a field blank removes the
 * key entirely so the catalog falls back to its derived value — that is why the
 * placeholders show what the fallback would be.
 */
export function ModelEditor({
  model,
  allTags,
  allMaterials,
  allPrinters,
  allSupplies,
  allModels,
  onDone,
}: {
  model: Model;
  allTags: string[];
  allMaterials: string[];
  allPrinters: string[];
  allSupplies: SupplyItem[];
  allModels: ComponentOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const action = saveModelAction.bind(null, model.slug);
  const [state, formAction, pending] = useActionState(action, initialState);

  // Leave edit mode and re-read from disk so the view shows what was saved.
  useEffect(() => {
    if (state.success) {
      onDone();
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Editing {model.title}
          </h1>
          <p className="text-sm text-muted">
            Saves to <code>models/{model.slug}/README.md</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onPress={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isPending={pending}>
            Save
          </Button>
        </div>
      </div>

      {state.error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{state.error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" hint="Blank uses the folder name.">
          <input
            name="title"
            defaultValue={model.title}
            placeholder={model.dirName}
            className={FIELD}
          />
        </Field>

        <Field label="Status">
          <select
            name="status"
            defaultValue={model.status ?? ""}
            className={FIELD}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status || "—"}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description" hint="Blank uses the README's first paragraph.">
        <textarea
          name="description"
          rows={2}
          defaultValue={model.description}
          className={`${FIELD} resize-y`}
        />
      </Field>

      <TagInput
        name="tags"
        label="Tags"
        defaultTags={model.tags}
        suggestions={allTags}
      />

      <TagInput
        name="materials"
        label="Materials"
        defaultTags={model.materials}
        suggestions={allMaterials}
      />

      <TagInput
        name="printers"
        label="Printers"
        defaultTags={model.printers}
        suggestions={allPrinters}
      />

      <ComponentsInput
        name="components"
        defaultComponents={model.components}
        catalog={allModels}
      />

      <SuppliesInput
        name="supplies"
        defaultSupplies={model.supplies}
        catalog={allSupplies}
      />

      <SuppliesInput
        name="packaging"
        label="Packaging"
        addLabel="Add packaging"
        emptyHint="None. Add a bag, box, or mailer this part ships in."
        defaultSupplies={model.packaging}
        catalog={allSupplies}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Labor (minutes)"
          hint={
            model.yieldUnits > 1
              ? `Prep, clean and package time. Per plate divides by the ${model.yieldUnits} units below.`
              : "Prep, clean and package time. Per plate divides by units per plate."
          }
        >
          {/* Five minutes to de-support one keychain and five minutes to
              de-support a plate of 52 keycaps are the same number and very
              different costs, and nothing about the number says which. */}
          <div className="flex items-center gap-2">
            <input
              name="labor_minutes"
              type="number"
              step="1"
              min="0"
              defaultValue={model.laborMinutes ?? ""}
              placeholder="5"
              className={`${FIELD_BASE} min-w-0 flex-1`}
            />
            <select
              name="labor_basis"
              aria-label="Labor basis"
              defaultValue={model.laborBasis}
              className={`${FIELD_BASE} w-32 shrink-0`}
            >
              <option value="part">per part</option>
              <option value="plate">per plate</option>
            </select>
          </div>
        </Field>
        <Field
          label="Failure risk"
          hint="Higher risk = more reprints = bigger buffer on cost."
        >
          <select
            name="failure_risk"
            defaultValue={model.failureRisk ?? "medium"}
            className={FIELD}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </Field>
        <Field label="Shipping cost" hint="Blank uses the default.">
          <input
            name="shipping_cost"
            type="number"
            step="0.01"
            min="0"
            defaultValue={model.shippingCost ?? ""}
            placeholder="5.50"
            className={FIELD}
          />
        </Field>
        <Field label="Profit markup (%)" hint="Blank uses the default.">
          <input
            name="markup_percent"
            type="number"
            step="0.01"
            min="0"
            defaultValue={model.markupPercent ?? ""}
            placeholder="50"
            className={FIELD}
          />
        </Field>
        <Field
          label="Units per plate"
          hint="How many finished pieces one sliced plate makes. Blank or 1 for a single-part plate."
        >
          <input
            name="yield"
            type="number"
            step="1"
            min="1"
            defaultValue={model.yieldUnits > 1 ? model.yieldUnits : ""}
            placeholder="1"
            className={FIELD}
          />
        </Field>
        <Field
          label="Kit discount (%)"
          hint="Off the pre-tax total, for a kit that sells below the sum of its parts."
        >
          <input
            name="discount_percent"
            type="number"
            step="0.01"
            min="0"
            defaultValue={model.discountPercent ?? ""}
            placeholder="0"
            className={FIELD}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" hint="YYYY-MM-DD">
          <input
            name="date"
            defaultValue={model.date ?? ""}
            placeholder="2026-07-19"
            className={FIELD}
          />
        </Field>
        <Field label="License">
          <input
            name="license"
            defaultValue={model.license ?? ""}
            placeholder="personal"
            className={FIELD}
          />
        </Field>
        <Field label="Source" hint="Where it came from, if downloaded.">
          <input
            name="source"
            defaultValue={model.source ?? ""}
            placeholder="https://…"
            className={FIELD}
          />
        </Field>
        <Field label="Cover image" hint="A filename in this model's folder.">
          <input
            name="cover"
            defaultValue={
              model.cover ? model.cover.slice(model.cover.lastIndexOf("/") + 1) : ""
            }
            placeholder="cover.png"
            className={FIELD}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">README</span>
        <MarkdownEditor name="body" slug={model.slug} defaultValue={model.body} />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" isPending={pending}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" onPress={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
