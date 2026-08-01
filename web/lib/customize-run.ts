import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import type { CustomizeSpec } from "./customize-spec";
import {
  CustomizeError,
  type CustomizeSchema,
  customizeSchema,
  generatedRoot,
  generatorPython,
  modelDir,
  paramsHash,
  toArgv,
} from "./customize";

/**
 * Running a generator, and keeping track of the run.
 *
 * These scripts take tens of seconds — half a minute per half on the lip balm
 * holder, longer with an SVG motif — so a customiser cannot be a
 * request/response. A run is started, given an id, and polled. That is the
 * same shape a hosted backend needs, so the UI written against it does not
 * change when the runner moves behind a queue.
 *
 * The registry is a module-level Map, which is honest about what this is: a
 * single-process desktop app. Restart the server and running jobs are lost —
 * but their *output* is not, because the id is a hash of the parameters and
 * finished work is found back on disk. That is the part worth keeping.
 */

export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobFile {
  name: string;
  size: number;
}

export interface Job {
  id: string;
  slug: string;
  status: JobStatus;
  /** Interleaved stdout/stderr, as the script prints it. */
  log: string[];
  files: JobFile[];
  error: string | null;
  /** Wall-clock milliseconds, once finished. */
  elapsedMs: number | null;
  /** True when the parameters had been generated before and nothing ran. */
  cached: boolean;
}

interface JobRecord extends Job {
  startedAt: number;
  dir: string;
}

const jobs = new Map<string, JobRecord>();

/**
 * One generator at a time. OpenCascade is single-threaded and CPU-bound, and
 * two runs at once make both slower rather than either faster. It also keeps a
 * customer clicking Generate repeatedly from spawning a fleet.
 */
let running: Promise<void> = Promise.resolve();

/** How long a single run may take before it is killed. */
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Output file stem. The folder is the identity; the filename need not be. */
const STEM = "custom";

function publicJob(record: JobRecord): Job {
  const { startedAt: _startedAt, dir: _dir, ...job } = record;
  return job;
}

export function getJob(id: string): Job | null {
  const record = jobs.get(id);
  return record ? publicJob(record) : null;
}

/** Files a finished run left behind, newest formats first. */
async function readOutput(dir: string): Promise<JobFile[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: JobFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
    if (stat) {
      files.push({ name: entry.name, size: stat.size });
    }
  }
  // The 3MF is both the file to print and the one the preview reads, so it
  // leads; anything else follows in name order.
  const rank = (name: string) =>
    name.endsWith(".3mf") ? 0 : name.endsWith(".stl") ? 1 : 2;
  return files.sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
  );
}

/**
 * Where a job's files live. Exported so the download route can find them
 * without trusting anything but the id — the id is a hex hash, so a path
 * built from it cannot climb out of the generated root.
 */
export function jobDir(id: string): string | null {
  // Derived from the id rather than looked up, so a job that finished before
  // the last restart is still downloadable. The id is 16 hex characters by
  // construction; anything else is not one and gets no path at all.
  if (!/^[0-9a-f]{16}$/.test(id)) {
    return null;
  }
  return path.join(generatedRoot(), id);
}

/**
 * Start a run, or hand back a finished one.
 *
 * The id is a hash of the model and the exact `argv`, so asking for the same
 * part twice is free: the second request finds the folder already populated
 * and returns without spawning anything. That is what makes flipping between
 * "1 cup" and "3/4 cup" in the form feel instant on the way back.
 */
export async function startJob(
  slug: string,
  spec: CustomizeSpec,
  values: Record<string, unknown>,
): Promise<Job> {
  const schema: CustomizeSchema = await customizeSchema(slug, spec);
  const argv = await toArgv(schema, values);
  const id = paramsHash(slug, argv);

  const existing = jobs.get(id);
  if (existing && existing.status !== "error") {
    return publicJob(existing);
  }

  const dir = path.join(generatedRoot(), id);
  const alreadyThere = await readOutput(dir);
  if (alreadyThere.length > 0) {
    const record: JobRecord = {
      id,
      slug,
      status: "done",
      log: [],
      files: alreadyThere,
      error: null,
      elapsedMs: 0,
      cached: true,
      startedAt: Date.now(),
      dir,
    };
    jobs.set(id, record);
    return publicJob(record);
  }

  const record: JobRecord = {
    id,
    slug,
    status: "queued",
    log: [],
    files: [],
    error: null,
    elapsedMs: null,
    cached: false,
    startedAt: Date.now(),
    dir,
  };
  jobs.set(id, record);

  // Chain onto whatever is already running rather than starting now. The
  // caller gets the id immediately either way and polls for the rest.
  running = running.then(() => execute(record, spec, argv));

  return publicJob(record);
}

async function execute(
  record: JobRecord,
  spec: CustomizeSpec,
  argv: string[],
): Promise<void> {
  const dir = modelDir(record.slug);
  let python: string;
  try {
    python = generatorPython(dir);
    await fs.mkdir(record.dir, { recursive: true });
  } catch (error) {
    record.status = "error";
    record.error =
      error instanceof CustomizeError ? error.message : "Could not start the generator.";
    return;
  }

  const args = [
    path.join(dir, spec.script),
    ...argv,
    "--outdir",
    record.dir,
    "--name",
    STEM,
  ];
  record.status = "running";
  record.startedAt = Date.now();

  await new Promise<void>((resolve) => {
    // cwd is the model folder: generators import helpers sitting next to them
    // (`bambu3mf`), which are not importable from anywhere else.
    const child = spawn(python, args, { cwd: dir });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      record.error = `The generator ran for over ${RUN_TIMEOUT_MS / 60000} minutes and was stopped.`;
    }, RUN_TIMEOUT_MS);

    /** Keep the tail, not the whole stream — some of these are chatty. */
    const append = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) {
          record.log.push(line);
        }
      }
      if (record.log.length > 400) {
        record.log.splice(0, record.log.length - 400);
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    child.on("error", (error) => {
      clearTimeout(timer);
      record.status = "error";
      record.error = error.message;
      resolve();
    });

    child.on("close", async (code) => {
      clearTimeout(timer);
      record.elapsedMs = Date.now() - record.startedAt;
      record.files = await readOutput(record.dir);

      if (code === 0 && record.files.length > 0) {
        record.status = "done";
      } else {
        record.status = "error";
        // A generator that refuses says exactly why and what to do about it
        // ("--bore 24 leaves only 0.4 mm of wall … cap it at 22.4"). That last
        // line is worth far more to whoever is filling the form than a exit
        // code, so it becomes the error.
        record.error =
          record.error ??
          record.log.filter((line) => line.trim()).pop() ??
          `The generator exited with code ${code}.`;
      }
      resolve();
    });
  });
}
