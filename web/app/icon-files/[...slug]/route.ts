import { iconsRoot } from "@/lib/icons";
import { serveFileFrom } from "@/lib/serve";

/** Serves anything inside `icons/`. See `lib/serve.ts` for the path guard. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  return serveFileFrom(iconsRoot(), slug, request);
}
