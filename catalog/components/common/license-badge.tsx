"use client";

import { useState, useTransition } from "react";
import { LuScale } from "react-icons/lu";

import { openFileAction } from "@/actions/model.action";

/**
 * GitHub's scales-of-justice licence link, for a model or a font.
 *
 * Shows the detected licence name when we recognise the text and a plain
 * "License" otherwise — an unrecognised licence still deserves to be visible.
 * Clicking opens the file in an editor, the same way every other file in the
 * catalog opens.
 */
export function LicenseBadge({
  relPath,
  detected,
  root = "models",
}: {
  relPath: string;
  detected: string | null;
  /** Which tree the path is relative to. */
  root?: "models" | "fonts" | "icons";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await openFileAction(relPath, root);
      if (result.error) {
        setError(result.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={pending}
      title={error ?? `Open ${relPath}`}
      className="inline-flex items-center gap-1 text-sm hover:text-[var(--accent-strong)] disabled:opacity-60"
    >
      <LuScale className="size-3.5 shrink-0" />
      <span>{detected ?? "License"}</span>
    </button>
  );
}
