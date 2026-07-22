import { Card, Chip } from "@heroui/react";

import type { ModelFile } from "@/lib/catalog";
import { KIND_LABELS, type FileKind } from "@/lib/files";
import type { ThreeMfReport } from "@/lib/threemf";

import { ExtruderCheck } from "./extruder-check";
import { FileRow } from "./file-row";

/** The order files are presented in: the useful ones first. */
const ORDER: FileKind[] = [
  "print",
  "mesh",
  "cad",
  "script",
  "image",
  "doc",
  "other",
];

/**
 * Everything in the model's folder, in one card.
 *
 * These are all just files sitting next to each other on disk, so they belong
 * in a single panel — but a flat list of a dozen entries hides the thing that
 * actually matters, which is *what kind* of file each one is. Hence one card,
 * grouped into labelled sections.
 */
export function FileTable({
  files,
  threeMf,
}: {
  files: ModelFile[];
  threeMf?: ThreeMfReport;
}) {
  const summaryFor = (name: string) =>
    threeMf?.files.find((entry) => entry.label === name);
  // Generated files get their own section rather than being mixed in by kind:
  // an STL you committed and an STL your script just wrote are different
  // things, even though they classify identically.
  const own = files.filter((file) => !file.isOutput);
  const generated = files.filter((file) => file.isOutput);

  const groups = ORDER.map((kind) => ({
    label: KIND_LABELS[kind],
    key: kind as string,
    items: own.filter((file) => file.kind === kind),
  })).filter((group) => group.items.length > 0);

  if (generated.length > 0) {
    groups.push({ label: "Output", key: "output", items: generated });
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title className="flex items-center gap-2 text-base">
          Files
          <Chip size="sm" variant="soft">
            {files.length}
          </Chip>
        </Card.Title>
      </Card.Header>

      <Card.Content className="flex flex-col gap-4">
        {groups.map((group, index) => (
          <section
            key={group.key}
            className={
              index > 0 ? "border-t border-[var(--card-border)] pt-4" : ""
            }
          >
            <h3 className="mb-1 flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-[var(--faint)] uppercase">
              {group.label}
              <span className="min-w-[20px] rounded-full bg-[var(--chip)] px-1.5 text-center text-[11px] font-semibold">
                {group.items.length}
              </span>
            </h3>

            {/* No dividers between rows: the section headings already carry
                the structure, and a rule under every file competes with the
                indented tool lists for the eye. */}
            <div className="flex flex-col">
              {group.items.map((file) => (
                <FileRow
                  key={file.relPath}
                  file={file}
                  summary={summaryFor(file.name)}
                />
              ))}
            </div>

            {/* The verdict belongs beside the files it is about, so it lands in
                whichever section actually holds the 3MFs — "Output" for a
                generator, "Print file" for downloaded projects. */}
            {threeMf && group.items.some((file) => summaryFor(file.name)) && (
              <div className="mt-3">
                <ExtruderCheck report={threeMf} />
              </div>
            )}
          </section>
        ))}
      </Card.Content>
    </Card>
  );
}
