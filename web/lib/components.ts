/**
 * Component lines — the shape of "this model contains three of that one".
 *
 * A **pure** module, like `customize-spec.ts`: no `node:fs`, no config, nothing
 * server-only. The picker in `components/model/components-input.tsx` needs the
 * constants below at runtime, and importing a *value* from `lib/catalog.ts`
 * would drag the filesystem into the browser bundle and break the build.
 * Parsing lives in `catalog.ts`, which has the frontmatter coercers.
 */

/**
 * Which of a component's own per-part costs carry into the model that contains
 * it. Filament and machine time are never optional — they *are* the print.
 */
export type ComponentCostPart = "supplies" | "labor" | "packaging" | "shipping";

/** The canonical order, so a saved file never churns on re-save. */
export const COMPONENT_COST_PARTS: ComponentCostPart[] = [
  "supplies",
  "labor",
  "packaging",
  "shipping",
];

/**
 * The default when a component line omits `include:`. Packaging and shipping
 * are off because a kit is bagged once and shipped once — carrying each
 * component's own bag and postage would charge for them several times over.
 */
export const DEFAULT_COMPONENT_INCLUDE: ComponentCostPart[] = [
  "supplies",
  "labor",
];

/**
 * One component line: how many of *another catalog model* this one contains.
 * The shape mirrors `ModelSupply`, because a component is priced the same way a
 * supply is — a reference resolved at cost time, never a copy of its numbers.
 */
export interface ModelComponent {
  /** The `slug` of another model, e.g. "clickers/mx-clicker-base". */
  model: string;
  /** How many of it this model contains. */
  qty: number;
  /** Which of that component's per-part costs fold in. */
  include: ComponentCostPart[];
}
