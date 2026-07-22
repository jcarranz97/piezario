"use client";

import clsx from "clsx";
import { useState } from "react";

import { Readme } from "./readme";

/**
 * A GitHub-style Markdown editor with Write/Preview tabs.
 *
 * Preview reuses the very same `Readme` component the detail page renders with,
 * so what you see while editing is exactly what you get after saving —
 * including the relative-image rewriting, which is why it needs the slug.
 *
 * The text lives in a real `<textarea name=…>`, so it submits with the form
 * whichever tab happens to be showing.
 */
export function MarkdownEditor({
  name,
  slug,
  defaultValue = "",
  rows = 18,
}: {
  name: string;
  slug: string;
  defaultValue?: string;
  rows?: number;
}) {
  const [text, setText] = useState(defaultValue);
  const [tab, setTab] = useState<"write" | "preview">("write");

  const tabClass = (active: boolean) =>
    clsx(
      "-mb-px border-b-2 px-3 py-1.5 text-sm font-medium",
      active
        ? "border-[var(--accent)] text-[var(--foreground)]"
        : "border-transparent text-muted hover:text-[var(--foreground)]",
    );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center border-b border-[var(--card-border)]">
        <button
          type="button"
          className={tabClass(tab === "write")}
          onClick={() => setTab("write")}
        >
          Write
        </button>
        <button
          type="button"
          className={tabClass(tab === "preview")}
          onClick={() => setTab("preview")}
        >
          Preview
        </button>
        <span className="ml-auto pr-1 text-xs text-muted">
          Markdown supported
        </span>
      </div>

      {/* The textarea stays mounted and is merely hidden while previewing, so
          the caret position and undo history survive tab switches. */}
      <textarea
        name={name}
        rows={rows}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="README content"
        placeholder="# Model name&#10;&#10;What it is, how to print it, what the parameters do…"
        className={clsx(
          "w-full resize-y rounded-lg border border-[var(--card-border)] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)]",
          tab === "preview" && "hidden",
        )}
      />

      {tab === "preview" && (
        <div className="min-h-40 rounded-lg border border-[var(--card-border)] px-4 py-3">
          {text.trim() ? (
            <Readme body={text} slug={slug} />
          ) : (
            <p className="text-sm text-muted">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
