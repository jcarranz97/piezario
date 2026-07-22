import type { Metadata } from "next";

import { IconBrowser } from "@/components/icons/icon-browser";
import { getIcons, iconsRoot } from "@/lib/icons";

// Same rule as the models and fonts pages: the folder is the source of truth
// and it changes while the server runs, so never cache a render.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Icons — 3D Catalog",
  description: "The SVG icons reused across the designs, browsable with previews.",
};

export default async function IconsPage() {
  const icons = await getIcons();

  if (icons.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold">No icons yet</h1>
        <p className="mt-3 text-muted">
          The catalog reads <code>{iconsRoot()}</code>. Drop a <code>.svg</code>{" "}
          in there — or a folder of them with a <code>README.md</code> — and it
          will show up on the next refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Icons</h1>
        <p className="mt-2 text-muted">
          {icons.length} {icons.length === 1 ? "icon" : "icons"} reused across
          the designs, read straight from the repository.
        </p>
      </div>

      <IconBrowser icons={icons} />
    </div>
  );
}
