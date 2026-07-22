"use client";

import {
  Button,
  Checkbox,
  Chip,
  ListBox,
  SearchField,
  Select,
  Slider,
  Spinner,
} from "@heroui/react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  LuCheck,
  LuDownload,
  LuExternalLink,
  LuGlobe,
  LuShapes,
  LuTriangleAlert,
  LuX,
} from "react-icons/lu";

import { saveOnlineIconAction } from "@/actions/icons.action";
import { CategoryTree, TreeLeaf } from "@/components/catalog/category-tree";
import { LicenseBadge } from "@/components/common/license-badge";
// Type-only import: `lib/icons.ts` touches node:fs, so importing any *value*
// from it here would pull the filesystem into the client bundle.
import type { Icon, IconGroupMeta } from "@/lib/icons";
import { buildTree, isUnder } from "@/lib/tree";
import { iconUrl } from "@/lib/urls";

const ALL = "all";
const MIN_SIZE = 48;
const MAX_SIZE = 160;

/** The tile background — icons ship with fixed fills, so both extremes matter. */
type Backdrop = "card" | "light" | "dark";
const BACKDROPS: { id: Backdrop; label: string; className: string }[] = [
  { id: "card", label: "Auto", className: "bg-[var(--card)]" },
  { id: "light", label: "Light", className: "bg-white" },
  { id: "dark", label: "Dark", className: "bg-neutral-900" },
];

/** Bytes → "3 KB". SVGs are tiny, so kilobytes are the useful unit. */
function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

/** One result from the svgapi proxy — mirrors that route's response shape. */
interface OnlineIcon {
  id: string;
  title: string;
  url: string;
}

interface OnlineState {
  icons: OnlineIcon[];
  count: number;
  nextStart: number | null;
  status: "idle" | "loading" | "more" | "error";
  error: string | null;
}

const EMPTY_ONLINE: OnlineState = {
  icons: [],
  count: 0,
  nextStart: null,
  status: "idle",
  error: null,
};

/**
 * The icon browser.
 *
 * Every icon is already in memory (the server read the whole tree), so the
 * folder filter, tag filter and search are pure client-side work. Selecting a
 * folder that carries a README surfaces its description and tags above the
 * grid — that is the "details, like a model" part, shown once for the folder
 * rather than repeated on every tile.
 */
