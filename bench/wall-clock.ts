/**
 * Node bench: wall-clock timing for Dijkstra vs BMSSP vs DMSY trace drains (issue #21 / #28).
 *
 * Headless — seeded graphs only, no DOM. Graph generation is outside the timed
 * region; only TraceWriter drain + scanCosts is measured. No Math.random() /
 * Date.now() on the measurement path (CLI metadata may use ISO timestamps).
 *
 * Run: npm run bench:wall-clock
 * Smoke: npm run bench:wall-clock -- --quick
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runBmssp } from "../src/core/bmssp/bmssp.ts";
import { run as runDmsy } from "../src/core/dmsy/dmsy.ts";
import { run as runDijkstra } from "../src/core/dijkstra.ts";
import {
  CITY_MAX_N,
  generateGraph,
  SIZE_PRESETS,
  type Graph,
  type GraphKind,
} from "../src/core/graph.ts";
import { scanCosts, TraceWriter, type TraceEvent } from "../src/core/trace.ts";

const SOURCE = 0;

/** One wall-clock measurement row for a single (kind, n, seed) cell. */
export type WallClockCell = {
  kind: GraphKind;
  n: number;
  seed: number;
  dijkstraWallMs: number;
  bmsspWallMs: number;
  dmsyWallMs: number;
  dijkstraWork: number;
  bmsspWork: number;
  dmsyWork: number;
};

/** JSON artifact written by the CLI entry point. */
export type WallClockResults = {
  generatedAt: string;
  node: string;
  platform: string;
  arch: string;
  cells: WallClockCell[];
};

/** Grid dimensions for {@link runWallClock}. */
export type WallClockConfig = {
  kind: GraphKind;
  sizes: readonly number[];
  seed: number;
};

/**
 * True when a (kind, n) pair is excluded from the wall-clock grid (issue #21).
 *
 * Skips city graphs above {@link CITY_MAX_N}; XL sparse is allowed.
 */
export function shouldSkipWallClockCell(kind: GraphKind, n: number): boolean {
  return kind === "city" && n > CITY_MAX_N;
}

/**
 * Default full wall-clock grid (issue #21).
 *
 * Sparse graphs at S, M, L, and XL with seed 4.
 */
export function defaultWallClockConfig(): WallClockConfig {
  return {
    kind: "sparse",
    sizes: [SIZE_PRESETS.S, SIZE_PRESETS.M, SIZE_PRESETS.L, SIZE_PRESETS.XL],
    seed: 4,
  };
}

/**
 * Minimal grid for smoke tests / CI (`--quick`).
 */
export function quickWallClockConfig(): WallClockConfig {
  return {
    kind: "sparse",
    sizes: [32],
    seed: 4,
  };
}

/**
 * Drain a trace generator into TraceWriter chunks and return billed work.
 */
function drainLaneWork(gen: Generator<TraceEvent, unknown, undefined>): number {
  const writer = new TraceWriter();
  for (;;) {
    const step = gen.next();
    if (step.done) {
      break;
    }
    writer.append(step.value);
  }

  const chunks = writer.takeChunks();
  let work = 0;
  for (const chunk of chunks) {
    work += scanCosts(chunk).work;
  }
  return work;
}

/**
 * Assert billed work is a finite positive number.
 */
function assertPositiveFiniteWork(label: string, work: number): void {
  if (!Number.isFinite(work) || work <= 0) {
    throw new Error(`${label} work must be a finite positive number, got ${String(work)}`);
  }
}

/**
 * Assert wall-clock milliseconds is finite and non-negative.
 */
function assertFiniteWallMs(label: string, wallMs: number): void {
  if (!Number.isFinite(wallMs) || wallMs < 0) {
    throw new Error(`${label} wall ms must be finite and >= 0, got ${String(wallMs)}`);
  }
}

/**
 * Validate vertex count and seed before graph generation.
 */
function assertCellInputs(n: number, seed: number): void {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`n must be an integer >= 2, got ${String(n)}`);
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`seed must be an integer, got ${String(seed)}`);
  }
}

