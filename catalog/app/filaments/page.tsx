import type { Metadata } from "next";

import { FilamentsBrowser } from "@/components/filaments/filaments-browser";
import { loadConfig } from "@/lib/config";
import { getFilaments } from "@/lib/inventory";

// Read from catalog.yaml on every request, like the rest of the catalog: a
// spool added in the UI (or by hand) shows up on the next refresh.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Filaments — 3D Catalog",
  description: "Your filament spools, and the prices that cost your prints.",
};

export default async function FilamentsPage() {
  const filaments = getFilaments();
  const { currency } = loadConfig().cost;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Filaments</h1>
        <p className="mt-2 text-muted">
          {filaments.length} {filaments.length === 1 ? "spool" : "spools"} in
          your inventory. Pin one on a model to price its print by that spool.
        </p>
      </div>

      <FilamentsBrowser filaments={filaments} currency={currency} />
    </div>
  );
}
