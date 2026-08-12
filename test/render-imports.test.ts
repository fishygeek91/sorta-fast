import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Renderer } from "../src/render/renderer.ts";

const RENDER_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/render");

const FORBIDDEN_IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*(?:dijkstra|bellmanFord|trace)(?:\.ts)?["']/;

describe("render module imports", () => {
  it("imports Renderer without pulling algorithm or trace modules", () => {
    expect(Renderer).toBeTypeOf("function");
  });

  it("keeps src/render free of algorithm and trace imports", () => {
    const files = readdirSync(RENDER_DIR).filter((name) => name.endsWith(".ts"));

    for (const file of files) {
      const source = readFileSync(join(RENDER_DIR, file), "utf8");
      expect(source, `${file} must not import dijkstra, bellmanFord, or trace.ts`).not.toMatch(
        FORBIDDEN_IMPORT,
      );
    }
  });
});
