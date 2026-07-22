import type { Metadata } from "next";

import { SuppliesBrowser } from "@/components/supplies/supplies-browser";
import { loadConfig } from "@/lib/config";
import { getSupplies } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Supplies — 3D Catalog",
  description:
    "Non-printed consumables — rings, chains, glue — priced per unit for your parts.",
};

export default async function SuppliesPage() {
  const supplies = getSupplies();
  const { currency } = loadConfig().cost;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Supplies</h1>
        <p className="mt-2 text-muted">
          {supplies.length} {supplies.length === 1 ? "supply" : "supplies"} in
          your inventory. List them on a model and their cost rolls into its
          total.
        </p>
      </div>

      <SuppliesBrowser supplies={supplies} currency={currency} />
    </div>
  );
}
