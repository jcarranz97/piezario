"use client";

import { Button, Card, SearchField, Slider, TextArea } from "@heroui/react";
import { useMemo, useState } from "react";
import { LuDownload, LuType, LuX } from "react-icons/lu";

import { CategoryTree, TreeLeaf } from "@/components/catalog/category-tree";
import { LicenseBadge } from "@/components/common/license-badge";
// Type-only import: `lib/fonts.ts` touches node:fs, so importing any *value*
// from it here would pull the filesystem into the client bundle.
import type { Font } from "@/lib/fonts";
import { buildTree, isUnder } from "@/lib/tree";
import { fontUrl } from "@/lib/urls";

/** What the specimens read before you type anything of your own. */
const DEFAULT_TEXT = "Everyone has the right to freedom of thought";

const MIN_SIZE = 12;
const MAX_SIZE = 96;

/** Bytes → "141 KB". */
function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

/**
 * The font specimen browser.
 *
 * One control panel drives every row: whatever you type is rendered by all of
 * them at the same size, which is the only way to actually compare typefaces.
 * The `@font-face` rules were emitted by the page; here we just reference the
 * generated family names.
 */
export function FontBrowser({ fonts }: { fonts: Font[] }) {
  const [text, setText] = useState("");
  const [size, setSize] = useState(44);
  const [query, setQuery] = useState("");
  /** Selected folder as a path; empty means "everything". */
  const [categoryPath, setCategoryPath] = useState<string[]>([]);

  const tree = useMemo(
    () =>
      buildTree(
        fonts,
        (font) => font.categories,
        (font) => `${font.family} ${font.style}`,
      ),
    [fonts],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fonts.filter((font) => {
      // Prefix match, so selecting a folder also keeps its subfolders.
      if (!isUnder(font.categories, categoryPath)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        font.family.toLowerCase().includes(q) ||
        font.style.toLowerCase().includes(q) ||
        font.relPath.toLowerCase().includes(q)
      );
    });
  }, [fonts, query, categoryPath]);

  // An empty box shows the placeholder specimen rather than an empty row.
  const preview = text.trim() ? text : DEFAULT_TEXT;

  return (
    <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4">
        <div className="flex flex-col gap-5 rounded-[18px] border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-[0_1px_3px_rgba(0,0,0,.04)]">
          <TextArea
            aria-label="Preview text"
            placeholder="Type something"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
          />

          <Slider
            aria-label="Preview size"
            value={size}
            onChange={(value) => setSize(Number(value))}
            minValue={MIN_SIZE}
            maxValue={MAX_SIZE}
            step={1}
          >
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Size</span>
              <Slider.Output />
            </div>
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>

          <SearchField
            aria-label="Search fonts"
            value={query}
            onChange={setQuery}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search fonts…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>
              {filtered.length} of {fonts.length}{" "}
              {fonts.length === 1 ? "font" : "fonts"}
            </span>
            {categoryPath.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => setCategoryPath([])}
                aria-label="Clear folder filter"
              >
                {categoryPath.join(" / ")}
                <LuX className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-[18px] border border-[var(--card-border)] bg-[var(--card)] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,.04)]">
          <CategoryTree
            root={tree}
            selected={categoryPath}
            onSelect={setCategoryPath}
            rootLabel="All fonts"
            // Once single-font folders are flattened away there is often no
            // folder left at all, and "0 folders" reads like a bug.
            countLabel={(count) =>
              count === 0
                ? `${fonts.length} ${fonts.length === 1 ? "font" : "fonts"}`
                : `${count} ${count === 1 ? "folder" : "folders"}`
            }
            renderItem={(font) => (
              <TreeLeaf
                key={font.relPath}
                href={`#font-${font.id}`}
                label={`${font.family} ${font.style}`}
                icon={<LuType className="size-[15px]" strokeWidth={1.7} />}
              />
            )}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        {filtered.length === 0 ? (
          <Card variant="transparent" className="py-16 text-center">
            <Card.Content>
              <LuType className="mx-auto size-8 text-muted" />
              <p className="mt-3 font-medium">No fonts match those filters</p>
            </Card.Content>
          </Card>
        ) : (
          filtered.map((font) => (
            <Card
              key={font.relPath}
              id={`font-${font.id}`}
              className="scroll-mt-24 overflow-hidden"
            >
              <Card.Content className="flex flex-col gap-4 py-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">{font.family}</span>
                  <span className="text-sm text-muted">{font.style}</span>
                  <span className="text-xs text-[var(--faint)]">
                    {font.relPath} · {formatSize(font.size)}
                  </span>
                  {font.licenseFile && (
                    <span className="text-muted">
                      <LicenseBadge
                        relPath={font.licenseFile.relPath}
                        detected={font.licenseFile.detected}
                        root="fonts"
                      />
                    </span>
                  )}
                  <a
                    href={fontUrl(font.relPath, { download: true })}
                    className="ml-auto flex items-center gap-1 text-sm text-muted hover:text-[var(--accent-strong)]"
                    aria-label={`Download ${font.file}`}
                  >
                    <LuDownload className="size-4" />
                  </a>
                </div>

                {/* The specimen. `break-words` keeps a long unbroken string
                    from pushing the card wider than the grid column. */}
                <p
                  className="leading-tight break-words"
                  style={{
                    fontFamily: `"${font.id}", sans-serif`,
                    fontSize: `${size}px`,
                  }}
                >
                  {preview}
                </p>
              </Card.Content>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
