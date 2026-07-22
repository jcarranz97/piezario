import { Card, Chip } from "@heroui/react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LuExternalLink } from "react-icons/lu";

import { LicenseBadge } from "@/components/common/license-badge";
import { FileTable } from "@/components/model/file-table";
import { ModelCostCard } from "@/components/model/model-cost-card";
import { ModelEditPanel } from "@/components/model/model-edit-panel";
import { Readme } from "@/components/model/readme";
import { getModel, getModels, modelsRoot } from "@/lib/catalog";
import { failureRiskFactor, loadConfig } from "@/lib/config";
import { CAPABILITY_HINTS, CAPABILITY_LABELS } from "@/lib/files";
import { getFilaments, getSupplies, resolveSupply } from "@/lib/inventory";
import {
  type ModelCostOption,
  estimateModelCost,
  resolveSupplies,
} from "@/lib/model-cost";
import { analyseThreeMf } from "@/lib/threemf";
import { fileUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

/** `slug` arrives as decoded segments; rejoin to match Model.slug. */
async function resolveModel(params: Promise<{ slug: string[] }>) {
  const { slug } = await params;
  return getModel(slug.join("/"));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const model = await resolveModel(params);
  return { title: model ? `${model.title} — Piezario` : "Not found" };
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const model = await resolveModel(params);
  if (!model) {
    notFound();
  }

  const gallery = model.files.filter(
    (file) => file.kind === "image" && file.relPath !== model.cover,
  );

  const facts: Array<[string, React.ReactNode]> = [];
  if (model.status) facts.push(["Status", model.status]);
  if (model.date) facts.push(["Date", model.date]);
  /** A list field rendered as chips, with the label pluralised to match. */
  function chipFact(
    one: string,
    many: string,
    values: string[],
    opts?: { mono?: boolean },
  ) {
    if (values.length === 0) {
      return;
    }
    facts.push([
      values.length === 1 ? one : many,
      <span key={one} className="flex flex-wrap justify-end gap-1">
        {values.map((value) => (
          <Chip
            key={value}
            size="sm"
            variant="soft"
            className={opts?.mono ? "font-mono" : undefined}
          >
            {value}
          </Chip>
        ))}
      </span>,
    ]);
  }
  chipFact("Material", "Materials", model.materials);
  chipFact("Printer", "Printers", model.printers);
  // A slicer preset is an exact name to find in Bambu Studio, so render it
  // monospaced.
  chipFact("Print profile", "Print profiles", model.profiles, { mono: true });
  // A LICENSE file is stronger evidence than the frontmatter, so it wins the
  // row and the frontmatter value rides along as context.
  if (model.licenseFile) {
    facts.push([
      "License",
      <span key="license" className="flex items-center justify-end gap-2">
        {model.license && (
          <span className="text-muted">{model.license}</span>
        )}
        <LicenseBadge
          relPath={model.licenseFile.relPath}
          detected={model.licenseFile.detected}
        />
      </span>,
    ]);
  } else if (model.license) {
    facts.push(["License", model.license]);
  }
  if (model.source) {
    facts.push([
      "Source",
      <a
        key="source"
        href={model.source}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[var(--accent-strong)] underline"
      >
        Original <LuExternalLink className="size-3" />
      </a>,
    ]);
  }

  // The per-part landed-cost inputs, falling back to the global defaults.
  const costConfig = loadConfig().cost;
  const efficiency = failureRiskFactor(costConfig, model.failureRisk);
  const laborMinutes = model.laborMinutes ?? 0;
  const shipping = model.shippingCost ?? costConfig.shippingCost ?? 0;
  const markupPercent = model.markupPercent ?? costConfig.markupPercent;

  // Only the detail page pays for opening the 3MFs; the grid stays cheap.
  const threeMf = await analyseThreeMf(model.files, modelsRoot(), efficiency);

  // The whole-model landed cost. The dropdown offers every filament whose
  // material is one of the model's — a PLA-only part lists the PLA spools, a
  // PLA/PETG part lists both. The 3MFs are read once above; each option reprices
  // the same slices at that spool's rate.
  const supplyLines = resolveSupplies(model.supplies, resolveSupply);
  const packagingLines = resolveSupplies(model.packaging, resolveSupply);
  const buildCost = (rate: number | null) =>
    estimateModelCost(
      model.files,
      threeMf.files,
      costConfig,
      supplyLines,
      packagingLines,
      rate,
      efficiency,
      laborMinutes,
      shipping,
      markupPercent,
      model.failureRisk ?? "medium",
    );

  const materialSet = new Set(model.materials.map((m) => m.toLowerCase()));
  const candidateFilaments = getFilaments().filter(
    (f) => f.material && materialSet.has(f.material.toLowerCase()),
  );

  const costOptions: ModelCostOption[] = [];
  for (const filament of candidateFilaments) {
    const cost = buildCost(filament.pricePerKg);
    if (cost) {
      costOptions.push({
        key: filament.id,
        label: `${filament.name}${filament.material ? ` (${filament.material})` : ""}`,
        cost,
      });
    }
  }
  // Fall back to a type-based estimate when no filament matches the materials
  // (or the model lists none), so the card still appears.
  if (costOptions.length === 0) {
    const cost = buildCost(null);
    if (cost) {
      costOptions.push({ key: "default", label: "By material type", cost });
    }
  }

  // Autocomplete suggestions: everything already used elsewhere in the catalog.
  const models = await getModels();
  const allTags = [...new Set(models.flatMap((item) => item.tags))].sort();
  const allMaterials = [
    ...new Set(models.flatMap((item) => item.materials)),
  ].sort();
  const allPrinters = [
    ...new Set(models.flatMap((item) => item.printers)),
  ].sort();
  const allSupplies = getSupplies();

  return (
    <ModelEditPanel
      model={model}
      allTags={allTags}
      allMaterials={allMaterials}
      allPrinters={allPrinters}
      allSupplies={allSupplies}
    >
      <div className="flex flex-col gap-8">
        <div>
          {model.categories.length > 0 && (
            <p className="text-xs uppercase tracking-wide text-muted">
              {model.categories.join(" › ")}
            </p>
          )}
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {model.title}
          </h1>
          {model.description && (
            <p className="mt-2 max-w-2xl text-muted">{model.description}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-1">
            {model.capabilities.map((capability) => (
              <Chip
                key={capability}
                size="sm"
                variant="soft"
                title={CAPABILITY_HINTS[capability]}
              >
                {CAPABILITY_LABELS[capability]}
              </Chip>
            ))}
            {model.tags.map((tag) => (
              <Chip key={tag} size="sm" variant="tertiary">
                {tag}
              </Chip>
            ))}
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            {model.cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileUrl(model.cover)}
                alt={model.title}
                className="w-full rounded-2xl border border-[var(--card-border)] object-cover"
              />
            )}

            {model.hasReadme ? (
              <Readme body={model.body} slug={model.slug} />
            ) : (
              <Card variant="transparent" className="py-10 text-center">
                <Card.Content>
                  <p className="font-medium">No README yet</p>
                  <p className="mt-1 text-sm text-muted">
                    Add <code>models/{model.slug}/README.md</code> to describe
                    this model and give it tags.
                  </p>
                </Card.Content>
              </Card>
            )}

            {gallery.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {gallery.map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={image.relPath}
                    src={fileUrl(image.relPath)}
                    alt={image.name}
                    className="w-full rounded-xl border border-[var(--card-border)]"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {facts.length > 0 && (
              <Card>
                <Card.Content className="flex flex-col gap-2 text-sm">
                  {facts.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <span className="text-muted">{label}</span>
                      <span className="text-right font-medium">{value}</span>
                    </div>
                  ))}
                </Card.Content>
              </Card>
            )}
            {costOptions.length > 0 && (
              <ModelCostCard
                options={costOptions}
                slug={model.slug}
                preferredFilament={model.costFilament}
              />
            )}
            <FileTable files={model.files} threeMf={threeMf} />
          </div>
        </div>
      </div>
    </ModelEditPanel>
  );
}
