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

const EXPORT_MODULES = [
  "exportPaint.ts",
  "exportMeta.ts",
  "exportSheet.ts",
  "exportDownload.ts",
  "exportRecorder.ts",
] as const;

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("issue #18 export mount wiring", () => {
  const raceSource = readUiSource("race.ts");

  it("race.ts defines PNG and WebM export button ids", () => {
    expect(raceSource).toContain("race-export-png");
    expect(raceSource).toContain("race-export-webm");
  });

  it("race.ts wires exportPhotoFinishWhenPainted and createStreamRecorder", () => {
    expect(raceSource).toContain("exportPhotoFinishWhenPainted");
    expect(raceSource).toContain("createStreamRecorder");
  });

  it("race.ts gates export on canExportPhotoFinish", () => {
    expect(raceSource).toContain("canExportPhotoFinish");
  });

  it("race.ts shows a fallback status when video export is unsupported", () => {
    expect(raceSource).toContain(
      "Video export is not supported in this browser; PNG export still works.",
    );
  });

  it("race.ts skips PNG download when sheet paint fails", () => {
    expect(raceSource).toContain("exportPhotoFinishWhenPainted(painted");
    expect(raceSource).toContain("function paintExportSheet(): boolean");
  });

  it("race.ts seeks to the start before WebM replay export", () => {
    expect(raceSource).toContain("seek(0)");
  });

  it("race.ts stops an in-flight recorder when startRun aborts recording", () => {
    expect(raceSource).toContain("recorder.stop().catch");
  });

  it("race.ts does not import core algorithm modules directly", () => {
    expect(raceSource, "race.ts must not import ../core/dijkstra.ts").not.toMatch(
      CORE_DIJKSTRA_IMPORT,
    );
    expect(raceSource, "race.ts must not import ../core/bmssp").not.toMatch(CORE_BMSSP_IMPORT);
  });

  it("exportPaint.ts exists and exposes paintRaceExportSheet", () => {
    const source = readUiSource("exportPaint.ts");
    expect(source).toContain("paintRaceExportSheet");
  });

  it.each(EXPORT_MODULES)("%s does not import trace.ts", (filename) => {
    const source = readUiSource(filename);
    expect(source, `src/ui/${filename} must not import trace.ts`).not.toMatch(TRACE_IMPORT);
  });
});
