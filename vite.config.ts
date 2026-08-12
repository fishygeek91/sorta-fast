import { defineConfig } from "vitest/config";

/**
 * Vite + Vitest configuration for the Sorta Fast single-page app.
 * Bench multi-page entry is deferred; see design.md §4.1 / issue #1 plan.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
