import path from "node:path";
import { spawn } from "node:child_process";

import {
  CatalogError,
  type CatalogRoot,
  resolveCatalogFile,
  resolveModelDir,
} from "./model-path";

/**
 * Launching things on the desktop: a model's folder, or an individual file.
 *
 * A browser cannot do either — `file://` links from an http page are blocked —
 * so the server launches them instead. That only makes sense because this is a
 * localhost tool: the window appears on the machine running `npm run dev`,
 * which is the machine you are sitting at.
 *
 * Commands are always spawned with an **argument array and no shell**.
 * Combined with the path guards in `model-path.ts`, a crafted path can neither
 * escape the catalog nor smuggle in shell syntax.
 */

/** The desktop's "open this with whatever is associated" command. */
function platformOpener(): string {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
}

/**
 * Files you'd rather edit than launch.
 *
 * A `.3mf` should open in the slicer that owns it, so it goes to the desktop's
 * file association. A `.py` opened that way might *run* — or open in a viewer
 * you don't want — so code and prose go to an editor first.
 */
const TEXT_EXTENSIONS = new Set([
  ".py",
  ".md",
  ".txt",
  ".sh",
  ".scad",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".ts",
  ".csv",
]);

/**
 * Which commands to try, best first.
 *
 * Every extension can be pinned with an env var — `CATALOG_OPEN_3MF=bambu-studio`,
 * `CATALOG_OPEN_STL=prusa-slicer` — and the editor for text files is
 * `CATALOG_EDITOR` (default `code`). Anything not pinned falls through to the
 * desktop's own file association, which is usually already correct.
 */
function candidatesFor(target: string): string[] {
  const ext = path.extname(target).toLowerCase();
  const pinned = process.env[`CATALOG_OPEN_${ext.slice(1).toUpperCase()}`];
  const editor = process.env.CATALOG_EDITOR ?? "code";

  const candidates = [pinned];
  if (TEXT_EXTENSIONS.has(ext)) {
    candidates.push(editor);
  }
  candidates.push(platformOpener());
  return candidates.filter((entry): entry is string => Boolean(entry));
}

/**
 * Spawn detached. Resolves `false` when the command simply isn't installed,
 * so the caller can fall through to the next candidate; other failures throw.
 */
function spawnDetached(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve(false);
      } else {
        reject(error);
      }
    });
  });
}

async function launch(target: string, candidates: string[]): Promise<string> {
  for (const command of candidates) {
    if (await spawnDetached(command, [target])) {
      return command;
    }
  }
  throw new CatalogError(
    `None of these are installed: ${candidates.join(", ")}. Set CATALOG_EDITOR or CATALOG_OPEN_<EXT> to pick an application.`,
  );
}

/** Opens a model's folder in the file manager. Returns the path opened. */
export async function openModelFolder(slug: string): Promise<string> {
  const dir = await resolveModelDir(slug);
  await launch(dir, [platformOpener()]);
  return dir;
}

/** Opens one file in its application. Returns the command that took it. */
export async function openCatalogFile(
  relPath: string,
  root: CatalogRoot = "models",
): Promise<{ path: string; command: string }> {
  const file = await resolveCatalogFile(relPath, root);
  const command = await launch(file, candidatesFor(file));
  return { path: file, command };
}
