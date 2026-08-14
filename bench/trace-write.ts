/**
 * Node bench for issue #3 AC (design.md §10: 1M write+scan in Node).
 * CI headroom budget is issue #35. Run via `npm run bench:trace`.
 */

import { type TraceEvent, TraceWriter, scanCosts } from "../src/core/trace.ts";

/** design.md §10 issue #3: 1M mixed TraceEvents written and scanCosts-replayed. */
export const TRACE_WRITE_EVENT_COUNT = 1_000_000;

/** design.md §10 issue #3: 1M write+scan in Node. */
export const TRACE_WRITE_CLAIM_MS = 100;

/** GitHub Actions ubuntu-latest headroom (issue #35). */
export const TRACE_WRITE_CI_BUDGET_MS = 200;

const HEAP_OPS = ["push", "popmin", "sift"] as const;
const BATCH_PHASES = ["start", "end"] as const;
const RECURSE_DIRS = ["in", "out"] as const;
const FOREST_OPS = ["grow", "cut"] as const;
const DSTRUCT_OPS = ["insert", "batchPrepend", "pull"] as const;

function pickOp<T>(ops: readonly T[], index: number): T {
  const op = ops[index];
  if (op === undefined) {
    throw new Error(`op table index ${index} out of range`);
  }
  return op;
}

/**
 * Deterministic mixed event from index — no Math.random / Date.now.
 * Shared by `npm run bench:trace` and `test/trace-perf.test.ts`.
 */
export function mixedTraceEvent(i: number): TraceEvent {
  switch (i % 8) {
    case 0:
      return { k: "relax", e: i % 4096, improved: i % 2 === 0, cost: 1 };
    case 1:
      return { k: "settle", v: i % 1024, order: i % 512, cost: 1 };
    case 2:
      return { k: "heap", op: pickOp(HEAP_OPS, i % 3), cmps: i % 16 };
    case 3:
      return { k: "pivot", v: i % 1024, level: i % 32 };
    case 4:
      return {
        k: "batch",
        phase: pickOp(BATCH_PHASES, i % 2),
        level: i % 32,
        size: (i % 256) + 1,
      };
    case 5:
      return {
        k: "recurse",
        dir: pickOp(RECURSE_DIRS, i % 2),
        level: i % 32,
        bound: i % 100 === 0 ? Infinity : i % 1000,
      };
    case 6:
      return {
        k: "forest",
        op: pickOp(FOREST_OPS, i % 2),
        e: i % 4096,
        tree: i % 64,
      };
    default:
      return {
        k: "dstruct",
        op: pickOp(DSTRUCT_OPS, i % 3),
        n: (i % 128) + 1,
        cmps: i % 12,
      };
  }
}

/** Result of one timed write+scan pass (issue #3 / design.md §10). */
export type TraceWritePassResult = {
  elapsedMs: number;
  work: number;
  totalRows: number;
};

/** Aggregated best-of timed runs after warmup (issue #3 claim; #35 CI budget). */
export type TraceWriteMeasureResult = {
  times: number[];
  bestMs: number;
  work: number;
  totalRows: number;
};

/**
 * One write+scan pass: append {@link eventCount} mixed events, drain chunks, scanCosts each.
 * Timing covers append, takeChunks, and column-scan replay only (issue #3 / design.md §10).
 */
export function runTraceWritePass(
  eventCount: number = TRACE_WRITE_EVENT_COUNT,
): TraceWritePassResult {
  if (!Number.isInteger(eventCount) || eventCount < 0) {
    throw new Error(`eventCount must be an integer >= 0, got ${String(eventCount)}`);
  }

  const writer = new TraceWriter();
  const t0 = performance.now();

  for (let i = 0; i < eventCount; i += 1) {
    writer.append(mixedTraceEvent(i));
  }

  const chunks = writer.takeChunks();
  let work = 0;
  let totalRows = 0;
  for (const chunk of chunks) {
    totalRows += chunk.count;
    work += scanCosts(chunk).work;
  }

  const elapsedMs = performance.now() - t0;
  return { elapsedMs, work, totalRows };
}

/**
 * Warmup plus {@link timedRuns} timed passes; returns best elapsed ms (issue #3 claim).
 * {@link TRACE_WRITE_CI_BUDGET_MS} is the GitHub Actions headroom from issue #35.
 */
export function measureTraceWriteBest(options?: {
  eventCount?: number;
  timedRuns?: number;
}): TraceWriteMeasureResult {
  const eventCount = options?.eventCount ?? TRACE_WRITE_EVENT_COUNT;
  const timedRuns = options?.timedRuns ?? 3;

  if (!Number.isInteger(timedRuns) || timedRuns < 1) {
    throw new Error(`timedRuns must be an integer >= 1, got ${String(timedRuns)}`);
  }

  runTraceWritePass(eventCount);

  const times: number[] = [];
  let last: TraceWritePassResult | undefined;
  for (let run = 0; run < timedRuns; run += 1) {
    last = runTraceWritePass(eventCount);
    times.push(last.elapsedMs);
  }

  if (last === undefined) {
    throw new Error("timed runs produced no result");
  }

  const bestMs = Math.min(...times);
  return {
    times,
    bestMs,
    work: last.work,
    totalRows: last.totalRows,
  };
}

if (process.argv[1]?.includes("trace-write")) {
  const { times, bestMs, work } = measureTraceWriteBest();
  const timesStr = times.map((t) => t.toFixed(2)).join(", ");
  console.log(
    `trace-write: ${TRACE_WRITE_EVENT_COUNT} events  ms=[${timesStr}]  best=${bestMs.toFixed(2)}  work=${work}`,
  );

  if (bestMs >= TRACE_WRITE_CLAIM_MS) {
    console.error(
      `trace-write FAILED: best ${bestMs.toFixed(2)} ms >= ${TRACE_WRITE_CLAIM_MS} ms claim (issue #3 / design.md §10)`,
    );
    process.exit(1);
  }
}
