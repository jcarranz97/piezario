"use client";

import { Button } from "@heroui/react";
import Link from "next/link";
import { useState } from "react";
import { LuArrowLeft, LuPencil } from "react-icons/lu";

import type { Model } from "@/lib/catalog";
import type { SupplyItem } from "@/lib/inventory";

import { ModelEditor } from "./model-editor";
import { OpenFolderButton } from "./open-folder-button";

/**
 * Switches a model's detail page between reading and editing.
 *
 * The read view is passed in as `children` so it stays server-rendered — the
 * markdown, the file table and the gallery never enter the client bundle just
 * because the page happens to have an Edit button on it.
 */
export function ModelEditPanel({
  model,
  allTags,
  allMaterials,
  allPrinters,
  allSupplies,
  children,
}: {
  model: Model;
  allTags: string[];
  allMaterials: string[];
  allPrinters: string[];
  allSupplies: SupplyItem[];
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ModelEditor
        model={model}
        allTags={allTags}
        allMaterials={allMaterials}
        allPrinters={allPrinters}
        allSupplies={allSupplies}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-[var(--foreground)]"
        >
          <LuArrowLeft className="size-4" /> Catalog
        </Link>
        <div className="flex items-start gap-2">
          <OpenFolderButton slug={model.slug} />
          <Button size="sm" variant="secondary" onPress={() => setEditing(true)}>
            <LuPencil className="size-3.5" />
            Edit
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
