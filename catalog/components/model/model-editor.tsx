"use client";

import { Alert, Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { type SaveModelState, saveModelAction } from "@/actions/model.action";
import { TagInput } from "@/components/forms/tag-input";
import type { Model } from "@/lib/catalog";
import type { SupplyItem } from "@/lib/inventory";

import { MarkdownEditor } from "./markdown-editor";
import { SuppliesInput } from "./supplies-input";

const STATUSES = ["", "idea", "wip", "printed"];

const initialState: SaveModelState = { error: null };

/** Shared styling for the plain inputs, matching the tag input's border. */
const FIELD =
  "w-full rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

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
  onDone,
}: {
  model: Model;
  allTags: string[];
  allMaterials: string[];
  allPrinters: string[];
  allSupplies: SupplyItem[];
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
        <Field label="Labor (minutes)" hint="Prep, clean and package time.">
          <input
            name="labor_minutes"
            type="number"
            step="1"
            min="0"
            defaultValue={model.laborMinutes ?? ""}
            placeholder="5"
            className={FIELD}
          />
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
