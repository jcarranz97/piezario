"use client";

import { useId, useMemo, useState } from "react";

/**
 * A creatable, autocompleting **single-value** field — the one-value cousin of
 * `TagInput`. While empty it's a text box that suggests values already used
 * elsewhere (brands, types…) and offers to create what isn't listed. Once a
 * value is committed — picked from the list, created, Enter, or blur — it
 * collapses to a removable chip, so it's obvious the choice took. Clearing the
 * chip returns to the text box.
 *
 * The committed value (or the half-typed buffer, as a fallback so nothing is
 * lost on submit) is mirrored into a hidden field under `name`, so it submits
 * with the surrounding form like a plain text field. `onChange` reports that
 * value up so a parent can validate; `error` renders an inline message and a red
 * border, matching HeroUI's `FieldError`.
 */
export function ComboInput({
  name,
  label,
  hint,
  defaultValue = "",
  suggestions = [],
  placeholder,
  uppercase = false,
  required = false,
  error,
  onChange,
  onBlur,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  suggestions?: string[];
  placeholder?: string;
  /** Display the text uppercased (for material types like PLA/PETG). */
  uppercase?: boolean;
  /** Mark the field required: a `*` on the label. */
  required?: boolean;
  /** An inline error to show (red border + message). */
  error?: string;
  /** Reports the current value (committed chip, or half-typed text). */
  onChange?: (value: string) => void;
  /** Fires when the text box loses focus, for "touched" tracking. */
  onBlur?: () => void;
}) {
  const inputId = useId();
  const [selected, setSelected] = useState(defaultValue.trim());
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);

  const sorted = useMemo(
    () => [...new Set(suggestions.filter(Boolean))].sort(),
    [suggestions],
  );

  const query = input.trim().toLowerCase();
  const matches = sorted.filter((option) => option.toLowerCase().includes(query));
  const canCreate =
    query.length > 0 && !sorted.some((option) => option.toLowerCase() === query);

  function report(value: string) {
    onChange?.(value);
  }

  function commit(raw: string) {
    const text = raw.trim();
    if (!text) {
      return;
    }
    setSelected(text);
    setInput("");
    setOpen(false);
    report(text);
  }

  function clear() {
    setSelected("");
    setInput("");
    setOpen(true);
    report("");
  }

  const invalid = Boolean(error);
  const borderClass = invalid
    ? "border-red-500"
    : "border-[var(--card-border)]";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden className="text-[var(--accent-strong)]">
            {" "}
            *
          </span>
        )}
      </label>
      {/* Submit the committed value, or the half-typed buffer as a fallback. */}
      <input type="hidden" name={name} value={selected || input.trim()} />

      {selected ? (
        <div
          className={`flex min-h-[2.375rem] flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 ${borderClass}`}
        >
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-tint)] px-2 py-0.5 text-sm">
            <span className={uppercase ? "uppercase" : undefined}>{selected}</span>
            <button
              type="button"
              onClick={clear}
              aria-label={`Clear ${label.toLowerCase()}`}
              className="inline-flex items-center text-muted hover:text-[var(--foreground)]"
            >
              <span aria-hidden className="text-base leading-none">
                ×
              </span>
            </button>
          </span>
        </div>
      ) : (
        <div className="relative">
          <input
            id={inputId}
            value={input}
            autoComplete="off"
            onChange={(event) => {
              setInput(event.target.value);
              setOpen(true);
              report(event.target.value.trim());
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              // Commit on blur so leaving the field (or clicking Save) turns the
              // typed value into a chip rather than silently keeping it as text.
              if (input.trim()) {
                commit(input);
              }
              onBlur?.();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Accept what's typed; don't submit the surrounding form.
                event.preventDefault();
                commit(input);
              } else if (event.key === "Escape" && open) {
                // Close just the suggestions; don't let Escape bubble up and
                // close an enclosing modal on the first press.
                event.stopPropagation();
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)] ${borderClass} ${
              uppercase ? "uppercase" : ""
            }`}
          />

          {open && (matches.length > 0 || canCreate) && (
            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-[var(--card-border)] bg-[var(--card)] py-1 shadow-lg">
              {matches.map((option) => (
                <li key={option}>
                  {/* onMouseDown keeps the input from blurring before the click. */}
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commit(option)}
                    className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--accent-tint)] ${
                      uppercase ? "uppercase" : ""
                    }`}
                  >
                    {option}
                  </button>
                </li>
              ))}
              {canCreate && (
                <li>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commit(input)}
                    className="block w-full px-3 py-1.5 text-left text-sm font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-tint)]"
                  >
                    Create “{input.trim()}”
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {error ? (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : (
        hint && <span className="text-xs text-muted">{hint}</span>
      )}
    </div>
  );
}
