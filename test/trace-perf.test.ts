/**
 * Trace write+scan performance guards for CI (#35) vs the Node bench claim (#3).
 *
 * Issue #3: design.md §4.2 — 1M mixed events written and scanCosts-replayed in Node
 * under 100ms (`npm run bench:trace`).
 * Issue #35: CI keeps a 200ms budget here so shared runners do not flake; the 100ms
 * claim lives on the bench script constants exported from `bench/trace-write.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  TRACE_WRITE_CLAIM_MS,
  TRACE_WRITE_CI_BUDGET_MS,
  TRACE_WRITE_EVENT_COUNT,
  measureTraceWriteBest,
  runTraceWritePass,
} from "../bench/trace-write.ts";

describe("trace write/replay budget", () => {
  it("writes and scanCosts-replays 1M events under the CI budget (best of 3 after warmup)", () => {
    const { times, bestMs, work, totalRows } = measureTraceWriteBest();

    console.info(
      `trace-perf 1M times ms=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${bestMs.toFixed(2)}`,
    );

    expect(totalRows).toBe(TRACE_WRITE_EVENT_COUNT);
    expect(work).toBeGreaterThan(0);
    expect(
      bestMs,
      `1M write+replay times ms=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${bestMs.toFixed(2)}`,
    ).toBeLessThan(TRACE_WRITE_CI_BUDGET_MS);
  });

  it("keeps bench constants aligned: 100ms claim, 200ms CI budget, 1M events", () => {
    expect(TRACE_WRITE_CLAIM_MS).toBe(100);
    expect(TRACE_WRITE_CI_BUDGET_MS).toBe(200);
    expect(TRACE_WRITE_CI_BUDGET_MS).toBeGreaterThan(TRACE_WRITE_CLAIM_MS);
    expect(TRACE_WRITE_EVENT_COUNT).toBe(1_000_000);
  });

  it("measureTraceWriteBest reports best-of timed runs for small event counts", () => {
    const { times, bestMs, work, totalRows } = measureTraceWriteBest({
      eventCount: 64,
      timedRuns: 3,
    });

    expect(times.length).toBe(3);
    expect(bestMs).toBe(Math.min(...times));
    expect(work).toBeGreaterThan(0);
    expect(totalRows).toBe(64);
  });

  it("runTraceWritePass handles zero events and rejects invalid inputs", () => {
    const zero = runTraceWritePass(0);
    expect(zero.totalRows).toBe(0);
    expect(zero.work).toBe(0);
    expect(zero.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(() => runTraceWritePass(-1)).toThrow();
    expect(() => measureTraceWriteBest({ timedRuns: 0 })).toThrow();
  });
});
