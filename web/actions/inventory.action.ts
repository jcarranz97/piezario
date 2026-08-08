"use server";

import { revalidatePath } from "next/cache";

import {
  InventoryError,
  type PurchaseInput,
  deleteFilament,
  deleteSupply,
  normaliseId,
  saveCost,
  saveFilament,
  saveSupply,
} from "@/lib/inventory-write";
import { resolveSupply } from "@/lib/inventory";
import { deleteSupplyImage, saveSupplyImage } from "@/lib/supply-image";

/**
 * The mutating entry points for the Filaments, Supplies and Others tabs.
 *
 * Everything the forms collect lands here, gets normalised, and is handed to
 * `lib/inventory-write.ts`, which owns the "only write catalog.yaml, preserve
 * its comments" rules. Every write revalidates the whole layout: a price or rate
 * change ripples into every model's cost card.
 */

export interface InventoryState {
  error: string | null;
  /** The id that was saved, so the browser can highlight the fresh row. */
  savedId?: string;
  success?: boolean;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** An uploaded file, or null when the field is absent or empty. */
function file(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

/** A price field to a number, or null when blank/invalid (kept out of the yaml). */
function money(formData: FormData, name: string): number | null {
  const raw = field(formData, name);
  if (!raw) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Per-material rates, sent as a JSON array of `{ type, rate }` in a hidden field. */
function byType(formData: FormData): Record<string, number> {
  const raw = field(formData, "by_type");
  const out: Record<string, number> = {};
  if (!raw) {
    return out;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return out;
    }
    for (const row of parsed) {
      const type = typeof row?.type === "string" ? row.type.trim() : "";
      const rate = Number(row?.rate);
      if (type && Number.isFinite(rate) && rate >= 0) {
        out[type] = rate;
      }
    }
  } catch {
    return {};
  }
  return out;
}

/** The colours list, sent as a JSON array of `{ name, hex }` in a hidden field. */
function colors(formData: FormData): Array<{ name?: string; hex?: string }> {
  const raw = field(formData, "colors");
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        name: typeof c.name === "string" ? c.name : undefined,
        hex: typeof c.hex === "string" ? c.hex : undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * A supply's purchase history, sent as a JSON array in a hidden field — the
 * same trick `colors` uses, since a repeatable group of rows can't be a flat
 * set of form fields.
 */
function purchases(formData: FormData): PurchaseInput[] {
  const raw = field(formData, "purchases");
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const price = Number(row.package_price);
        const qty = Number(row.package_qty);
        return {
          date: typeof row.date === "string" ? row.date.trim() : undefined,
          url: typeof row.url === "string" ? row.url.trim() : undefined,
          notes: typeof row.notes === "string" ? row.notes.trim() : undefined,
          package_price:
            Number.isFinite(price) && price >= 0 ? price : null,
          package_qty: Number.isFinite(qty) && qty > 0 ? qty : null,
          // Anything but an explicit false counts, matching the reader.
          use_for_price: row.use_for_price !== false,
        };
      });
  } catch {
    return [];
  }
}

export async function saveFilamentAction(
  _prev: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  try {
    const savedId = await saveFilament({
      id: field(formData, "id"),
      name: field(formData, "name"),
      material: field(formData, "material"),
      brand: field(formData, "brand"),
      colors: colors(formData),
      price_per_kg: money(formData, "price_per_kg"),
      notes: field(formData, "notes"),
    });
    revalidatePath("/", "layout");
    return { error: null, success: true, savedId };
  } catch (error) {
    return { error: message(error, "Could not save the filament.") };
  }
}

/**
 * Save a supply, photo and all.
 *
 * The photo is named after the supply's id, and a *new* supply has no id until
 * `normaliseId` derives one from its name — which is why the image is written
 * here as part of the save rather than by an upload endpoint of its own. The
 * form says which of the three things it did through `image_action`, so
 * "left it alone" stays distinguishable from "cleared it".
 */
