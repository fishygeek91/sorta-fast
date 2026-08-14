import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vite + Vitest configuration for the Sorta Fast app (issue #4).
 * `base` targets GitHub project Pages at /sorta-fast/.
 * Multi-page: main app + wall-clock bench page (issue #21 / design.md §4.1).
 */
export default defineConfig({
  base: "/sorta-fast/",
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        bench: fileURLToPath(new URL("./bench/index.html", import.meta.url)),
      },
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Shared GHA CPUs miss the 1M-event budget when files run in parallel (#35).
    fileParallelism: false,
  },
});
