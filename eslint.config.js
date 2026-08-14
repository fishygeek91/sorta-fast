import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config for Sorta Fast.
 * Prettier owns formatting; typescript-eslint owns type-aware-ish TS lint.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["src/render/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/core/dijkstra.ts",
                "**/core/bellmanFord.ts",
                "**/core/trace.ts",
                "**/core/bmssp/**",
                "../core/dijkstra.ts",
                "../core/bellmanFord.ts",
                "../core/trace.ts",
                "../core/bmssp/**",
              ],
              message:
                "Renderer consumes LaneState + Graph only — never algorithm modules (dijkstra, bellmanFord, bmssp) or the trace schema (issues #6/#7/#9/#10).",
            },
          ],
        },
      ],
    },
  },
);
