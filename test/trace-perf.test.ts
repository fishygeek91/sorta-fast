import { describe, expect, it } from "vitest";

import { TraceWriter, scanCosts, type TraceEvent } from "../src/core/trace.ts";

const EVENT_COUNT = 1_000_000;
const BUDGET_MS = 100;

function eventAt(i: number): TraceEvent {
  const kind = i % 8;
  const cmps = i % 5;

  switch (kind) {
    case 0:
      return { k: "relax", e: i, improved: i % 2 === 0, cost: 1 };
    case 1:
      return { k: "settle", v: i % 1000, order: i % 100, cost: 1 };
    case 2: {
      const heapOps = ["push", "popmin", "sift"] as const;
      return { k: "heap", op: heapOps[i % 3], cmps };
    }
    case 3:
      return { k: "pivot", v: i % 500, level: i % 10 };
    case 4:
      return {
        k: "batch",
        phase: i % 2 === 0 ? "start" : "end",
        level: i % 5,
        size: i % 100,
      };
    case 5:
      return {
        k: "recurse",
        dir: i % 2 === 0 ? "in" : "out",
        level: i % 8,
        bound: i % 20,
      };
    case 6: {
      const forestOps = ["grow", "cut"] as const;
      return { k: "forest", op: forestOps[i % 2], e: i, tree: i % 7 };
    }
    case 7: {
      const dstructOps = ["insert", "batchPrepend", "pull"] as const;
      return { k: "dstruct", op: dstructOps[i % 3], n: i % 50, cmps };
    }
    default:
      return { k: "relax", e: 0, improved: false, cost: 1 };
  }
}

describe("trace write/replay budget", () => {
  it("writes and scanCosts-replays 1M events in under 100ms", () => {
    const writer = new TraceWriter();
    const t0 = performance.now();

    for (let i = 0; i < EVENT_COUNT; i += 1) {
      writer.append(eventAt(i));
    }

    const chunks = writer.takeChunks();
    let work = 0;
    let totalRows = 0;

    for (const chunk of chunks) {
      totalRows += chunk.count;
      work += scanCosts(chunk).work;
    }

    const elapsed = performance.now() - t0;

    expect(totalRows).toBe(EVENT_COUNT);
    expect(work).toBeGreaterThan(0);
    expect(elapsed, `1M write+replay took ${elapsed.toFixed(2)}ms`).toBeLessThan(BUDGET_MS);
  });
});
