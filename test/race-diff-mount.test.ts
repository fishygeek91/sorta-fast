import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

const CORE_DIJKSTRA_IMPORT = /from\s+["'][^"']*core\/dijkstra(?:\.ts)?["']/;

const TRACE_IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*trace(?:\.ts)?["']/;

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("issue #68 race diff mount wiring", () => {
  const raceSource = readUiSource("race.ts");

  it("race.ts defines the diff toggle button with RACE_CHROME_COPY labels", () => {
    expect(raceSource).toMatch(/id\s*=\s*["']race-diff-toggle["']/);
    expect(raceSource).toContain("RACE_CHROME_COPY.diffToggleLabel");
    expect(raceSource).toContain("RACE_CHROME_COPY.diffToggleTitle");
  });

  it("race.ts calls drawDiff when diff view is active", () => {
    expect(raceSource).toContain("drawDiff");
  });

  it("race.ts sets raceRoot dataset.view for lanes vs diff layout", () => {
    expect(raceSource).toContain("dataset.view");
  });

  it("race.ts syncRaceLegend uses explainerMeaning for settle-diff tint", () => {
    const legendIdx = raceSource.indexOf("function syncRaceLegend");
    expect(legendIdx).toBeGreaterThanOrEqual(0);

    const legendBody = raceSource.slice(legendIdx);
    const nextFn = legendBody.indexOf("\nfunction ", 1);
    const syncRaceLegendSource = nextFn >= 0 ? legendBody.slice(0, nextFn) : legendBody;

    expect(syncRaceLegendSource).toContain("settle-diff tint");
    expect(syncRaceLegendSource).toContain("explainerMeaning");
  });

  it("race.ts skips hidden lane canvases in applyAllLaneBackingStores", () => {
    const fnIdx = raceSource.indexOf("function applyAllLaneBackingStores");
    expect(fnIdx).toBeGreaterThanOrEqual(0);

    const fnBody = raceSource.slice(fnIdx);
    const nextFn = fnBody.indexOf("\n  function ", 1);
    const applySource = nextFn >= 0 ? fnBody.slice(0, nextFn) : fnBody;

    expect(applySource).toContain(".hidden");
    expect(applySource).toContain("applyRaceCanvasBackingStore");
  });

  it("race.ts inserts diff wrap before lanes without changing legend append order", () => {
    expect(raceSource).toContain("raceRoot.insertBefore(diffWrap, lanesEl)");
  });

  it("race.ts does not import core algorithm modules or trace.ts", () => {
    expect(raceSource, "race.ts must not import ../core/dijkstra.ts").not.toMatch(
      CORE_DIJKSTRA_IMPORT,
    );
    expect(raceSource, "race.ts must not import trace.ts").not.toMatch(TRACE_IMPORT);
  });
});
