import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

const CORE_DIJKSTRA_IMPORT = /from\s+["'][^"']*core\/dijkstra(?:\.ts)?["']/;

const CORE_BMSSP_IMPORT = /from\s+["'][^"']*core\/bmssp/;

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("issue #103 featured gallery wiring", () => {
  const raceSource = readUiSource("race.ts");

  it("race.ts mounts the featured preset button and applies FEATURED_RACE_URL", () => {
    expect(raceSource).toContain("race-featured-button");
    expect(raceSource).toContain("FEATURED_RACE_URL");
    expect(raceSource.includes("The barrier falls") || raceSource.includes("featuredButton")).toBe(
      true,
    );
    expect(raceSource).toContain("applyRaceState({ ...FEATURED_RACE_URL })");
  });

  it("race.ts labels graph-kind options with GRAPH_KIND_PICKER_LABELS", () => {
    expect(raceSource).toContain("GRAPH_KIND_PICKER_LABELS");
    expect(raceSource).toContain("GRAPH_KIND_PICKER_LABELS[kind]");
  });

  it("race.ts restarts when target changes in graphGalleryChanged", () => {
    expect(
      raceSource.includes("target !== next.target") ||
        raceSource.includes("prev.target !== next.target"),
    ).toBe(true);
  });

  it("race.ts gates settle-all banner, winner, and export on settleAllFinished", () => {
    const syncBannerIdx = raceSource.indexOf("function syncBanner");
    expect(syncBannerIdx).toBeGreaterThanOrEqual(0);
    const syncBannerBody = raceSource.slice(syncBannerIdx, syncBannerIdx + 800);
    expect(syncBannerBody).toContain("settleAllFinished");
    expect(syncBannerBody).not.toMatch(/if\s*\(\s*activeRace\.allComplete\s*\)/);

    const syncStandingIdx = raceSource.indexOf("function syncStanding");
    expect(syncStandingIdx).toBeGreaterThanOrEqual(0);
    const syncStandingBody = raceSource.slice(syncStandingIdx, syncStandingIdx + 600);
    expect(syncStandingBody).toContain("settleAllFinished");
    expect(syncStandingBody).not.toMatch(
      /if\s*\(\s*activeRace\.allComplete\s*\)\s*\{\s*for\s*\(\s*const\s+ui\s+of\s+laneUis/,
    );

    expect(raceSource).toContain("race.settleAllFinished");
    expect(raceSource).not.toContain('raceState.target === "none" && race.allComplete');
  });

  it("race.ts does not abort onGraph solely when finish is null", () => {
    const onGraphIdx = raceSource.indexOf("onGraph:");
    expect(onGraphIdx).toBeGreaterThanOrEqual(0);
    const onGraphBody = raceSource.slice(onGraphIdx, onGraphIdx + 1200);
    expect(onGraphBody).toContain("resolution.finish !== null");
    expect(onGraphBody).toContain("resolution.status !== null");
    expect(onGraphBody).not.toMatch(
      /if\s*\(\s*resolution\.finish\s*===\s*null\s*\)\s*\{\s*return;/,
    );
  });

  it("race.ts does not import core algorithm modules directly", () => {
    expect(raceSource, "race.ts must not import ../core/dijkstra.ts").not.toMatch(
      CORE_DIJKSTRA_IMPORT,
    );
    expect(raceSource, "race.ts must not import ../core/bmssp").not.toMatch(CORE_BMSSP_IMPORT);
  });
});
