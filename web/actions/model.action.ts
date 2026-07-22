"use server";

import { revalidatePath } from "next/cache";

import type { ModelSupply } from "@/lib/catalog";
import { CatalogError, type CatalogRoot } from "@/lib/model-path";
import { openCatalogFile, openModelFolder } from "@/lib/open";
import { saveModelReadme, updateModelFrontmatter } from "@/lib/write";

/**
 * The single mutating entry point: save one model's README.
 *
 * Everything the edit form collects lands here, gets normalised, and is handed
 * to `saveModelReadme`, which owns the path guard and the merge rules.
 */

export interface SaveModelState {
  error: string | null;
  success?: boolean;
}

/** Trim a form value, returning "" for anything missing. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * "PLA, PETG ,pla" → ["PLA", "PETG"]. Case and order are the author's;
 * duplicates are dropped case-insensitively.
 */
function list(formData: FormData, name: string): string[] {
  const out: string[] = [];
  for (const part of field(formData, name).split(",")) {
    const entry = part.trim();
    if (entry && !out.some((seen) => seen.toLowerCase() === entry.toLowerCase())) {
      out.push(entry);
    }
  }
  return out;
}

/** Tags are additionally lowercased and sorted, so they group reliably. */
function tags(formData: FormData): string[] {
  return [...new Set(list(formData, "tags").map((tag) => tag.toLowerCase()))].sort();
}

/**
 * Supply lines (supplies or packaging) arrive as a JSON array of `{ item, qty }`
 * in a hidden field, since a flat comma string (what `TagInput` produces) can't
 * carry the count. Anything malformed, unnamed or non-positive is dropped.
 */
function supplies(formData: FormData, fieldName: string): ModelSupply[] {
  const raw = field(formData, fieldName);
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const out: ModelSupply[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const item = typeof row.item === "string" ? row.item.trim() : "";
    const qty = Number(row.qty);
    if (item && Number.isFinite(qty) && qty > 0) {
      out.push({ item, qty });
    }
  }
  return out;
}

/** A numeric field: a finite non-negative number, or "" so the merge deletes it. */
function numberField(formData: FormData, name: string): number | "" {
  const raw = field(formData, name);
  if (!raw) {
    return "";
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : "";
}

export async function saveModelAction(
  slug: string,
  _prevState: SaveModelState,
  formData: FormData,
): Promise<SaveModelState> {
  const date = field(formData, "date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Date must look like 2026-07-19." };
  }

  try {
    await saveModelReadme(
      slug,
      {
        title: field(formData, "title"),
        description: field(formData, "description"),
        tags: tags(formData),
        status: field(formData, "status"),
        date,
        materials: list(formData, "materials"),
        // Always empty: the merge treats that as "delete", which retires the
        // legacy singular key on the first save.
        material: "",
        printers: list(formData, "printers"),
        printer: "",
        source: field(formData, "source"),
        license: field(formData, "license"),
        cover: field(formData, "cover"),
        // Always empty: the model no longer pins filaments, so a save retires
        // any leftover filament / filaments / filament_color keys.
        filaments: [],
        filament: "",
        filament_color: "",
        supplies: supplies(formData, "supplies"),
        packaging: supplies(formData, "packaging"),
        failure_risk: field(formData, "failure_risk"),
        efficiency_factor: "",
        labor_minutes: numberField(formData, "labor_minutes"),
        shipping_cost: numberField(formData, "shipping_cost"),
        markup_percent: numberField(formData, "markup_percent"),
        // Retire the pre-split flat fee.
        packaging_cost: "",
      },
      typeof formData.get("body") === "string"
        ? (formData.get("body") as string)
        : "",
    );
  } catch (error) {
    if (error instanceof CatalogError) {
      return { error: error.message };
    }
    return {
      error: error instanceof Error ? error.message : "Could not save the file.",
    };
  }

  // The pages are force-dynamic, but revalidating clears the client router
  // cache so navigating back to the grid shows the new tags immediately.
  revalidatePath("/", "layout");
  return { error: null, success: true };
}

/**
 * Save the cost card's preferred filament — a targeted frontmatter update that
 * leaves the rest of the README (and its body) untouched. An empty id clears it.
 */
export async function saveCostFilamentAction(
  slug: string,
  filamentId: string,
): Promise<{ error: string | null }> {
  try {
    await updateModelFrontmatter(slug, { cost_filament: filamentId });
    revalidatePath("/", "layout");
    return { error: null };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { error: error.message };
    }
    return {
      error:
        error instanceof Error ? error.message : "Could not save the filament.",
    };
  }
}

/**
 * Save the per-model profit markup — used when the user types a target price in
 * the cost card and the markup is back-solved to hit it. Targeted write.
 */
export async function saveMarkupAction(
  slug: string,
  markupPercent: number,
): Promise<{ error: string | null }> {
  try {
    const value = Number.isFinite(markupPercent) && markupPercent >= 0
      ? Math.round(markupPercent * 100) / 100
      : 0;
    await updateModelFrontmatter(slug, { markup_percent: value });
    revalidatePath("/", "layout");
    return { error: null };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { error: error.message };
    }
    return {
      error:
        error instanceof Error ? error.message : "Could not save the price.",
    };
  }
}

export interface OpenFolderResult {
  /** Absolute path, echoed back so the UI can show it when opening fails. */
  path?: string;
  error?: string;
}

/**
 * Reveal a model's folder in the desktop file manager.
 *
 * The file manager opens on the machine running the catalog, which for a
 * localhost tool is the machine you are sitting at.
 */
export async function openFolderAction(
  slug: string,
): Promise<OpenFolderResult> {
  try {
    return { path: await openModelFolder(slug) };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { error: error.message };
    }
    return {
      error:
        error instanceof Error ? error.message : "Could not open the folder.",
    };
  }
}

/**
 * Open one file in its application — the editor for code and prose, the
 * desktop's own file association for everything else.
 */
export async function openFileAction(
  relPath: string,
  root: CatalogRoot = "models",
): Promise<OpenFolderResult> {
  try {
    const { path } = await openCatalogFile(relPath, root);
    return { path };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { error: error.message };
    }
    return {
      error: error instanceof Error ? error.message : "Could not open the file.",
    };
  }
}
