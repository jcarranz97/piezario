"use client";

import { Chip } from "@heroui/react";
import { useId, useMemo, useState } from "react";
import { LuX } from "react-icons/lu";

/** Split raw input on commas into trimmed, non-empty tag tokens. */
function tokenize(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * A creatable, autocompleting tag input. Selected tags render as removable
 * chips; typing suggests tags already used elsewhere in the catalog and offers
 * to create new ones. The selection is mirrored into a hidden comma-separated
 * field so it submits with the surrounding form.
 *
 * Adapted from the printforhelp frontend's `forms/tag-input.tsx`.
 */
export function TagInput({
  name,
  label,
  defaultTags = [],
  suggestions = [],
}: {
  name: string;
  label: string;
  defaultTags?: string[];
  suggestions?: string[];
}) {
  const inputId = useId();
  const [selected, setSelected] = useState<string[]>(defaultTags);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => [...suggestions].sort(), [suggestions]);

  function addTokens(raw: string) {
    const parts = tokenize(raw);
    if (parts.length === 0) {
      return;
    }
    setSelected((current) => {
      const next = [...current];
      for (const part of parts) {
        if (!next.some((tag) => tag.toLowerCase() === part.toLowerCase())) {
          next.push(part);
        }
      }
      return next;
    });
    setInput("");
  }

  function removeTag(tag: string) {
    setSelected((current) => current.filter((item) => item !== tag));
  }

  const query = input.trim().toLowerCase();
  const matches = sorted.filter(
    (tag) =>
      !selected.some((item) => item.toLowerCase() === tag.toLowerCase()) &&
      tag.toLowerCase().includes(query),
  );
  const canCreate =
    query.length > 0 &&
    !selected.some((item) => item.toLowerCase() === query) &&
    !suggestions.some((tag) => tag.toLowerCase() === query);
  // Include a half-typed token so it saves even without pressing Enter.
  const pending = tokenize(input).filter(
    (part) => !selected.some((item) => item.toLowerCase() === part.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <input type="hidden" name={name} value={[...selected, ...pending].join(",")} />
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--card-border)] px-2 py-1.5">
          {selected.map((tag) => (
            <Chip key={tag} variant="soft" size="sm">
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove ${tag}`}
                className="ml-1 inline-flex items-center text-muted hover:text-[var(--foreground)]"
              >
                <LuX aria-hidden className="size-3" />
              </button>
            </Chip>
          ))}
          <input
            id={inputId}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                // Enter adds a tag; it must not submit the surrounding form.
                event.preventDefault();
                addTokens(input);
              } else if (event.key === "Escape") {
                setOpen(false);
              } else if (
                event.key === "Backspace" &&
                input === "" &&
                selected.length > 0
              ) {
                removeTag(selected[selected.length - 1]);
              }
            }}
            placeholder="Add a tag…"
            className="min-w-28 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        {open && (matches.length > 0 || canCreate) && (
          <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-[var(--card-border)] bg-[var(--card)] py-1 shadow-lg">
            {matches.map((tag) => (
              <li key={tag}>
                {/* onMouseDown keeps the input from blurring before the click. */}
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addTokens(tag)}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--accent-tint)]"
                >
                  {tag}
                </button>
              </li>
            ))}
            {canCreate && (
              <li>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addTokens(input)}
                  className="block w-full px-3 py-1.5 text-left text-sm font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-tint)]"
                >
                  Create “{input.trim()}”
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
