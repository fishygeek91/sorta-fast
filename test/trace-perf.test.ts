import { describe, expect, it } from "vitest";

import { mixedTraceEvent } from "../bench/trace-write.ts";
import { TraceWriter, scanCosts } from "../src/core/trace.ts";

const EVENT_COUNT = 1_000_000;
/** CI runners miss the 100ms Node-bench claim (issue #3); see #35. */
const BUDGET_MS = 200;
const TIMED_RUNS = 3;

type WriteScanResult = {
  elapsedMs: number;
  work: number;
  totalRows: number;
};

/**
 * One write+scan pass. Timing includes append and column-scan replay only.
 */
function writeAndScan(): WriteScanResult {
  const writer = new TraceWriter();
  const t0 = performance.now();

  for (let i = 0; i < EVENT_COUNT; i += 1) {
    writer.append(mixedTraceEvent(i));
  }

  const chunks = writer.takeChunks();
  let work = 0;
  let totalRows = 0;
  for (const chunk of chunks) {
    totalRows += chunk.count;
    work += scanCosts(chunk).work;
  }

  return { elapsedMs: performance.now() - t0, work, totalRows };
}

describe("trace write/replay budget", () => {
  it("writes and scanCosts-replays 1M events under the CI budget (best of 3 after warmup)", () => {
    writeAndScan();

    const times: number[] = [];
    let last: WriteScanResult | undefined;
    for (let run = 0; run < TIMED_RUNS; run += 1) {
      last = writeAndScan();
      times.push(last.elapsedMs);
    }
    if (last === undefined) {
      throw new Error("timed runs produced no result");
    }

    const best = Math.min(...times);
    expect(last.totalRows).toBe(EVENT_COUNT);
    expect(last.work).toBeGreaterThan(0);
    expect(
      best,
      `1M write+replay times ms=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    ).toBeLessThan(BUDGET_MS);
  });
});