/**
 * Measure wall-clock drain time and billed work for Dijkstra, BMSSP, and DMSY on one graph.
 *
 * Graph is generated once; each lane is timed independently via `performance.now()`.
 * BMSSP uses demo defaults (`bmsspParams(n)` when params are omitted).
 * DMSY uses demo defaults (`dmsyParams(n)` / default `run()` when params are omitted); paper via `run(graph, source, paperDmsyParams(n))`.
 */
export function measureCell(kind: GraphKind, n: number, seed: number): WallClockCell {
  if (shouldSkipWallClockCell(kind, n)) {
    throw new Error(
      `wall-clock cell skipped: kind=${kind} n=${String(n)} (city capped at ${String(CITY_MAX_N)})`,
    );
  }
  assertCellInputs(n, seed);

  const graph: Graph = generateGraph(kind, n, seed);

  const dijkstraT0 = performance.now();
  const dijkstraWork = drainLaneWork(runDijkstra(graph, SOURCE));
  const dijkstraWallMs = performance.now() - dijkstraT0;

  const bmsspT0 = performance.now();
  const bmsspWork = drainLaneWork(runBmssp(graph, SOURCE));
  const bmsspWallMs = performance.now() - bmsspT0;

  const dmsyT0 = performance.now();
  const dmsyWork = drainLaneWork(runDmsy(graph, SOURCE));
  const dmsyWallMs = performance.now() - dmsyT0;

  assertPositiveFiniteWork("dijkstra", dijkstraWork);
  assertPositiveFiniteWork("bmssp", bmsspWork);
  assertPositiveFiniteWork("dmsy", dmsyWork);
  assertFiniteWallMs("dijkstra", dijkstraWallMs);
  assertFiniteWallMs("bmssp", bmsspWallMs);
  assertFiniteWallMs("dmsy", dmsyWallMs);

  return {
    kind,
    n,
    seed,
    dijkstraWallMs,
    bmsspWallMs,
    dmsyWallMs,
    dijkstraWork,
    bmsspWork,
    dmsyWork,
  };
}

/**
 * Run the wall-clock grid; skipped cells are omitted from the result array.
 */
export function runWallClock(config: WallClockConfig): WallClockCell[] {
  const cells: WallClockCell[] = [];

  for (const n of config.sizes) {
    if (shouldSkipWallClockCell(config.kind, n)) {
      continue;
    }
    cells.push(measureCell(config.kind, n, config.seed));
  }

  return cells;
}

/**
 * Default JSON output path beside this bench module (`bench/wall-clock-results.json`).
 */
export function defaultResultsPath(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  return join(dir, "wall-clock-results.json");
}

/**
 * Whether the CLI should persist wall-clock results to disk.
 *
 * `--quick` smoke runs still measure and log cells but must not overwrite
 * committed `bench/wall-clock-results.json`.
 */
export function shouldWriteWallClockResults(quick: boolean): boolean {
  return !quick;
}

/** Format one cell for CLI streaming output. */
function formatCellSummary(cell: WallClockCell): string {
  return (
    `wall-clock: kind=${cell.kind} n=${String(cell.n)} seed=${String(cell.seed)} ` +
    `dijkstra=${cell.dijkstraWallMs.toFixed(2)}ms/${String(cell.dijkstraWork)} ` +
    `bmssp=${cell.bmsspWallMs.toFixed(2)}ms/${String(cell.bmsspWork)} ` +
    `dmsy=${cell.dmsyWallMs.toFixed(2)}ms/${String(cell.dmsyWork)}`
  );
}

if (process.argv[1]?.includes("wall-clock.ts")) {
  const quick = process.argv.includes("--quick");
  const config = quick ? quickWallClockConfig() : defaultWallClockConfig();
  const cells = runWallClock(config);

  for (const cell of cells) {
    console.log(formatCellSummary(cell));
  }

  if (shouldWriteWallClockResults(quick)) {
    const results: WallClockResults = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cells,
    };

    const outPath = defaultResultsPath();
    writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

    console.log(`wall-clock done: cells=${String(cells.length)} wrote ${outPath}`);
  } else {
    console.log(`wall-clock done: cells=${String(cells.length)} (quick, skipped write)`);
  }
}
