import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

const CORE_DIJKSTRA_IMPORT = /from\s+["'][^"']*core\/dijkstra(?:\.ts)?["']/;

const CORE_BMSSP_IMPORT = /from\s+["'][^"']*core\/bmssp/;

const BANNER_FIRST_APPEND =
  /raceRoot\.append\(\s*bannerEl\s*,\s*lanesEl\s*,\s*legendEl\s*,\s*transport\s*\)/;

const LANES_ONLY_APPEND = /raceRoot\.append\(\s*lanesEl\s*,\s*transport\s*\)/;

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("issue #63 race standing mount wiring", () => {
  const raceSource = readUiSource("race.ts");

  it("race.ts sets and tears down root dataset.mode", () => {
    expect(raceSource).toContain('root.dataset.mode = "race"');
    expect(raceSource).toContain("delete root.dataset.mode");
  });

  it("race.ts appends banner before lanes (legend between lanes and transport) in raceRoot", () => {
    expect(raceSource).toMatch(BANNER_FIRST_APPEND);
    expect(raceSource, "banner must precede lanes in raceRoot.append").not.toMatch(
      LANES_ONLY_APPEND,
    );
  });

  it("race.ts imports photo-finish standing helpers from photoFinish.ts", () => {
    expect(raceSource).toContain("rankLaneIndices");
    expect(raceSource).toContain("bestInClassSecondary");
    expect(raceSource).toContain("settleLead");
  });

  it("race.ts defines syncStanding and wires winner / lead copy", () => {
    expect(raceSource).toContain("function syncStanding");
    expect(raceSource).toMatch(/WINNER_CHIP_TEXT|"Winner — lowest work"/);
    expect(raceSource).toContain("Ahead by");
    expect(raceSource).toContain("race-best-note");
    expect(raceSource).toContain("visually-hidden");
  });

  it("race.ts does not replace best-in-class counter names with aria-label", () => {
    const applyIdx = raceSource.indexOf("function applyBestMark");
    expect(applyIdx).toBeGreaterThanOrEqual(0);
    const applyBody = raceSource.slice(applyIdx);
    const nextFn = applyBody.indexOf("\n  function ", 1);
    const applySource = nextFn >= 0 ? applyBody.slice(0, nextFn) : applyBody;
    expect(applySource).not.toContain("aria-label");
  });

  it("race.ts gates live lead on lanePhotoFrozen inside syncStanding", () => {
    const syncIdx = raceSource.indexOf("function syncStanding");
    expect(syncIdx).toBeGreaterThanOrEqual(0);

    const syncBody = raceSource.slice(syncIdx);
    const nextFn = syncBody.indexOf("\n  function ", 1);
    const syncStandingSource = nextFn >= 0 ? syncBody.slice(0, nextFn) : syncBody;

    expect(syncStandingSource).toContain("lanePhotoFrozen");
    expect(syncStandingSource).toMatch(/anyFrozen/);
  });

  it("race.ts calls syncStanding from drawFrame", () => {
    const drawIdx = raceSource.indexOf("function drawFrame");
    expect(drawIdx).toBeGreaterThanOrEqual(0);

    const drawBody = raceSource.slice(drawIdx);
    const nextFn = drawBody.indexOf("\n  function ", 1);
    const drawFrameSource = nextFn >= 0 ? drawBody.slice(0, nextFn) : drawBody;

    expect(drawFrameSource).toMatch(/syncStanding\(/);
  });

  it("race.ts keeps formatRaceBanner and allPhotoFrozen for banner sync", () => {
    expect(raceSource).toContain("formatRaceBanner");

    const syncBannerIdx = raceSource.indexOf("function syncBanner");
    expect(syncBannerIdx).toBeGreaterThanOrEqual(0);
    const syncBannerBody = raceSource.slice(syncBannerIdx, syncBannerIdx + 500);
    expect(syncBannerBody).toContain("allPhotoFrozen()");
    expect(syncBannerBody).toContain("formatRaceBanner");

    const buildExportIdx = raceSource.indexOf("function buildExportSheetSpec");
    expect(buildExportIdx).toBeGreaterThanOrEqual(0);
    const buildExportBody = raceSource.slice(buildExportIdx);
    const bannerIdx = buildExportBody.indexOf("banner:");
    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    const bannerSlice = buildExportBody.slice(bannerIdx, bannerIdx + 400);
    expect(bannerSlice).toContain("allPhotoFrozen()");
    expect(bannerSlice).toContain("formatRaceBanner");
  });

  it("race.ts documents partial-freeze / invert settle leadership", () => {
    expect(raceSource).toMatch(/Partial freeze|invert/i);
  });

  it("race.ts does not import core algorithm modules directly", () => {
    expect(raceSource, "race.ts must not import ../core/dijkstra.ts").not.toMatch(
      CORE_DIJKSTRA_IMPORT,
    );
    expect(raceSource, "race.ts must not import ../core/bmssp").not.toMatch(CORE_BMSSP_IMPORT);
  });
});
