"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { LuChevronDown, LuFolder, LuFolderOpen } from "react-icons/lu";

import type { TreeNode } from "@/lib/tree";

/**
 * The folder sidebar, shared by the Models and Fonts tabs.
 *
 * Draws a folder tree the way it sits on disk so nesting is obvious at a
 * glance. Clicking a folder filters the list to everything beneath it;
 * rendering the leaves is left to the caller, since a model links to its page
 * and a font jumps to its specimen.
 *
 * Styling follows the Claude Design mock: each nested level is wrapped in a
 * `Branch` that draws a **guide line** down its left edge, which is what makes
 * "gaming is inside decor" legible at a glance — indentation alone never did.
 */

/** One nesting level: the vertical guide line plus its indented children. */
function Branch({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-0.5 ml-3.5 flex flex-col gap-0.5 border-l border-[var(--card-border)] pl-1.5">
      {children}
    </ul>
  );
}

export function CategoryTree<T>({
  root,
  selected,
  onSelect,
  rootLabel,
  countLabel,
  renderItem,
}: {
  root: TreeNode<T>;
  selected: string[];
  onSelect: (path: string[]) => void;
  /** Label for the "everything" row, e.g. "All models". */
  rootLabel: string;
  /** Key for each rendered item, so React can track the leaves. */
  renderItem: (item: T) => React.ReactNode;
  countLabel?: (count: number) => string;
}) {
  // Start collapsed: the sidebar opens as a short list of top-level
  // categories, so the whole catalog is legible at a glance and you drill into
  // the one you want. Tracking what is *expanded* (rather than what is
  // collapsed) makes that the natural default — an empty set is everything shut.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  const selectedKey = selected.join("/");
  const headerCount =
    countLabel?.(root.children.length) ??
    `${root.children.length} ${root.children.length === 1 ? "category" : "categories"}`;

  return (
    <nav aria-label="Folders" className="text-sm">
      <div className="flex items-center justify-between px-2 pt-0.5 pb-3 text-[11px] font-bold tracking-[0.1em] text-[var(--faint)] uppercase">
        <span>Index</span>
        <span>{headerCount}</span>
      </div>

      <Row
        label={rootLabel}
        count={root.count}
        icon={<LuFolderOpen className="size-[17px] text-[var(--accent)]" />}
        isSelected={selectedKey === ""}
        onSelect={() => onSelect([])}
      />

      <Branch>
        {root.children.map((child) => (
          <TreeBranch
            key={child.key}
            node={child}
            expanded={expanded}
            toggle={toggle}
            selectedKey={selectedKey}
            onSelect={onSelect}
            renderItem={renderItem}
          />
        ))}
        {root.items.map((item, index) => (
          <li key={index}>{renderItem(item)}</li>
        ))}
      </Branch>
    </nav>
  );
}

function TreeBranch<T>({
  node,
  expanded,
  toggle,
  selectedKey,
  onSelect,
  renderItem,
}: {
  node: TreeNode<T>;
  expanded: Set<string>;
  toggle: (key: string) => void;
  selectedKey: string;
  onSelect: (path: string[]) => void;
  renderItem: (item: T) => React.ReactNode;
}) {
  const hasChildren = node.children.length > 0 || node.items.length > 0;
  const isOpen = hasChildren && expanded.has(node.key);

  return (
    <li>
      <Row
        label={node.name}
        count={node.count}
        icon={<LuFolder className="size-[17px] text-[var(--accent)]" />}
        isSelected={selectedKey === node.key}
        isOpen={isOpen}
        hasChildren={hasChildren}
        onToggle={() => toggle(node.key)}
        onSelect={() => onSelect(node.path)}
      />
      {isOpen && (
        <Branch>
          {node.children.map((child) => (
            <TreeBranch
              key={child.key}
              node={child}
              expanded={expanded}
              toggle={toggle}
              selectedKey={selectedKey}
              onSelect={onSelect}
              renderItem={renderItem}
            />
          ))}
          {node.items.map((item, index) => (
            <li key={index}>{renderItem(item)}</li>
          ))}
        </Branch>
      )}
    </li>
  );
}

function Row({
  label,
  count,
  icon,
  isSelected,
  isOpen,
  hasChildren,
  onToggle,
  onSelect,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  isSelected: boolean;
  isOpen?: boolean;
  hasChildren?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={clsx(
        "flex w-full items-center gap-2 rounded-[9px] px-2.5 py-[7px] transition-colors",
        isSelected
          ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
          : "hover:bg-[var(--accent-tint)]",
      )}
    >
      {/* Expanding and selecting are separate targets: collapsing a folder you
          are browsing should not also change what the list shows. A single
          chevron rotates rather than swapping icons, so the state change reads
          as motion instead of a substitution. */}
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={isOpen ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={isOpen}
          className="flex-none text-[var(--muted)] transition-transform duration-200 hover:text-[var(--foreground)]"
          style={{ transform: `rotate(${isOpen ? 0 : -90}deg)` }}
        >
          <LuChevronDown className="size-3.5" strokeWidth={2.4} />
        </button>
      ) : (
        <span className="w-3.5 flex-none" />
      )}

      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="flex flex-none">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span
          className={clsx(
            "ml-auto min-w-[22px] flex-none rounded-full px-2 py-px text-center text-xs font-semibold",
            isSelected
              ? "text-[var(--accent)]"
              : "bg-[var(--chip)] text-[var(--faint)]",
          )}
        >
          {count}
        </span>
      </button>
    </div>
  );
}

/**
 * A leaf row — one model or one font. Shared so both trees line up: the
 * spacer matches the width of a folder's chevron, keeping labels aligned.
 */
export function TreeLeaf({
  href,
  label,
  icon,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-[7px] text-[var(--foreground)] transition-colors hover:bg-[var(--accent-tint)]"
    >
      <span className="w-3.5 flex-none" />
      <span className="flex flex-none text-[var(--muted)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}
