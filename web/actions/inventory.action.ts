"use server";

import { revalidatePath } from "next/cache";

import {
  InventoryError,
  deleteFilament,
  deleteSupply,
  saveCost,
  saveFilament,
  saveSupply,
} from "@/lib/inventory-write";

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

export async function saveSupplyAction(
  _prev: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  try {
    const savedId = await saveSupply({
      id: field(formData, "id"),
      name: field(formData, "name"),
      unit: field(formData, "unit"),
      price: money(formData, "price"),
      category: field(formData, "category"),
      notes: field(formData, "notes"),
    });
    revalidatePath("/", "layout");
    return { error: null, success: true, savedId };
  } catch (error) {
    return { error: message(error, "Could not save the supply.") };
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
