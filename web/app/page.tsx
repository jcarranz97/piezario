import { CatalogBrowser } from "@/components/catalog/catalog-browser";
import { getModels, modelsRoot } from "@/lib/catalog";

// The models tree is the source of truth and it changes under us while the
// server is running, so never cache a render.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const models = await getModels();

  if (models.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold">No models yet</h1>
        <p className="mt-3 text-muted">
          The catalog reads <code>{modelsRoot()}</code>. Create a folder in
          there with a <code>README.md</code> and it will show up on the next
          refresh.
        </p>
      </div>
    );
  }

  const categories = new Set(models.flatMap((model) => model.categories[0] ?? []));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Catalog</h1>
        <p className="mt-2 text-muted">
          {models.length} {models.length === 1 ? "model" : "models"} across{" "}
          {categories.size}{" "}
          {categories.size === 1 ? "category" : "categories"}, read straight
          from the repository.
        </p>
      </div>
      <CatalogBrowser models={models} />
    </div>
  );
}
