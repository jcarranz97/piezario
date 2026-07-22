import { modelsRoot } from "@/lib/catalog";
import { serveFileFrom } from "@/lib/serve";

/** Serves anything inside `models/`. See `lib/serve.ts` for the path guard. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  return serveFileFrom(modelsRoot(), slug, request);
}
