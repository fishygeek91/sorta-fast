import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Renderer } from "../src/render/renderer.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RENDER_DIR = join(TEST_DIR, "../src/render");
const UI_DIR = join(TEST_DIR, "../src/ui");

const FORBIDDEN_IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*(?:dijkstra|bellmanFord|trace|bmssp)(?:\.ts)?["']/;

/**
 * Assert every `.ts` file in `dir` avoids algorithm and trace module imports.
 *
 * @param dir - Directory to scan (e.g. `src/render` or `src/ui`).
 * @param label - Human label for assertion messages.
 */
function assertNoForbiddenImports(dir: string, label: string): void {
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));

  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    expect(
      source,
      `${label}/${file} must not import dijkstra, bellmanFord, bmssp, or trace.ts`,
    ).not.toMatch(FORBIDDEN_IMPORT);
  }
}

describe("render module imports", () => {
  it("imports Renderer without pulling algorithm or trace modules", () => {
    expect(Renderer).toBeTypeOf("function");
  });

  it("keeps src/render free of algorithm and trace imports", () => {
    assertNoForbiddenImports(RENDER_DIR, "src/render");
  });

  it("keeps src/ui free of algorithm and trace imports when present", () => {
    if (!existsSync(UI_DIR)) {
      return;
    }

    const uiFiles = readdirSync(UI_DIR).filter((name) => name.endsWith(".ts"));
    if (uiFiles.length === 0) {
      return;
    }

    assertNoForbiddenImports(UI_DIR, "src/ui");
  });
});
