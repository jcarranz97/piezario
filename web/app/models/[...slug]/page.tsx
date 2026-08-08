import { Card, Chip } from "@heroui/react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { LuExternalLink } from "react-icons/lu";

import { LicenseBadge } from "@/components/common/license-badge";
import { Customizer } from "@/components/model/customizer";
import { FileTable } from "@/components/model/file-table";
import { ModelCostCard } from "@/components/model/model-cost-card";
import { ModelEditPanel } from "@/components/model/model-edit-panel";
import { Readme } from "@/components/model/readme";
import { getModels, modelsRoot } from "@/lib/catalog";
import { CustomizeError, type CustomizeSchema, customizeSchema } from "@/lib/customize";
import { failureRiskFactor, loadConfig } from "@/lib/config";
import { CAPABILITY_HINTS, CAPABILITY_LABELS } from "@/lib/files";
import { getSupplies, resolveSupply } from "@/lib/inventory";
import { resolveComponents } from "@/lib/kit-cost";
import {
  type ModelCostOption,
  candidateFilaments,
  estimateModelCost,
  resolveSupplies,
} from "@/lib/model-cost";
import { analyseThreeMf } from "@/lib/threemf";
import { fileUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

/**
 * One tree walk per request, shared by `generateMetadata` and the page.
 *
 * `getModel()` is `getModels().find()`, so the naive spelling walks the tree
 * three times before this page renders anything — and a kit needs the whole
 * index anyway, to resolve its components without walking once per part.
 * React's `cache` is per-request, so `lib/catalog.ts` stays uncached and
 * editing a README still shows up on the next refresh.
 */
const loadIndex = cache(async () => {
  const models = await getModels();
  return { models, index: new Map(models.map((m) => [m.slug, m])) };
});

/** `slug` arrives as decoded segments; rejoin to match Model.slug. */
async function resolveModel(params: Promise<{ slug: string[] }>) {
  const { slug } = await params;
  const { index } = await loadIndex();
  return index.get(slug.join("/")) ?? null;
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

  // What this model's `components:` lines cost and earn. Each component is
  // priced at its *own* preferred filament, never this model's, so the rollup
  // does not vary across the dropdown below — resolve it once, outside the loop.
  const { models, index } = await loadIndex();
  const config = loadConfig();
  const components = await resolveComponents(model, index, config);

  // The whole-model landed cost. The dropdown offers every filament whose
  // material is one of the model's — a PLA-only part lists the PLA spools, a
  // PLA/PETG part lists both. The 3MFs are read once above; each option reprices
  // the same slices at that spool's rate.
  const supplyLines = resolveSupplies(model.supplies, resolveSupply);
  const packagingLines = resolveSupplies(model.packaging, resolveSupply);
  const buildCost = (rate: number | null) =>
    estimateModelCost(model.files, threeMf.files, costConfig, {
      supplyLines,
      packagingLines,
      overridePerKg: rate,
      efficiency,
      laborMinutes,
      laborBasis: model.laborBasis,
      shipping,
      markupPercent,
      riskLevel: model.failureRisk ?? "medium",
      components,
      yieldUnits: model.yieldUnits,
      discountPercent: model.discountPercent,
    });

  const candidates = candidateFilaments(model.materials, config.filaments);

  const costOptions: ModelCostOption[] = [];
  for (const filament of candidates) {
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

  // The customiser, for a model whose README declares a generator script.
  // Building the form means importing that script in the model's own venv to
  // ask click what its options are — seconds the first time, then cached
  // against the script's mtime. A generator that cannot be inspected must not
  // take the page down with it, so the failure is shown in place of the form.
  let customize: CustomizeSchema | null = null;
  let customizeError: string | null = null;
  if (model.customize) {
    try {
      customize = await customizeSchema(model.slug, model.customize);
    } catch (error) {
      customizeError =
        error instanceof CustomizeError
          ? error.message
          : "This model's generator could not be inspected.";
    }
  }

  // Autocomplete suggestions: everything already used elsewhere in the catalog.
  const allTags = [...new Set(models.flatMap((item) => item.tags))].sort();
  const allMaterials = [
    ...new Set(models.flatMap((item) => item.materials)),
  ].sort();
  const allPrinters = [
    ...new Set(models.flatMap((item) => item.printers)),
  ].sort();
  const allSupplies = getSupplies();
  // Just enough of each model to fill the component picker. Passing `Model[]`
  // would ship every model's file list and README body to the browser.
  const allModels = models
    .filter((item) => item.slug !== model.slug)
    .map((item) => ({
      slug: item.slug,
      title: item.title,
      category: item.categories.join(" / "),
    }));

  return (
    <ModelEditPanel
      model={model}
      allTags={allTags}
      allMaterials={allMaterials}
      allPrinters={allPrinters}
      allSupplies={allSupplies}
      allModels={allModels}
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

            {customize && (
              <Customizer
                slug={model.slug}
                basic={customize.basic}
                advanced={customize.advanced}
              />
            )}
            {customizeError && (
              <Card variant="transparent" className="py-6 text-center">
                <Card.Content>
                  <p className="font-medium">Customiser unavailable</p>
                  <p className="mt-1 text-sm text-muted">{customizeError}</p>
                </Card.Content>
              </Card>
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
