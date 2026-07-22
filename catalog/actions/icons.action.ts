"use server";

import { revalidatePath } from "next/cache";

import { importOnlineIcon } from "@/lib/icons-import";
import { CatalogError } from "@/lib/model-path";

/**
 * Save one online (svgapi) icon into the icons tree.
 *
 * `folder` is the tree path currently selected in the browser — where the icon
 * should land. All the guarding lives in `importOnlineIcon`; this just turns a
 * thrown `CatalogError` into a message the UI can show and revalidates so the
 * freshly-written icon appears in the local grid.
 */

export interface SaveIconResult {
  relPath?: string;
  name?: string;
  error?: string;
}

export async function saveOnlineIconAction(
  url: string,
  folder: string[],
): Promise<SaveIconResult> {
  try {
    const { relPath, name } = await importOnlineIcon(url, folder);
    revalidatePath("/icons", "page");
    return { relPath, name };
  } catch (error) {
    if (error instanceof CatalogError) {
      return { error: error.message };
    }
    return {
      error: error instanceof Error ? error.message : "Could not save the icon.",
    };
  }
}
