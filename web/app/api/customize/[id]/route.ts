import { getJob } from "@/lib/customize-run";

/** Poll one run: status, log tail, and the files it has produced. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return Response.json({ error: "No such job." }, { status: 404 });
  }
  return Response.json(job);
}
