"use client";

import {
  Button,
  Chip,
  EmptyState,
  type Key,
  ListBox,
  SearchField,
  Select,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { useMemo, useState } from "react";
import { LuBox, LuSearchX, LuX } from "react-icons/lu";

import type { Model } from "@/lib/catalog";
import {
  CAPABILITY_HINTS,
  CAPABILITY_LABELS,
  type Capability,
} from "@/lib/files";
import { buildTree, isUnder } from "@/lib/tree";
import { modelUrl } from "@/lib/urls";

import { CategoryTree, TreeLeaf } from "./category-tree";
import { ModelCard } from "./model-card";

const ALL = "all";
const CAPABILITIES: Capability[] = ["printable", "parametric", "editable"];

/**
 * The catalog grid, its filters and the folder sidebar.
 *
 * Every model is already in memory (the server read the whole tree), so
 * filtering is pure client-side work — no refetch, no loading state.
 */
export function CatalogBrowser({ models }: { models: Model[] }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string>(ALL);
  const [capabilities, setCapabilities] = useState<Set<Key>>(new Set());
  /** Selected folder as a path; empty means "everything". */
  const [categoryPath, setCategoryPath] = useState<string[]>([]);

  const tree = useMemo(
    () =>
      buildTree(
        models,
        (model) => model.categories,
        (model) => model.title,
      ),
    [models],
  );
  const tags = useMemo(
    () => [...new Set(models.flatMap((model) => model.tags))].sort(),
    [models],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((model) => {
      // Prefix match, so selecting "decor" also keeps "decor/gaming".
      if (!isUnder(model.categories, categoryPath)) {
        return false;
      }
      if (tag !== ALL && !model.tags.includes(tag)) {
        return false;
      }
      // Capability toggles are ANDed: picking "printable" + "parametric" means
      // "models I can both regenerate and print", which is the useful reading.
      for (const capability of capabilities) {
        if (!model.capabilities.includes(capability as Capability)) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      return (
        model.title.toLowerCase().includes(q) ||
        model.description.toLowerCase().includes(q) ||
        model.slug.toLowerCase().includes(q) ||
        model.tags.some((item) => item.includes(q)) ||
        model.materials.some((item) => item.toLowerCase().includes(q)) ||
        model.printers.some((item) => item.toLowerCase().includes(q)) ||
        model.files.some((file) => file.name.toLowerCase().includes(q))
      );
    });
  }, [models, query, tag, capabilities, categoryPath]);

  return (
    <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      {/* Sidebar first in the DOM: it leads on desktop and, on narrow screens
          where the grid collapses to one column, it stays above the cards
          instead of stranding the folder list below a long scroll. */}
      <aside>
        <div className="rounded-[18px] border border-[var(--card-border)] bg-[var(--card)] p-3.5 shadow-[0_1px_3px_rgba(0,0,0,.04)] lg:sticky lg:top-20">
          <CategoryTree
            root={tree}
            selected={categoryPath}
            onSelect={setCategoryPath}
            rootLabel="All models"
            renderItem={(model) => (
              <TreeLeaf
                key={model.slug}
                href={modelUrl(model.slug)}
                label={model.title}
                icon={<LuBox className="size-[15px]" strokeWidth={1.7} />}
              />
            )}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="w-full sm:max-w-xs">
              <SearchField
                aria-label="Search models"
                value={query}
                onChange={setQuery}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Search name, tag or file…" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            </div>

            {tags.length > 0 && (
              <div className="w-full sm:w-48">
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
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ToggleButtonGroup
              size="sm"
              isDetached
              selectionMode="multiple"
              selectedKeys={capabilities}
              onSelectionChange={setCapabilities}
              aria-label="Filter by what the model comes with"
            >
              {CAPABILITIES.map((capability) => (
                <ToggleButton
                  key={capability}
                  id={capability}
                  aria-label={CAPABILITY_HINTS[capability]}
                >
                  {CAPABILITY_LABELS[capability]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

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

            <Chip size="sm" variant="soft">
              {filtered.length} of {models.length}
            </Chip>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState className="py-16 text-center">
            <LuSearchX className="mx-auto size-8 text-muted" />
            <p className="mt-3 font-medium">No models match those filters</p>
            <p className="text-sm text-muted">
              Try clearing the search, the folder or the capability toggles.
            </p>
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((model) => (
              <ModelCard
                key={model.slug}
                model={model}
                onSelectCategory={setCategoryPath}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
