import { fontsRoot } from "@/lib/fonts";
import { serveFileFrom } from "@/lib/serve";

/** Serves anything inside `fonts/`. See `lib/serve.ts` for the path guard. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  return serveFileFrom(fontsRoot(), slug, request);
}
