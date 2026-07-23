import path from "node:path";

/**
 * Global test guard.
 *
 * Every read path in `lib/` resolves against `CATALOG_CONFIG` (see
 * `lib/config.ts`). We point it at the self-contained fixture vault under
 * `tests/fixtures/test_vault` so the whole suite runs against known example
 * data and can **never** touch — or write to — the user's real catalog folder.
 *
 * Individual write tests (`inventory-write`) copy this vault's `catalog.yaml`
 * into a temp dir and re-point `CATALOG_CONFIG` at the copy, so even those
 * never mutate the fixture on disk.
 */
export const TEST_VAULT = path.resolve(__dirname, "fixtures/test_vault");
export const TEST_CONFIG = path.join(TEST_VAULT, "catalog.yaml");

process.env.CATALOG_CONFIG = TEST_CONFIG;
// Drop any per-root overrides that might leak in from the developer's shell.
delete process.env.CATALOG_MODELS_DIR;
delete process.env.CATALOG_FONTS_DIR;
delete process.env.CATALOG_ICONS_DIR;
