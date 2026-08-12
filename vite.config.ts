import { defineConfig } from "vitest/config";

/**
 * Vite + Vitest configuration for the Sorta Fast single-page app.
 * `base` targets GitHub project Pages at /sorta-fast/ (issue #4).
 * Bench multi-page entry is deferred; see design.md §4.1 / issue #1 plan.
 */
export default defineConfig({
  base: "/sorta-fast/",
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Shared GHA CPUs miss the 1M-event budget when files run in parallel (#35).
    fileParallelism: false,
  },
});
