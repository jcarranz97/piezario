import { Card, Chip } from "@heroui/react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { money, perUnit } from "@/components/supplies/format";
import { PurchaseHistory } from "@/components/supplies/purchase-history";
import { SupplyEditor } from "@/components/supplies/supply-editor";
import { SupplyThumb } from "@/components/supplies/supply-thumb";
import { getModels } from "@/lib/catalog";
import { loadConfig } from "@/lib/config";
import { resolveSupply } from "@/lib/inventory";
import { modelUrl, supplyImageUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

/**
 * One supply's page.
 *
 * The card in the tab shows the latest purchase; this shows all of them, which
 * is the point — a price that came from four purchases over a year is a claim,
 * and this is where the claim is checked. It is also where a supply line in a
 * model's cost breakdown leads, so "why is this part $0.26?" is two clicks from
 * the receipt.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supply = resolveSupply(id);
  return { title: supply ? `${supply.name} — Piezario` : "Not found" };
}

export default async function SupplyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supply = resolveSupply(id);
  if (!supply) {
    notFound();
  }

  const { currency } = loadConfig().cost;
  const counted = supply.purchases.filter((p) => p.useForPrice);
  const spent = counted.reduce((sum, p) => sum + (p.packagePrice ?? 0), 0);
  const units = counted.reduce((sum, p) => sum + (p.packageQty ?? 0), 0);

  // Which parts this shows up in, and as what. A supply's page is the natural
  // place to ask "what does a price change here actually affect?".
  const models = await getModels();
  const usedBy = models
    .map((model) => ({
      model,
      supplies: model.supplies.filter(
        (line) => line.item.toLowerCase() === supply.id.toLowerCase(),
      ),
      packaging: model.packaging.filter(
        (line) => line.item.toLowerCase() === supply.id.toLowerCase(),
      ),
    }))
    .filter((row) => row.supplies.length > 0 || row.packaging.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start gap-6">
        {supply.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={supplyImageUrl(supply.image)}
            alt={supply.name}
            className="size-40 shrink-0 rounded-xl border border-[var(--card-border)] object-cover"
          />
        ) : (
          <SupplyThumb image={null} size={160} />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {supply.name}
            </h1>
            {supply.unit && (
              <Chip size="sm" variant="soft">
                {supply.unit}
              </Chip>
            )}
          </div>

          {supply.category && <p className="text-muted">{supply.category}</p>}

          <p className="text-2xl font-semibold">
            {perUnit(supply.price, currency)}
            <span className="text-base font-normal text-muted">
              {" "}
              / {supply.unit ?? "unit"}
            </span>
          </p>

          {counted.length > 1 && (
            <p className="text-sm text-muted">
              Weighted across {units} {supply.unit ?? "units"} from{" "}
              {counted.length} purchases — {money(spent, currency)} spent.
            </p>
          )}

          {supply.description && (
            <p className="max-w-prose text-sm whitespace-pre-line text-muted">
              {supply.description}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <SupplyEditor supply={supply} currency={currency} />
            <Link href="/supplies" className="text-muted underline">
              All supplies
            </Link>
          </div>
        </div>
      </div>

      <Card>
        <Card.Header>
          <Card.Title>Purchases</Card.Title>
        </Card.Header>
        <Card.Content>
          <PurchaseHistory supply={supply} currency={currency} />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Used by</Card.Title>
        </Card.Header>
        <Card.Content>
          {usedBy.length === 0 ? (
            <p className="text-sm text-muted">
              No model lists this yet. Add it under <code>supplies:</code> or{" "}
              <code>packaging:</code> in a model&apos;s README.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {usedBy.map(({ model, supplies, packaging }) => (
                <li
                  key={model.slug}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <Link
                    href={modelUrl(model.slug)}
                    className="text-[var(--accent-strong)] underline"
                  >
                    {model.title}
                  </Link>
                  <span className="text-xs text-muted">
                    {[
                      ...supplies.map(
                        (line) =>
                          `${line.qty} ${supply.unit ?? "unit"} as a supply`,
                      ),
                      ...packaging.map(
                        (line) =>
                          `${line.qty} ${supply.unit ?? "unit"} as packaging`,
                      ),
                    ].join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
