import { jobDir } from "@/lib/customize-run";
import { serveFileFrom } from "@/lib/serve";

/**
 * Serve one file a run produced — the STL the preview loads, and the 3MF to
 * download.
 *
 * Generated output lives outside `models/`, so it cannot go through the
 * `/files` route. `jobDir` derives the folder from the id alone (16 hex
 * characters, so it cannot climb anywhere), and `serveFileFrom` applies the
 * same containment check every other file route uses.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const dir = jobDir(id);
  if (!dir) {
    return new Response("Not found", { status: 404 });
  }
  return serveFileFrom(dir, [name], request);
}
