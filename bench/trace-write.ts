/**
 * Node bench: write 1M mixed TraceEvents via TraceWriter, scanCosts each chunk.
 * Issue #3 AC — design.md §4.2 (< 100ms write+scan in Node).
 *
 * Run: npm run bench:trace
 * (uses Node 22 --experimental-strip-types; .ts extension imports may fail on older Node)
 */

import { type TraceEvent, TraceWriter, scanCosts } from "../src/core/trace.ts";

const EVENT_COUNT = 1_000_000;

const HEAP_OPS = ["push", "popmin", "sift"] as const;
const BATCH_PHASES = ["start", "end"] as const;
const RECURSE_DIRS = ["in", "out"] as const;
const FOREST_OPS = ["grow", "cut"] as const;
const DSTRUCT_OPS = ["insert", "batchPrepend", "pull"] as const;

/** Deterministic mixed event from index — no Math.random / Date.now. */
function mixedEvent(i: number): TraceEvent {
  switch (i % 8) {
    case 0:
      return { k: "relax", e: i % 4096, improved: i % 2 === 0, cost: 1 };
    case 1:
      return { k: "settle", v: i % 1024, order: i % 512, cost: 1 };
    case 2:
      return { k: "heap", op: HEAP_OPS[i % 3], cmps: i % 16 };
    case 3:
      return { k: "pivot", v: i % 1024, level: i % 32 };
    case 4:
      return {
        k: "batch",
        phase: BATCH_PHASES[i % 2],
        level: i % 32,
        size: (i % 256) + 1,
      };
    case 5:
      return {
        k: "recurse",
        dir: RECURSE_DIRS[i % 2],
        level: i % 32,
        bound: i % 100 === 0 ? Infinity : i % 1000,
      };
    case 6:
      return {
        k: "forest",
        op: FOREST_OPS[i % 2],
        e: i % 4096,
        tree: i % 64,
      };
    default:
      return {
        k: "dstruct",
        op: DSTRUCT_OPS[i % 3],
        n: (i % 128) + 1,
        cmps: i % 12,
      };
  }
}

/**
 * Write {@link EVENT_COUNT} events, replay with scanCosts (no decodeChunk).
 */
export function runTraceWriteBench(): {
  events: number;
  elapsedMs: number;
  work: number;
} {
  const writer = new TraceWriter();
  const t0 = performance.now();

  for (let i = 0; i < EVENT_COUNT; i += 1) {
    writer.append(mixedEvent(i));
  }

  const chunks = writer.takeChunks();
  let work = 0;
  for (const chunk of chunks) {
    work += scanCosts(chunk).work;
  }

  const elapsedMs = performance.now() - t0;
  return { events: EVENT_COUNT, elapsedMs, work };
}

if (process.argv[1]?.includes("trace-write")) {
  const { events, elapsedMs, work } = runTraceWriteBench();
  console.log(
    `trace-write: ${events} events  write+scan  ${elapsedMs.toFixed(2)} ms  work=${work}`,
  );
}
