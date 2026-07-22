import { spawn } from "node:child_process";

import { CatalogError, resolveModelDir } from "./model-path";

/**
 * Opening a model's folder in the desktop file manager.
 *
 * A browser cannot do this — `file://` links from an http page are blocked —
 * so the server launches the platform's opener instead. That only makes sense
 * because this is a localhost tool: the file manager appears on the machine
 * running `npm run dev`, which is the same machine you are sitting at.
 *
 * The command is spawned with an **argument array and no shell**. Combined
 * with `resolveModelDir`, which refuses anything outside the models root, a
 * crafted slug can neither escape the catalog nor smuggle in shell syntax.
 */

function opener(): string {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
}

/** Opens the folder and returns its absolute path. */
export async function openModelFolder(slug: string): Promise<string> {
  const dir = await resolveModelDir(slug);
  const command = opener();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [dir], { detached: true, stdio: "ignore" });
    // "spawn" fires once the process is actually running; "error" catches the
    // common case of the opener not being installed (ENOENT).
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", () =>
      reject(
        new CatalogError(
          `Could not run "${command}". Is a desktop file manager available on the machine running the catalog?`,
        ),
      ),
    );
  });

  return dir;
}
