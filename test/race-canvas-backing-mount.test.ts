import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

describe("issue #77 race canvas backing mount wiring", () => {
  const raceSource = readUiSource("race.ts");

  it("imports applyRaceCanvasBackingStore and RACE_LANE_CSS_PX", () => {
    expect(raceSource).toContain("applyRaceCanvasBackingStore");
    expect(raceSource).toContain("RACE_LANE_CSS_PX");
    expect(raceSource).toContain("./raceLaneSize.ts");
  });

  it("applies backing store before constructing Renderer", () => {
    const rendererIdx = raceSource.indexOf("new Renderer");
    const applyIdx = raceSource.indexOf("applyAllLaneBackingStores");
    expect(applyIdx).toBeGreaterThanOrEqual(0);
    expect(rendererIdx).toBeGreaterThan(applyIdx);
  });

  it("observes lane layout with ResizeObserver", () => {
    expect(raceSource).toContain("new ResizeObserver");
    expect(raceSource).toContain("laneResizeObserver.observe");
  });

  it("disconnects the resize observer in teardown", () => {
    const teardownIdx = raceSource.indexOf("function teardown");
    expect(teardownIdx).toBeGreaterThanOrEqual(0);
    const teardownSlice = raceSource.slice(teardownIdx, teardownIdx + 800);
    expect(teardownSlice).toContain("laneResizeObserver.disconnect");
  });
});
