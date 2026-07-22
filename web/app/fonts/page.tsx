import type { Metadata } from "next";

import { FontBrowser } from "@/components/fonts/font-browser";
import { fontFaceCss, fontsRoot, getFonts } from "@/lib/fonts";

// Same rule as the models pages: the folder is the source of truth and it
// changes while the server runs, so never cache a render.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fonts — Piezario",
  description: "The fonts available to the model generators, with live previews.",
};

export default async function FontsPage() {
  const fonts = await getFonts();

  if (fonts.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold">No fonts yet</h1>
        <p className="mt-3 text-muted">
          The catalog reads <code>{fontsRoot()}</code>. Drop a{" "}
          <code>.ttf</code>, <code>.otf</code>, <code>.woff</code> or{" "}
          <code>.woff2</code> in there and it will show up on the next refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* The set of fonts isn't known at build time — it's whatever is in the
          folder right now — so the @font-face rules are generated per request
          rather than going through next/font. */}
      <style>{fontFaceCss(fonts)}</style>

      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Fonts</h1>
        <p className="mt-2 text-muted">
          {fonts.length} {fonts.length === 1 ? "font" : "fonts"} available to
          the generators, read straight from the repository.
        </p>
      </div>

      <FontBrowser fonts={fonts} />
    </div>
  );
}
