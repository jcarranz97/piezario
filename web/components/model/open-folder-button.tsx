"use client";

import { Button } from "@heroui/react";
import { useState, useTransition } from "react";
import { LuFolderOpen } from "react-icons/lu";

import { openFolderAction } from "@/actions/model.action";

/**
 * Opens the model's folder in the desktop file manager.
 *
 * The work happens server-side (a browser can't launch a file manager), which
 * means it only lands somewhere useful when the catalog and the browser are on
 * the same machine — the normal case for a localhost tool. When it fails, the
 * absolute path is shown instead so it can at least be copied.
 */
export function OpenFolderButton({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onPress() {
    setError(null);
    startTransition(async () => {
      const result = await openFolderAction(slug);
      if (result.error) {
        setError(`${result.error}${result.path ? ` — ${result.path}` : ""}`);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onPress={onPress}
        isPending={pending}
        aria-label="Open this model's folder in the file manager"
      >
        <LuFolderOpen className="size-3.5" />
        Open folder
      </Button>
      {error && (
        <p className="max-w-xs text-right text-xs text-[var(--accent-strong)]">
          {error}
        </p>
      )}
    </div>
  );
}
