import { NextResponse } from "next/server";

/**
 * A thin proxy in front of svgapi.com's icon search.
 *
 * The Icons tab is otherwise entirely prop-driven — the server reads `icons/`
 * off disk and hands the whole list to the browser, no client fetching. Online
 * search is the one exception, because that data genuinely isn't on disk: it
 * lives behind svgapi's REST API. The request goes through here rather than
 * straight from the browser for two reasons:
 *
 *  - the **API key stays on the server**. svgapi puts the key in the URL path,
 *    so calling it from the client would print the key into every browser's
 *    network tab; here it never leaves the machine running the catalog.
 *  - **no CORS dance** — a same-origin `/api/...` call just works.
 *
 * The key comes from `SVGAPI_KEY`. Absent that, we fall back to svgapi's own
 * public demo key so the feature works out of the box on a personal machine —
 * it is shared and rate-limited, so set your own (free tier at svgapi.com) for
 * anything real.
 */

// svgapi's publicly-listed demo key (shown in their docs' sample response).
// Shared and throttled — a convenience default, not something to rely on.
const DEMO_KEY = "Ty5WcDa63E";

const PAGE_SIZE = 20;

export const dynamic = "force-dynamic";

interface UpstreamIcon {
  id: string;
  slug: string;
  title: string;
  url: string;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const term = (params.get("term") ?? "").trim();
  const start = Math.max(0, Number(params.get("start")) || 0);

  if (!term) {
    return NextResponse.json(
      { term: "", count: 0, start: 0, icons: [], nextStart: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const key = process.env.SVGAPI_KEY?.trim() || DEMO_KEY;
  const upstream = new URL(`https://api.svgapi.com/v1/${key}/list/`);
  upstream.searchParams.set("search", term);
  upstream.searchParams.set("limit", String(PAGE_SIZE));
  upstream.searchParams.set("start", String(start));

  let data: {
    count?: number;
    icons?: UpstreamIcon[];
    next?: string;
  };
  try {
    const response = await fetch(upstream, {
      // Their CDN is fast; a ceiling keeps a hung upstream from hanging the tab.
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `svgapi returned ${response.status}.` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    data = await response.json();
  } catch {
    return NextResponse.json(
      { error: "Could not reach svgapi. Check your connection or SVGAPI_KEY." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const icons = (data.icons ?? []).map((icon) => ({
    id: icon.id,
    title: icon.title || icon.slug || "Icon",
    url: icon.url,
  }));
  // svgapi echoes a `next` URL while more pages remain; translate it back into
  // the start offset our client asks for.
  const nextStart = data.next ? start + PAGE_SIZE : null;

  return NextResponse.json(
    {
      term,
      count: data.count ?? icons.length,
      start,
      icons,
      nextStart,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
