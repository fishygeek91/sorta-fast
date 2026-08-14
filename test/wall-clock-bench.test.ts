import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  defaultResultsPath,
  defaultWallClockConfig,
  measureCell,
  quickWallClockConfig,
  shouldSkipWallClockCell,
  shouldWriteWallClockResults,
  type WallClockCell,
} from "../bench/wall-clock.ts";
import { CITY_MAX_N, GRAPH_KINDS, SIZE_PRESETS } from "../src/core/graph.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..");
const BENCH_INDEX_HTML = join(REPO_ROOT, "bench/index.html");
const BENCH_WALL_CLOCK_PAGE = join(REPO_ROOT, "bench/wall-clock-page.ts");
const VITE_CONFIG = join(REPO_ROOT, "vite.config.ts");

/**
 * Return true when `haystack` contains `needle`, case-insensitive.
 */
function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Return true when `value` is a non-null object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Require a finite number field on a benchmark cell object.
 */
function requireCellNumber(cell: Record<string, unknown>, field: string, index: number): number {
  const value = cell[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`wall-clock results cells[${String(index)}].${field} must be a finite number`);
  }
  return value;
}

/**
 * Return true when `value` is a valid {@link GraphKind}.
 */
function isGraphKind(value: string): value is WallClockCell["kind"] {
  return (GRAPH_KINDS as readonly string[]).includes(value);
}

/**
 * Parse committed wall-clock JSON and validate each cell shape.
 */
function parseWallClockResultsJson(raw: string): { cells: WallClockCell[] } {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("wall-clock results JSON root must be an object");
  }

  const cellsRaw = parsed["cells"];
  if (!Array.isArray(cellsRaw)) {
    throw new Error("wall-clock results JSON must have a cells array");
  }

  const cells: WallClockCell[] = [];
  for (let index = 0; index < cellsRaw.length; index += 1) {
    const item = cellsRaw[index];
    if (!isRecord(item)) {
      throw new Error(`wall-clock results cells[${String(index)}] must be an object`);
    }

    const kind = item["kind"];
    if (typeof kind !== "string" || !isGraphKind(kind)) {
      throw new Error(`wall-clock results cells[${String(index)}].kind must be a string`);
    }

    cells.push({
      kind,
      n: requireCellNumber(item, "n", index),
      seed: requireCellNumber(item, "seed", index),
      dijkstraWallMs: requireCellNumber(item, "dijkstraWallMs", index),
      bmsspWallMs: requireCellNumber(item, "bmsspWallMs", index),
      dijkstraWork: requireCellNumber(item, "dijkstraWork", index),
      bmsspWork: requireCellNumber(item, "bmsspWork", index),
    });
  }

  return { cells };
}

/**
 * Assert a benchmark cell row has finite timings and billed work for both lanes.
 */
function assertCompleteCell(cell: WallClockCell): void {
  expect(cell.kind).toBe("sparse");
  expect(Number.isFinite(cell.dijkstraWallMs)).toBe(true);
  expect(Number.isFinite(cell.bmsspWallMs)).toBe(true);
  expect(cell.dijkstraWallMs).toBeGreaterThanOrEqual(0);
  expect(cell.bmsspWallMs).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(cell.dijkstraWork)).toBe(true);
  expect(Number.isFinite(cell.bmsspWork)).toBe(true);
  expect(cell.dijkstraWork).toBeGreaterThan(0);
  expect(cell.bmsspWork).toBeGreaterThan(0);
}

describe("issue #21 wall-clock bench", () => {
  describe("shouldSkipWallClockCell", () => {
    it("skips city graphs above CITY_MAX_N but allows sparse XL and city at CITY_MAX_N", () => {
      expect(shouldSkipWallClockCell("city", CITY_MAX_N + 1)).toBe(true);
      expect(shouldSkipWallClockCell("city", SIZE_PRESETS.XL)).toBe(true);
      expect(shouldSkipWallClockCell("sparse", SIZE_PRESETS.XL)).toBe(false);
      expect(shouldSkipWallClockCell("city", CITY_MAX_N)).toBe(false);
    });
  });

  describe("defaultWallClockConfig", () => {
    it("uses sparse graphs at S/M/L/XL with seed 4", () => {
      const config = defaultWallClockConfig();

      expect(config.kind).toBe("sparse");
      expect(config.seed).toBe(4);
      expect(config.sizes).toEqual([
        SIZE_PRESETS.S,
        SIZE_PRESETS.M,
        SIZE_PRESETS.L,
        SIZE_PRESETS.XL,
      ]);
    });
  });

  describe("quickWallClockConfig", () => {
    it("uses sparse n=32 with seed 4 for smoke runs", () => {
      const config = quickWallClockConfig();

      expect(config.kind).toBe("sparse");
      expect(config.seed).toBe(4);
      expect(config.sizes).toEqual([32]);
    });
  });

  describe("shouldWriteWallClockResults", () => {
    it("skips JSON write for --quick smoke runs", () => {
      expect(shouldWriteWallClockResults(true)).toBe(false);
      expect(shouldWriteWallClockResults(false)).toBe(true);
    });
  });

  describe("measureCell", () => {
    it("returns finite positive work and non-negative wall ms for both lanes", () => {
      const cell = measureCell("sparse", 32, 4);

      expect(cell.kind).toBe("sparse");
      expect(cell.n).toBe(32);
      expect(cell.seed).toBe(4);
      assertCompleteCell(cell);
    }, 30_000);
  });

  describe("wall-clock-results.json", () => {
    it("requires committed S–XL sparse rows with both wall and work fields", () => {
      const resultsPath = defaultResultsPath();
      const raw = readFileSync(resultsPath, "utf8");
      const data = parseWallClockResultsJson(raw);
      const { cells } = data;

      expect(cells.length, "run npm run bench:wall-clock to commit S–XL results").toBeGreaterThan(
        0,
      );

      const requiredSizes = [
        SIZE_PRESETS.S,
        SIZE_PRESETS.M,
        SIZE_PRESETS.L,
        SIZE_PRESETS.XL,
      ] as const;

      for (const n of requiredSizes) {
        const row = cells.find((cell) => cell.kind === "sparse" && cell.n === n);
        expect(row, `missing sparse row for n=${String(n)}`).toBeDefined();
        if (row === undefined) {
          continue;
        }
        assertCompleteCell(row);
      }
    });
  });

  describe("bench page copy and imports", () => {
    const indexHtml = readFileSync(BENCH_INDEX_HTML, "utf8");
    const pageSource = readFileSync(BENCH_WALL_CLOCK_PAGE, "utf8");
    const combined = `${indexHtml}\n${pageSource}`;

    it("explains work clock vs misleading wall-clock crossover with Dijkstra at small sizes", () => {
      expect(includesIgnoreCase(combined, "work clock")).toBe(true);
      expect(includesIgnoreCase(combined, "misleading")).toBe(true);
      expect(includesIgnoreCase(combined, "crossover")).toBe(true);
      expect(includesIgnoreCase(combined, "Dijkstra")).toBe(true);
      expect(includesIgnoreCase(combined, "S and M") || includesIgnoreCase(combined, "small")).toBe(
        true,
      );
    });

    it("does not import core algorithm modules in wall-clock-page.ts", () => {
      expect(pageSource).not.toContain("src/core/dijkstra");
      expect(pageSource).not.toContain("src/core/bmssp");
    });
  });

  describe("vite.config.ts", () => {
    it("includes bench/index.html as a build entry", () => {
      const viteConfig = readFileSync(VITE_CONFIG, "utf8");
      expect(viteConfig).toContain("bench/index.html");
    });
  });
});
