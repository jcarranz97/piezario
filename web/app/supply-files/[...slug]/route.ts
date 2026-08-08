import { suppliesRoot } from "@/lib/inventory";
import { serveFileFrom } from "@/lib/serve";

/** Serves supply photos. See `lib/serve.ts` for the path guard. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  return serveFileFrom(suppliesRoot(), slug, request);
}
