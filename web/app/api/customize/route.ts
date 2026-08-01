import { getModel } from "@/lib/catalog";
import { CustomizeError } from "@/lib/customize";
import { startJob } from "@/lib/customize-run";

/**
 * Start a generator run.
 *
 * The body is `{ slug, values }`. `values` is whatever the form collected; it
 * is checked against the schema read out of the script itself before any of it
 * reaches a command line — see `toArgv` in `lib/customize.ts`. The `customize:`
 * block comes from the model's own README rather than the request, so a
 * request cannot name a script to run.
 *
 * Returns the job immediately. Runs take tens of seconds, so the client polls
 * `/api/customize/<id>` from here.
 */
export async function POST(request: Request) {
  let body: { slug?: unknown; values?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug : "";
  const values =
    body.values && typeof body.values === "object" && !Array.isArray(body.values)
      ? (body.values as Record<string, unknown>)
      : {};
  if (!slug) {
    return Response.json({ error: "No model given." }, { status: 400 });
  }

  const model = await getModel(slug);
  if (!model) {
    return Response.json({ error: "No such model." }, { status: 404 });
  }
  if (!model.customize) {
    return Response.json(
      { error: "This model is not customisable." },
      { status: 400 },
    );
  }

  try {
    const job = await startJob(model.slug, model.customize, values);
    return Response.json(job);
  } catch (error) {
    // A CustomizeError is a message written for whoever filled the form
    // ("Size must be a number", "No such font in the catalog"); anything else
    // is a bug here and should not be echoed back.
    if (error instanceof CustomizeError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("customize: failed to start", error);
    return Response.json(
      { error: "Could not start the generator." },
      { status: 500 },
    );
  }
}
