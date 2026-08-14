import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

const TRACE_IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*trace(?:\.ts)?["']/;

const CORE_DIJKSTRA_IMPORT = /from\s+["'][^"']*core\/dijkstra(?:\.ts)?["']/;

const CORE_BMSSP_IMPORT = /from\s+["'][^"']*core\/bmssp/;

const PLAY_BTN = /\bplayBtn\b/;

const PAUSE_BTN = /\bpauseBtn\b/;

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

/**
 * Slice a nested `function name` body inside `mountRace` / `mountLens`.
 *
 * @param source - Full module source text.
 * @param functionName - Local function identifier (e.g. `drawFrame`).
 * @returns Source from the function keyword through the next sibling function.
 */
function sliceNestedFunction(source: string, functionName: string): string {
  const idx = source.indexOf(`function ${functionName}`);
  expect(idx).toBeGreaterThanOrEqual(0);

  const body = source.slice(idx);
  const nextFn = body.indexOf("\n  function ", 1);
  return nextFn >= 0 ? body.slice(0, nextFn) : body;
}

describe("issue #66 race transport", () => {
  const raceSource = readUiSource("race.ts");

  it("race.ts defines playPauseBtn, syncPlayPauseUi, and aria-pressed", () => {
    expect(raceSource).toContain("playPauseBtn");
    expect(raceSource).toContain("syncPlayPauseUi");
    expect(raceSource).toContain("aria-pressed");
  });

  it("race.ts does not use separate playBtn or pauseBtn identifiers", () => {
    expect(raceSource, "race.ts must not reference playBtn").not.toMatch(PLAY_BTN);
    expect(raceSource, "race.ts must not reference pauseBtn").not.toMatch(PAUSE_BTN);
  });

  it("race.ts defines transport-playback and transport-export groups with transport-play toggle", () => {
    expect(raceSource).toContain('"transport-playback"');
    expect(raceSource).toContain('"transport-export"');
    expect(raceSource).toContain('"transport-play"');
  });

  it("race.ts orders playback controls skipStart, stepBack, playPause, stepEvent, stepOp, skipEnd", () => {
    const appendIdx = raceSource.indexOf("playbackGroup.append(");
    expect(appendIdx).toBeGreaterThanOrEqual(0);

    const closeIdx = raceSource.indexOf(");", appendIdx);
    expect(closeIdx).toBeGreaterThan(appendIdx);

    const appendBlock = raceSource.slice(appendIdx, closeIdx);
    const skipStartIdx = appendBlock.indexOf("skipStartBtn");
    const stepBackIdx = appendBlock.indexOf("stepBackBtn");
    const playPauseIdx = appendBlock.indexOf("playPauseBtn");
    const stepEventIdx = appendBlock.indexOf("stepEventBtn");
    const stepOpIdx = appendBlock.indexOf("stepOpBtn");
    const skipEndIdx = appendBlock.indexOf("skipEndBtn");

    expect(skipStartIdx).toBeGreaterThanOrEqual(0);
    expect(stepBackIdx).toBeGreaterThan(skipStartIdx);
    expect(playPauseIdx).toBeGreaterThan(stepBackIdx);
    expect(stepEventIdx).toBeGreaterThan(playPauseIdx);
    expect(stepOpIdx).toBeGreaterThan(stepEventIdx);
    expect(skipEndIdx).toBeGreaterThan(stepOpIdx);
  });

  it("race.ts export group wires PNG and WebM buttons with stable ids", () => {
    const appendIdx = raceSource.indexOf("exportGroup.append(");
    expect(appendIdx).toBeGreaterThanOrEqual(0);

    const closeIdx = raceSource.indexOf(");", appendIdx);
    expect(closeIdx).toBeGreaterThan(appendIdx);

    const appendBlock = raceSource.slice(appendIdx, closeIdx);
    const pngIdx = appendBlock.indexOf("exportPngBtn");
    const webmIdx = appendBlock.indexOf("exportWebmBtn");

    expect(pngIdx).toBeGreaterThanOrEqual(0);
    expect(webmIdx).toBeGreaterThan(pngIdx);
    expect(raceSource).toContain("race-export-png");
    expect(raceSource).toContain("race-export-webm");
  });

  it("race.ts step buttons use RACE_CHROME_COPY step titles", () => {
    expect(raceSource).toContain("stepEventBtn.title = RACE_CHROME_COPY.stepEventTitle");
    expect(raceSource).toContain("stepOpBtn.title = RACE_CHROME_COPY.stepOpTitle");
  });

  it("race.ts syncExportButtons uses RACE_CHROME_COPY.exportDisabledTitle", () => {
    const syncIdx = raceSource.indexOf("function syncExportButtons");
    expect(syncIdx).toBeGreaterThanOrEqual(0);

    const syncBody = sliceNestedFunction(raceSource, "syncExportButtons");
    expect(syncBody).toContain("RACE_CHROME_COPY.exportDisabledTitle");
  });

  it("race.ts startRun calls syncPlayPauseUi", () => {
    const startRunBody = sliceNestedFunction(raceSource, "startRun");
    expect(startRunBody).toContain("syncPlayPauseUi()");
  });

  it("race.ts drawFrame calls syncPlayPauseUi", () => {
    const drawFrameBody = sliceNestedFunction(raceSource, "drawFrame");
    expect(drawFrameBody).toContain("syncPlayPauseUi()");
  });

  it("race.ts restoreRecordingUi calls syncPlayPauseUi", () => {
    const restoreBody = sliceNestedFunction(raceSource, "restoreRecordingUi");
    expect(restoreBody).toContain("syncPlayPauseUi()");
  });

  it("race.ts syncRecordingControls disables playPauseBtn and shows recording state on WebM", () => {
    const syncBody = sliceNestedFunction(raceSource, "syncRecordingControls");
    expect(syncBody).toContain("playPauseBtn.disabled");
    expect(syncBody).toContain("exportWebmBtn.dataset.recording");
    expect(syncBody).toContain("Recording…");
  });

  it("race.ts does not import core algorithm modules directly", () => {
    expect(raceSource, "race.ts must not import ../core/dijkstra.ts").not.toMatch(
      CORE_DIJKSTRA_IMPORT,
    );
    expect(raceSource, "race.ts must not import ../core/bmssp").not.toMatch(CORE_BMSSP_IMPORT);
  });
});

describe("issue #66 lens transport", () => {
  const lensSource = readUiSource("lens.ts");

  it("lens.ts imports RACE_CHROME_COPY from siteCopy", () => {
    expect(lensSource).toMatch(
      /import\s*\{[^}]*RACE_CHROME_COPY[^}]*\}\s*from\s*["'][^"']*siteCopy(?:\.ts)?["']/,
    );
  });

  it("lens.ts defines playPauseBtn, syncPlayPauseUi, aria-pressed, and transport-play", () => {
    expect(lensSource).toContain("playPauseBtn");
    expect(lensSource).toContain("syncPlayPauseUi");
    expect(lensSource).toContain("aria-pressed");
    expect(lensSource).toContain('"transport-play"');
  });

  it("lens.ts does not use separate playBtn or pauseBtn identifiers", () => {
    expect(lensSource, "lens.ts must not reference playBtn").not.toMatch(PLAY_BTN);
    expect(lensSource, "lens.ts must not reference pauseBtn").not.toMatch(PAUSE_BTN);
  });

  it("lens.ts step buttons use RACE_CHROME_COPY step titles", () => {
    expect(lensSource).toContain("stepEventBtn.title = RACE_CHROME_COPY.stepEventTitle");
    expect(lensSource).toContain("stepOpBtn.title = RACE_CHROME_COPY.stepOpTitle");
  });

  it("lens.ts appends playPause before stepEvent and stepOp on transport", () => {
    const appendIdx = lensSource.indexOf("transport.append(");
    expect(appendIdx).toBeGreaterThanOrEqual(0);

    const closeIdx = lensSource.indexOf(");", appendIdx);
    expect(closeIdx).toBeGreaterThan(appendIdx);

    const appendBlock = lensSource.slice(appendIdx, closeIdx);
    const playPauseIdx = appendBlock.indexOf("playPauseBtn");
    const stepEventIdx = appendBlock.indexOf("stepEventBtn");
    const stepOpIdx = appendBlock.indexOf("stepOpBtn");

    expect(playPauseIdx).toBeGreaterThanOrEqual(0);
    expect(stepEventIdx).toBeGreaterThan(playPauseIdx);
    expect(stepOpIdx).toBeGreaterThan(stepEventIdx);
  });

  it("lens.ts startRun and drawFrame call syncPlayPauseUi", () => {
    const startRunBody = sliceNestedFunction(lensSource, "startRun");
    expect(startRunBody).toContain("syncPlayPauseUi()");

    const drawFrameBody = sliceNestedFunction(lensSource, "drawFrame");
    expect(drawFrameBody).toContain("syncPlayPauseUi()");
  });

  it("lens.ts does not import core algorithm modules or trace.ts", () => {
    expect(lensSource, "lens.ts must not import ../core/dijkstra.ts").not.toMatch(
      CORE_DIJKSTRA_IMPORT,
    );
    expect(lensSource, "lens.ts must not import ../core/bmssp").not.toMatch(CORE_BMSSP_IMPORT);
    expect(lensSource, "lens.ts must not import trace.ts").not.toMatch(TRACE_IMPORT);
  });
});
