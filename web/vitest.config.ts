import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the catalog app's `lib/` logic.
 *
 * Tests run in a plain Node environment (the code under test touches
 * `node:fs`, not the DOM). `setup.ts` pins `CATALOG_CONFIG` at the fixture
 * vault so no test can ever read or write the user's real catalog folder.
 */
export default defineConfig({
  resolve: {
    // Mirror tsconfig's `@/*` alias so tests can import the same way the app does.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      // Reporters only; no hard threshold yet — the suite is a starting point.
      reporter: ["text", "html"],
    },
  },
});
