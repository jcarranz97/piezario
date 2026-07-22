import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import type { ModelSupply } from "./catalog";
import { resolveModelDir } from "./model-path";

/**
 * Writing a model's README back to disk.
 *
 * This is the only code in the project that mutates the catalog, so it is
 * deliberately narrow: it writes exactly one file, `README.md`, inside exactly
 * one model folder, and it refuses anything that resolves outside the models
 * root. The markdown body is passed through untouched — it is hand-written
 * prose and must survive a metadata edit unchanged.
 */

/** Frontmatter keys this app manages. Anything else in the file is preserved. */
export interface ModelFrontmatter {
  title?: string;
  description?: string;
  tags?: string[];
  status?: string;
  date?: string;
  materials?: string[];
  /**
   * The pre-list spelling. The editor always sends this empty so the merge
   * deletes it, migrating a file from `material: PLA` to `materials: [...]`
   * on the first save instead of leaving both keys behind.
   */
  material?: string;
  printers?: string[];
  /** The pre-list spelling; sent empty to retire it. See `material` above. */
  printer?: string;
  source?: string;
  license?: string;
  cover?: string;
  /**
   * Retired keys — the model no longer pins filaments (the `materials:` list
   * drives the cost card instead). The editor always sends these empty so a
   * save cleans them out of any README that still carries them.
   */
  filaments?: string[];
  filament?: string;
  filament_color?: string;
  /** Supply lines. An empty array clears the key; objects pass through as-is. */
  supplies?: ModelSupply[];
  /** Failure-risk level (low/medium/high). Sent empty to clear it. */
  failure_risk?: string;
  /** Pre-rename per-part factor; the editor sends it empty to retire it. */
  efficiency_factor?: number | "";
  /** Prep/clean/package minutes for this part. */
  labor_minutes?: number | "";
  /** Packaging consumables (bag, box…) from the supplies catalog. */
  packaging?: ModelSupply[];
  /** Per-part shipping fee (overrides the global default). */
  shipping_cost?: number | "";
  /** Per-part profit markup % (overrides the global default). */
  markup_percent?: number | "";
  /** Pre-split flat packaging+shipping fee; sent empty to retire it. */
  packaging_cost?: number | "";
  /** Preferred filament id for the cost card. Sent empty to clear it. */
  cost_filament?: string;
}

/** Is a frontmatter value "empty" (so the merge should delete its key)? */
function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** README.md, matched case-insensitively so an existing readme.md is reused. */
async function findReadme(dir: string): Promise<string> {
  const entries = await fs.readdir(dir).catch(() => []);
  const existing = entries.find((name) => name.toLowerCase() === "readme.md");
  return path.join(dir, existing ?? "README.md");
}

/**
 * Merge new frontmatter into the model's README and save it.
 *
 * Keys set to an empty value are **removed** rather than written blank, so
 * clearing a field in the UI restores the derived fallback (title from the
 * folder name, description from the first paragraph). Keys the app doesn't
 * know about are left exactly as they were.
 */
export async function saveModelReadme(
  slug: string,
  updates: ModelFrontmatter,
  body: string,
): Promise<void> {
  const dir = await resolveModelDir(slug);
  const readmePath = await findReadme(dir);

  // Start from whatever is on disk so unknown keys survive the round trip.
  const existing = await fs.readFile(readmePath, "utf8").catch(() => "");
  const parsed = matter(existing);
  const data: Record<string, unknown> = { ...parsed.data };

  for (const [key, value] of Object.entries(updates)) {
    if (isEmptyValue(value)) {
      delete data[key];
    } else {
      data[key] = typeof value === "string" ? value.trim() : value;
    }
  }

  await writeReadme(readmePath, data, body);
}

/**
 * Update only some frontmatter keys, keeping the markdown body as it is on disk.
 *
 * `saveModelReadme` rewrites the whole file (body included), which suits the full
 * edit form. This is for a targeted change — e.g. the cost card saving the
 * preferred filament — where the body must not be touched.
 */
export async function updateModelFrontmatter(
  slug: string,
  updates: ModelFrontmatter,
): Promise<void> {
  const dir = await resolveModelDir(slug);
  const readmePath = await findReadme(dir);

  const existing = await fs.readFile(readmePath, "utf8").catch(() => "");
  const parsed = matter(existing);
  const data: Record<string, unknown> = { ...parsed.data };

  for (const [key, value] of Object.entries(updates)) {
    if (isEmptyValue(value)) {
      delete data[key];
    } else {
      data[key] = typeof value === "string" ? value.trim() : value;
    }
  }

  await writeReadme(readmePath, data, parsed.content);
}

/** Serialise frontmatter + body back to the README, avoiding an empty fence. */
async function writeReadme(
  readmePath: string,
  data: Record<string, unknown>,
  body: string,
): Promise<void> {
  const trimmed = body.trim();
  // gray-matter emits a bare `---\n---` block for empty data; skip the
  // frontmatter entirely in that case rather than leaving an empty fence.
  // The leading newline keeps the conventional blank line between the closing
  // `---` and the first heading, which gray-matter otherwise omits.
  const output =
    Object.keys(data).length > 0
      ? matter.stringify(trimmed ? `\n${trimmed}\n` : "", data)
      : trimmed
        ? `${trimmed}\n`
        : "";

  await fs.writeFile(readmePath, output, "utf8");
}
