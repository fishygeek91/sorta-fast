import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CITY_MAX_N, SIZE_PRESETS } from "../src/core/graph.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("issue #20 graph picker — race.ts", () => {
  const raceSource = readUiSource("race.ts");

  it("labels XL size option as stress", () => {
    expect(raceSource).toContain('key === "XL" ? "XL (stress)" : key');
    expect(raceSource).toContain("race-size-select");
  });

  it("disables XL for city with issue #32 tooltip", () => {
    expect(raceSource).toContain("syncCityXlOption");
    expect(raceSource).toContain("City preset caps at L — see #32");
    expect(raceSource).toContain("xlSizeOption.disabled = true");
    expect(raceSource).toContain("syncGalleryControls");
  });

  it("clamps n to CITY_MAX_N when switching kind to city at XL", () => {
    expect(raceSource).toContain("CITY_MAX_N");
    expect(raceSource).toContain("SIZE_PRESETS.XL");
    expect(raceSource).toMatch(
      /raw === "city" && \(raceState\.n === SIZE_PRESETS\.XL \|\| raceState\.n > CITY_MAX_N\)/,
    );
    expect(raceSource).toContain("nextN = CITY_MAX_N");
    expect(CITY_MAX_N).toBe(SIZE_PRESETS.L);
    expect(SIZE_PRESETS.L).toBe(25000);
  });

  it("wires graph-generation progress and coalesced chunk paints", () => {
    expect(raceSource).toContain("onProgress");
    expect(raceSource).toContain("race-gen-progress");
    expect(raceSource).toContain("schedulePaint");

    const onChunkBlock = raceSource.match(/onChunk:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s*\},/)?.[0];
    expect(onChunkBlock).toBeDefined();
    expect(onChunkBlock).toContain("schedulePaint");
    expect(onChunkBlock).not.toMatch(/\bdrawFrame\(\)/);
  });
});

describe("issue #20 graph picker — lens.ts", () => {
  const lensSource = readUiSource("lens.ts");

  it("labels XL size option as stress", () => {
    expect(lensSource).toContain('key === "XL" ? "XL (stress)" : key');
    expect(lensSource).toContain("lens-size-select");
  });

  it("disables XL for city with issue #32 tooltip", () => {
    expect(lensSource).toContain("syncCityXlOption");
    expect(lensSource).toContain("City preset caps at L — see #32");
    expect(lensSource).toContain("xlSizeOption.disabled = true");
    expect(lensSource).toContain("syncGraphControls");
  });

  it("clamps n to CITY_MAX_N when switching kind to city at XL", () => {
    expect(lensSource).toContain("CITY_MAX_N");
    expect(lensSource).toContain("SIZE_PRESETS.XL");
    expect(lensSource).toMatch(
      /raw === "city" && \(lensState\.n === SIZE_PRESETS\.XL \|\| lensState\.n > CITY_MAX_N\)/,
    );
    expect(lensSource).toContain("nextN = CITY_MAX_N");
  });

  it("wires graph-generation progress worker messages", () => {
    expect(lensSource).toContain('case "progress"');
    expect(lensSource).toContain("lens-gen-progress");
  });
});
