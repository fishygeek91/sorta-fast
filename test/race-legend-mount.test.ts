import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

const CORE_DIJKSTRA_IMPORT = /from\s+["'][^"']*core\/dijkstra(?:\.ts)?["']/;

const CORE_BMSSP_IMPORT = /from\s+["'][^"']*core\/bmssp/;

const TRACE_IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*trace(?:\.ts)?["']/;

const LEGEND_APPEND =
  /raceRoot\.append\(\s*bannerEl\s*,\s*lanesEl\s*,\s*legendEl\s*,\s*transport\s*\)/;

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("issue #65 race legend mount wiring", () => {
  const raceSource = readUiSource("race.ts");

  it("race.ts imports RACE_CHROME_COPY, explainerMeaning, and personaTitle from siteCopy", () => {
    expect(raceSource).toMatch(
      /import\s*\{[^}]*RACE_CHROME_COPY[^}]*explainerMeaning[^}]*personaTitle[^}]*\}\s*from\s*["'][^"']*siteCopy(?:\.ts)?["']/,
    );
  });

  it("race.ts defines mountRaceLegend and uses class race-legend", () => {
    expect(raceSource).toContain("function mountRaceLegend");
    expect(raceSource).toContain('"race-legend"');
  });

  it("race.ts legend items wire explainerMeaning and swatch markup", () => {
    const legendIdx = raceSource.indexOf("function mountRaceLegend");
    expect(legendIdx).toBeGreaterThanOrEqual(0);

    const legendBody = raceSource.slice(legendIdx);
    const nextFn = legendBody.indexOf("\nfunction ", 1);
    const mountRaceLegendSource = nextFn >= 0 ? legendBody.slice(0, nextFn) : legendBody;

    expect(mountRaceLegendSource).toContain("explainerMeaning");
    expect(mountRaceLegendSource).toContain("dataset.swatch");
    expect(mountRaceLegendSource).toContain('"race-legend-swatch"');
  });

  it("race.ts mountRaceLegend uses all four RACE_CHROME_COPY legend labels", () => {
    const legendIdx = raceSource.indexOf("function mountRaceLegend");
    expect(legendIdx).toBeGreaterThanOrEqual(0);

    const legendBody = raceSource.slice(legendIdx);
    const nextFn = legendBody.indexOf("\nfunction ", 1);
    const mountRaceLegendSource = nextFn >= 0 ? legendBody.slice(0, nextFn) : legendBody;

    expect(mountRaceLegendSource).toContain("RACE_CHROME_COPY.legendFrontier");
    expect(mountRaceLegendSource).toContain("RACE_CHROME_COPY.legendSettled");
    expect(mountRaceLegendSource).toContain("RACE_CHROME_COPY.legendUnreached");
    expect(mountRaceLegendSource).toContain("RACE_CHROME_COPY.legendShortestPath");
  });

  it("race.ts appends banner, lanes, legend, and transport to raceRoot", () => {
    expect(raceSource).toMatch(LEGEND_APPEND);
  });

  it("race.ts createCounterBlock sets title, aria-describedby, and race-counter-desc", () => {
    const blockIdx = raceSource.indexOf("function createCounterBlock");
    expect(blockIdx).toBeGreaterThanOrEqual(0);

    const blockBody = raceSource.slice(blockIdx);
    const nextFn = blockBody.indexOf("\nfunction ", 1);
    const createCounterBlockSource = nextFn >= 0 ? blockBody.slice(0, nextFn) : blockBody;

    expect(createCounterBlockSource).toContain("block.title = titleText");
    expect(createCounterBlockSource).toContain('setAttribute("aria-describedby"');
    expect(createCounterBlockSource).toContain("race-counter-desc");
    expect(createCounterBlockSource).not.toContain("aria-label");
  });

  it("race.ts createCounterBlock call sites pass RACE_CHROME_COPY.counterTitles", () => {
    const panelIdx = raceSource.indexOf("function buildLanePanel");
    expect(panelIdx).toBeGreaterThanOrEqual(0);

    const panelBody = raceSource.slice(panelIdx);
    const nextFn = panelBody.indexOf("\nfunction ", 1);
    const buildLanePanelSource = nextFn >= 0 ? panelBody.slice(0, nextFn) : panelBody;

    expect(buildLanePanelSource).toContain("RACE_CHROME_COPY.counterTitles.comparisons");
    expect(buildLanePanelSource).toContain("RACE_CHROME_COPY.counterTitles.heapOps");
    expect(buildLanePanelSource).toContain("RACE_CHROME_COPY.counterTitles.dOps");
    expect(buildLanePanelSource).toContain("RACE_CHROME_COPY.counterTitles.relaxations");
    expect(buildLanePanelSource).toContain("RACE_CHROME_COPY.counterTitles.outOfOrder");
  });

  it("race.ts dice button uses RACE_CHROME_COPY.diceTitle and keeps roll aria-label", () => {
    expect(raceSource).toContain("diceButton.title = RACE_CHROME_COPY.diceTitle");
    expect(raceSource).toContain('setAttribute("aria-label", "Roll a new seed")');
  });

  it("race.ts bmssp select uses RACE_CHROME_COPY.bmsspSelectTitle", () => {
    expect(raceSource).toContain("bmsspSelect.title = RACE_CHROME_COPY.bmsspSelectTitle");
  });

  it("race.ts persona tooltips use stubPersonaTitle or personaTitle", () => {
    const panelIdx = raceSource.indexOf("function buildLanePanel");
    expect(panelIdx).toBeGreaterThanOrEqual(0);

    const panelBody = raceSource.slice(panelIdx);
    const nextFn = panelBody.indexOf("\nfunction ", 1);
    const buildLanePanelSource = nextFn >= 0 ? panelBody.slice(0, nextFn) : panelBody;

    expect(buildLanePanelSource).toContain('config.persona === "stub"');
    expect(buildLanePanelSource).toContain("RACE_CHROME_COPY.stubPersonaTitle");
    expect(buildLanePanelSource).toContain("personaTitle(config.persona)");
  });

  it("race.ts settled wrap and drawFrame update settled label and progress aria-label", () => {
    expect(raceSource).toContain('"race-settled-wrap"');
    expect(raceSource).toContain('"race-settled-label"');

    const drawIdx = raceSource.indexOf("function drawFrame");
    expect(drawIdx).toBeGreaterThanOrEqual(0);

    const drawBody = raceSource.slice(drawIdx);
    const nextFn = drawBody.indexOf("\n  function ", 1);
    const drawFrameSource = nextFn >= 0 ? drawBody.slice(0, nextFn) : drawBody;

    expect(drawFrameSource).toContain("settledLabel.textContent");
    expect(drawFrameSource).toContain('setAttribute("aria-label"');
    expect(drawFrameSource).toContain("RACE_CHROME_COPY.settledLabel");
  });

  it("race.ts does not import core algorithm modules or trace.ts", () => {
    expect(raceSource, "race.ts must not import ../core/dijkstra.ts").not.toMatch(
      CORE_DIJKSTRA_IMPORT,
    );
    expect(raceSource, "race.ts must not import ../core/bmssp").not.toMatch(CORE_BMSSP_IMPORT);
    expect(raceSource, "race.ts must not import trace.ts").not.toMatch(TRACE_IMPORT);
  });
});