export function IconBrowser({ icons }: { icons: Icon[] }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string>(ALL);
  const [size, setSize] = useState(96);
  const [backdrop, setBackdrop] = useState<Backdrop>("card");
  /** Selected folder as a path; empty means "everything". */
  const [categoryPath, setCategoryPath] = useState<string[]>([]);
  /** Whether to also search svgapi.com's 200k+ public-domain icon library. */
  const [online, setOnline] = useState(false);
  const [remote, setRemote] = useState<OnlineState>(EMPTY_ONLINE);
  /** Per-online-icon save state, keyed by svgapi id. */
  const [saves, setSaves] = useState<
    Record<string, "saving" | "done" | "error">
  >({});

  const router = useRouter();
  const [, startSave] = useTransition();

  /** Human label for where a saved icon lands, from the selected folder. */
  const destLabel =
    categoryPath.length > 0 ? `icons/${categoryPath.join("/")}` : "icons/";

  // Changing the destination folder means a previously-saved icon can be saved
  // again somewhere new, so clear the ticks.
  useEffect(() => {
    setSaves({});
  }, [categoryPath]);

  const saveOnline = useCallback(
    (icon: OnlineIcon) => {
      setSaves((current) => ({ ...current, [icon.id]: "saving" }));
      startSave(async () => {
        const result = await saveOnlineIconAction(icon.url, categoryPath);
        if (result.error) {
          setSaves((current) => ({ ...current, [icon.id]: "error" }));
          return;
        }
        setSaves((current) => ({ ...current, [icon.id]: "done" }));
        // Pull the freshly-written icon into the local grid without a reload.
        router.refresh();
      });
    },
    [categoryPath, router],
  );

  // One in-flight request at a time: a fast typist fires several, and without
  // this an earlier, slower response could land after a newer one and overwrite
  // it. The controller also cancels the previous fetch outright.
  const requestRef = useRef<AbortController | null>(null);

  const runOnlineSearch = useCallback(
    async (term: string, start: number) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      const append = start > 0;
      if (!append) {
        // A fresh search is a new result set — old "saved" ticks don't apply.
        setSaves({});
      }
      setRemote((current) => ({
        ...(append ? current : EMPTY_ONLINE),
        status: append ? "more" : "loading",
        error: null,
      }));

      try {
        const response = await fetch(
          `/api/icons/search?term=${encodeURIComponent(term)}&start=${start}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (controller.signal.aborted) {
          return;
        }
        if (!response.ok) {
          setRemote((current) => ({
            ...current,
            status: "error",
            error: data.error ?? "Online search failed.",
          }));
          return;
        }
        setRemote((current) => ({
          icons: append ? [...current.icons, ...data.icons] : data.icons,
          count: data.count,
          nextStart: data.nextStart,
          status: "idle",
          error: null,
        }));
      } catch (error) {
        // An abort is the expected outcome of the next keystroke — not an error.
        if ((error as Error).name === "AbortError") {
          return;
        }
        setRemote((current) => ({
          ...current,
          status: "error",
          error: "Could not reach the icon service.",
        }));
      }
    },
    [],
  );

  // Debounce the online search so a burst of keystrokes makes one request, not
  // one per letter. Runs only while the toggle is on and there's a term.
  useEffect(() => {
    if (!online) {
      requestRef.current?.abort();
      setRemote(EMPTY_ONLINE);
      return;
    }
    const term = query.trim();
    if (!term) {
      setRemote(EMPTY_ONLINE);
      return;
    }
    const timer = setTimeout(() => runOnlineSearch(term, 0), 400);
    return () => clearTimeout(timer);
  }, [online, query, runOnlineSearch]);

  const tree = useMemo(
    () => buildTree(icons, (icon) => icon.categories, (icon) => icon.name),
    [icons],
  );

  const tags = useMemo(
    () => [...new Set(icons.flatMap((icon) => icon.group?.tags ?? []))].sort(),
    [icons],
  );

  // The README metadata for the currently-selected folder, if it has one. Every
  // icon in a folder carries the same `group`, so the first match is enough.
  const selectedGroup: IconGroupMeta | null = useMemo(() => {
    if (categoryPath.length === 0) {
      return null;
    }
    const key = categoryPath.join("/");
    return (
      icons.find((icon) => icon.group?.path === key)?.group ?? null
    );
  }, [icons, categoryPath]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return icons.filter((icon) => {
      // Prefix match, so selecting "social" also keeps "social/brands".
      if (!isUnder(icon.categories, categoryPath)) {
        return false;
      }
      if (tag !== ALL && !(icon.group?.tags ?? []).includes(tag)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        icon.name.toLowerCase().includes(q) ||
        icon.relPath.toLowerCase().includes(q) ||
        (icon.group?.tags ?? []).some((item) => item.includes(q)) ||
        (icon.group?.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [icons, query, tag, categoryPath]);

  const backdropClass =
    BACKDROPS.find((option) => option.id === backdrop)?.className ??
    "bg-[var(--card)]";

  return (
    <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4">
        <div className="flex flex-col gap-5 rounded-[18px] border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-[0_1px_3px_rgba(0,0,0,.04)]">
          <SearchField
            aria-label="Search icons"
            value={query}
            onChange={setQuery}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search name, tag or path…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          {tags.length > 0 && (
            <Select
              aria-label="Filter by tag"
              selectedKey={tag}
              onSelectionChange={(key) => setTag(String(key ?? ALL))}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={ALL} textValue="All tags">
                    All tags
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {tags.map((item) => (
                    <ListBox.Item key={item} id={item} textValue={item}>
                      {item}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          )}

          <Slider
            aria-label="Icon size"
            value={size}
            onChange={(value) => setSize(Number(value))}
            minValue={MIN_SIZE}
            maxValue={MAX_SIZE}
            step={8}
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

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">Preview on</span>
            <div className="flex gap-1 rounded-[10px] bg-[var(--chip)] p-1">
              {BACKDROPS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setBackdrop(option.id)}
                  className={clsx(
                    "flex-1 rounded-[7px] px-2 py-1 text-xs font-medium transition-colors",
                    backdrop === option.id
                      ? "bg-[var(--card)] text-[var(--foreground)] shadow-[0_1px_2px_rgba(0,0,0,.08)]"
                      : "text-muted hover:text-[var(--foreground)]",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* The Control (the box) lives INSIDE the Content: Content is the
              clickable button, and the root is flex-col, so a sibling Control
              would stack above the label and sit outside the click target. */}
          <Checkbox isSelected={online} onChange={setOnline}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <span className="flex items-center gap-1.5 text-sm">
                <LuGlobe className="size-4" strokeWidth={1.7} />
                Search online
              </span>
            </Checkbox.Content>
          </Checkbox>

          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>
              {filtered.length} of {icons.length}{" "}
              {icons.length === 1 ? "icon" : "icons"}
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
            rootLabel="All icons"
            countLabel={(count) =>
              count === 0
                ? `${icons.length} ${icons.length === 1 ? "icon" : "icons"}`
                : `${count} ${count === 1 ? "folder" : "folders"}`
            }
            renderItem={(icon) => (
              <TreeLeaf
                key={icon.relPath}
                href={`#icon-${icon.id}`}
                label={icon.name}
                icon={<LuShapes className="size-[15px]" strokeWidth={1.7} />}
              />
            )}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        {/* The "details, like a model" banner: a selected folder's README. */}
        {selectedGroup &&
          (selectedGroup.description ||
            selectedGroup.tags.length > 0 ||
            selectedGroup.source) && (
            <div className="flex flex-col gap-3 rounded-[18px] border border-[var(--card-border)] bg-[var(--card)] p-5 shadow-[0_1px_3px_rgba(0,0,0,.04)]">
              <h2 className="font-semibold tracking-tight">
                {categoryPath.join(" / ")}
              </h2>
              {selectedGroup.description && (
                <p className="text-sm text-muted">{selectedGroup.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {selectedGroup.tags.map((item) => (
                  <Chip key={item} size="sm" variant="tertiary">
                    {item}
                  </Chip>
                ))}
                {selectedGroup.source && (
                  <a
                    href={selectedGroup.source}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-muted hover:text-[var(--accent-strong)]"
                  >
                    Source ↗
                  </a>
                )}
              </div>
            </div>
          )}

        {filtered.length === 0 ? (
          <div className="rounded-[18px] border border-[var(--card-border)] bg-[var(--card)] py-16 text-center">
            <LuShapes className="mx-auto size-8 text-muted" />
            <p className="mt-3 font-medium">No icons match those filters</p>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${size + 40}px, 1fr))`,
            }}
          >
            {filtered.map((icon) => (
              <figure
                key={icon.relPath}
                id={`icon-${icon.id}`}
                className="group flex scroll-mt-24 flex-col overflow-hidden rounded-[14px] border border-[var(--card-border)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.04)]"
              >
                <div
                  className={clsx(
                    "flex items-center justify-center p-4",
                    backdropClass,
                  )}
                  style={{ height: `${size + 24}px` }}
                >
                  {/* An <img> keeps the icon inert — no untrusted SVG script
                      runs, unlike an inline dangerouslySetInnerHTML. */}
                  <img
                    src={iconUrl(icon.relPath)}
                    alt={icon.name}
                    loading="lazy"
                    className="max-h-full max-w-full object-contain"
                    style={{ width: `${size}px`, height: `${size}px` }}
                  />
                </div>
                <figcaption className="flex items-center gap-2 border-t border-[var(--card-border)] px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm" title={icon.relPath}>
                    {icon.name}
                  </span>
                  <span className="flex-none text-xs text-[var(--faint)]">
                    {formatSize(icon.size)}
                  </span>
                  <a
                    href={iconUrl(icon.relPath, { download: true })}
                    className="flex-none text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--accent-strong)]"
                    aria-label={`Download ${icon.file}`}
                  >
                    <LuDownload className="size-4" />
                  </a>
                </figcaption>
                {icon.licenseFile && (
                  <div className="border-t border-[var(--card-border)] px-3 py-1.5 text-muted">
                    <LicenseBadge
                      relPath={icon.licenseFile.relPath}
                      detected={icon.licenseFile.detected}
                      root="icons"
                    />
                  </div>
                )}
              </figure>
            ))}
          </div>
        )}

        {online && (
          <section className="flex flex-col gap-4 border-t border-[var(--card-border)] pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <LuGlobe className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="font-semibold tracking-tight">From svgapi.com</h2>
              {remote.count > 0 && (
                <Chip size="sm" variant="soft">
                  {remote.count} found
                </Chip>
              )}
              {(remote.status === "loading" || remote.status === "more") && (
                <Spinner size="sm" />
              )}
              <span className="ml-auto text-xs text-[var(--faint)]">
                Public-domain &amp; CC0 — click opens on their CDN, save into{" "}
                <code>{destLabel}</code>
              </span>
            </div>

            {!query.trim() ? (
              <p className="text-sm text-muted">
                Type a search term to browse 200k+ icons online.
              </p>
            ) : remote.status === "error" ? (
              <p className="text-sm text-[var(--danger,#dc2626)]">
                {remote.error}
              </p>
            ) : remote.icons.length === 0 && remote.status === "idle" ? (
              <p className="text-sm text-muted">
                No online icons match “{query.trim()}”.
              </p>
            ) : (
              <>
                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(${size + 40}px, 1fr))`,
                  }}
                >
                  {remote.icons.map((icon) => {
                    const state = saves[icon.id];
                    return (
                      <figure
                        key={icon.id}
                        className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--card-border)] bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,.04)]"
                      >
                        <a
                          href={icon.url}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open ${icon.title} on svgapi's CDN`}
                          className={clsx(
                            "flex items-center justify-center p-4",
                            backdropClass,
                          )}
                          style={{ height: `${size + 24}px` }}
                        >
                          <img
                            src={icon.url}
                            alt={icon.title}
                            loading="lazy"
                            className="max-h-full max-w-full object-contain"
                            style={{ width: `${size}px`, height: `${size}px` }}
                          />
                        </a>
                        <figcaption className="flex items-center gap-2 border-t border-[var(--card-border)] px-3 py-2">
                          <span
                            className="min-w-0 flex-1 truncate text-sm"
                            title={icon.title}
                          >
                            {icon.title}
                          </span>
                          <a
                            href={icon.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-none text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--accent-strong)]"
                            aria-label={`Open ${icon.title} on svgapi's CDN`}
                          >
                            <LuExternalLink className="size-4" />
                          </a>
                          <button
                            type="button"
                            onClick={() => saveOnline(icon)}
                            disabled={state === "saving" || state === "done"}
                            title={
                              state === "done"
                                ? `Saved into ${destLabel}`
                                : state === "error"
                                  ? "Save failed — click to retry"
                                  : `Save into ${destLabel}`
                            }
                            aria-label={`Save ${icon.title} into ${destLabel}`}
                            className={clsx(
                              "flex-none transition-colors disabled:opacity-100",
                              state === "done"
                                ? "text-[var(--accent)]"
                                : state === "error"
                                  ? "text-[var(--danger,#dc2626)]"
                                  : "text-muted hover:text-[var(--accent-strong)]",
                            )}
                          >
                            {state === "saving" ? (
                              <Spinner size="sm" />
                            ) : state === "done" ? (
                              <LuCheck className="size-4" />
                            ) : state === "error" ? (
                              <LuTriangleAlert className="size-4" />
                            ) : (
                              <LuDownload className="size-4" />
                            )}
                          </button>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>

                {remote.nextStart !== null && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={remote.status === "more"}
                      onPress={() =>
                        runOnlineSearch(query.trim(), remote.nextStart ?? 0)
                      }
                    >
                      {remote.status === "more" ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
