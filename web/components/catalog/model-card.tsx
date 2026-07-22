"use client";

import { Card, Chip } from "@heroui/react";
import Link from "next/link";
import { LuBox } from "react-icons/lu";

import type { Model } from "@/lib/catalog";
import { CAPABILITY_LABELS } from "@/lib/files";
import { fileUrl, modelUrl } from "@/lib/urls";

/** Distinct file extensions, uppercased — "STL · PY · FCSTD". */
function extensionSummary(model: Model): string {
  const exts = new Set<string>();
  for (const file of model.files) {
    const dot = file.name.lastIndexOf(".");
    if (dot > 0) {
      exts.add(file.name.slice(dot + 1).toUpperCase());
    }
  }
  return [...exts].sort().join(" · ");
}

export function ModelCard({
  model,
  onSelectCategory,
}: {
  model: Model;
  onSelectCategory: (path: string[]) => void;
}) {
  return (
    // The whole card is a link, but the breadcrumb inside it is a row of
    // buttons — and a link cannot legally contain one. So the link is a
    // transparent overlay pinned over the card, and the breadcrumb is lifted
    // above it with z-10. Clicks land where they look like they should.
    <Card className="relative h-full overflow-hidden transition-shadow hover:shadow-md">
      <Link
        href={modelUrl(model.slug)}
        aria-label={`Open ${model.title}`}
        className="absolute inset-0 rounded-2xl"
      />

      {model.cover ? (
        // Local files served by the /files route; next/image would want the
        // path allow-listed for no benefit on a localhost-only tool.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fileUrl(model.cover)}
          alt={model.title}
          className="h-44 w-full object-cover"
        />
      ) : (
        <div className="build-plate flex h-44 w-full items-center justify-center">
          <LuBox className="size-10 text-[var(--card-border)]" />
        </div>
      )}

      <Card.Header>
        {model.categories.length > 0 && (
          <div className="relative z-10 flex flex-wrap items-center gap-x-1 text-xs uppercase tracking-wide text-muted">
            {model.categories.map((segment, index) => (
              <span key={segment} className="flex items-center gap-x-1">
                {index > 0 && <span aria-hidden>›</span>}
                <button
                  type="button"
                  onClick={() =>
                    onSelectCategory(model.categories.slice(0, index + 1))
                  }
                  className="rounded hover:text-[var(--accent-strong)] hover:underline"
                  aria-label={`Show models in ${model.categories
                    .slice(0, index + 1)
                    .join(" / ")}`}
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>
        )}
        <Card.Title>{model.title}</Card.Title>
        {model.description && (
          <Card.Description className="line-clamp-2">
            {model.description}
          </Card.Description>
        )}
      </Card.Header>

      <Card.Content className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {model.capabilities.map((capability) => (
            <Chip key={capability} size="sm" variant="soft">
              {CAPABILITY_LABELS[capability]}
            </Chip>
          ))}
          {!model.hasReadme && (
            <Chip size="sm" variant="soft" color="warning">
              No README
            </Chip>
          )}
        </div>
        {model.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {model.tags.map((tag) => (
              <Chip key={tag} size="sm" variant="tertiary">
                {tag}
              </Chip>
            ))}
          </div>
        )}
      </Card.Content>

      <Card.Footer className="text-xs text-muted">
        {model.files.length} file{model.files.length === 1 ? "" : "s"}
        {" · "}
        {extensionSummary(model)}
      </Card.Footer>
    </Card>
  );
}
