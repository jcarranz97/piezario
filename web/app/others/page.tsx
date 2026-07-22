import type { Metadata } from "next";

import { OthersBrowser } from "@/components/others/others-browser";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Others — Piezario",
  description: "Cost settings: spool price, machine rate, tax and markup.",
};

export default async function OthersPage() {
  const { cost } = loadConfig();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Others</h1>
        <p className="mt-2 text-muted">
          The cost settings the estimate can&apos;t infer — your spool price,
          machine rate, tax and markup. Editing them reprices every model.
        </p>
      </div>

      <OthersBrowser cost={cost} />
    </div>
  );
}