export async function saveSupplyAction(
  _prev: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const existingId = field(formData, "id");
  const previous = field(formData, "image_current");
  const action = field(formData, "image_action");
  let image = previous;
  let wrote = false;

  try {
    const upload = file(formData, "image");
    if (action === "replace" && upload) {
      // Throws on a blank name, which is the same thing `saveSupply` refuses.
      image = await saveSupplyImage(
        normaliseId(existingId || field(formData, "name")),
        upload,
      );
      wrote = true;
    } else if (action === "remove") {
      await deleteSupplyImage(previous);
      image = "";
    }

    const savedId = await saveSupply({
      id: existingId,
      name: field(formData, "name"),
      unit: field(formData, "unit"),
      purchases: purchases(formData),
      image,
      category: field(formData, "category"),
      description: field(formData, "description"),
    });
    revalidatePath("/", "layout");
    return { error: null, success: true, savedId };
  } catch (error) {
    // A brand-new supply that failed to save has no row pointing at the photo
    // just written, so take it back out rather than leave an orphan in the
    // catalog repo. An edit is left alone: its row still names that file.
    if (wrote && !existingId) {
      await deleteSupplyImage(image).catch(() => {});
    }
    return { error: message(error, "Could not save the supply.") };
  }
}

/**
 * Replace just a supply's purchase history, leaving everything else as it is.
 *
 * A supply's page edits one purchase at a time, and rebuilding the whole entity
 * out of hidden form fields to do that is how a photo or a description gets
 * quietly dropped by a form that never showed it. This reads the supply that is
 * already on disk and swaps only the list.
 */
export async function saveSupplyPurchasesAction(
  id: string,
  purchases: PurchaseInput[],
): Promise<InventoryState> {
  try {
    const supply = resolveSupply(id);
    if (!supply) {
      throw new InventoryError("That supply no longer exists.");
    }
    const savedId = await saveSupply({
      id: supply.id,
      name: supply.name,
      unit: supply.unit ?? undefined,
      category: supply.category ?? undefined,
      description: supply.description ?? undefined,
      image: supply.image ?? undefined,
      purchases,
    });
    revalidatePath("/", "layout");
    return { error: null, success: true, savedId };
  } catch (error) {
    return { error: message(error, "Could not save the purchase.") };
  }
}

export async function saveCostAction(
  _prev: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  try {
    await saveCost({
      currency: field(formData, "currency"),
      filament_per_kg: money(formData, "filament_per_kg"),
      filament_per_kg_by_type: byType(formData),
      failure_risk: {
        low: money(formData, "risk_low"),
        medium: money(formData, "risk_medium"),
        high: money(formData, "risk_high"),
      },
      printer_price: money(formData, "printer_price"),
      maintenance_cost: money(formData, "maintenance_cost"),
      lifespan_hours: money(formData, "lifespan_hours"),
      power_watts: money(formData, "power_watts"),
      electricity_per_kwh: money(formData, "electricity_per_kwh"),
      labor_per_hour: money(formData, "labor_per_hour"),
      shipping_cost: money(formData, "shipping_cost"),
      tax_percent: money(formData, "tax_percent"),
      markup_percent: money(formData, "markup_percent"),
    });
    revalidatePath("/", "layout");
    return { error: null, success: true };
  } catch (error) {
    return { error: message(error, "Could not save the cost settings.") };
  }
}

export async function deleteFilamentAction(id: string): Promise<InventoryState> {
  try {
    await deleteFilament(id);
    revalidatePath("/", "layout");
    return { error: null, success: true };
  } catch (error) {
    return { error: message(error, "Could not delete the filament.") };
  }
}

export async function deleteSupplyAction(id: string): Promise<InventoryState> {
  try {
    await deleteSupply(id);
    revalidatePath("/", "layout");
    return { error: null, success: true };
  } catch (error) {
    return { error: message(error, "Could not delete the supply.") };
  }
}

function message(error: unknown, fallback: string): string {
  if (error instanceof InventoryError) {
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}
