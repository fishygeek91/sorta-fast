import { beforeAll, describe, expect, it } from "vitest";

import { generateGraph, SIZE_PRESETS, type Graph } from "../src/core/graph.ts";
import { type TraceChunk } from "../src/core/trace.ts";
import { RaceScheduler } from "../src/harness/raceScheduler.ts";
import { runTraceJob, type TraceJobSpec } from "../src/workers/traceJob.ts";

/** Issue #13 AC: no main-thread stalls above this during a 3-lane 25k race. */
const STALL_BUDGET_MS = 50;
const TIMED_RUNS = 3;
const PLAY_SPEED = 8;
const FRAME_DT_SECONDS = 1 / 60;

const SEED = 1729;
const SOURCE = 0;
const LANE_COUNT = 3;

/**
 * 25k-node maze Dijkstra trace generation can exceed 3 minutes or OOM on small CI
 * runners — keep n at SIZE_PRESETS.L (25000); do not fall back to smaller presets.
 */
const TRACE_SPEC: TraceJobSpec = {
  kind: "maze",
  n: SIZE_PRESETS.L,
  seed: SEED,
  source: SOURCE,
};

/**
 * Best-of-N after a warmup call of `run`.
 */
function bestOfTimed(run: () => number): { best: number; times: number[] } {
  run();
  const times: number[] = [];
  for (let i = 0; i < TIMED_RUNS; i += 1) {
    times.push(run());
  }
  return { best: Math.min(...times), times };
}

/**
 * Collect graph and trace chunks from one Dijkstra trace job.
 *
 * @throws When `onGraph` was never called or no chunks were produced.
 */
function drainDijkstraTrace(spec: TraceJobSpec): { graph: Graph; chunks: TraceChunk[] } {
  let graph: Graph | undefined;
  const chunks: TraceChunk[] = [];

  runTraceJob("dijkstra", spec, {
    onGraph: (received) => {
      graph = received;
    },
    onChunk: (chunk) => {
      chunks.push(chunk);
    },
  });

  if (graph === undefined) {
    throw new Error("onGraph was not called");
  }
  if (chunks.length === 0) {
    throw new Error("trace job produced no chunks");
  }

  return { graph, chunks };
}

/**
 * Load all trace chunks into every lane and mark generation complete.
 */
function buildLoadedRaceScheduler(graph: Graph, chunks: readonly TraceChunk[]): RaceScheduler {
  const race = new RaceScheduler(graph, LANE_COUNT);
  for (const chunk of chunks) {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      race.appendChunk(lane, chunk);
    }
  }
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    race.markLaneComplete(lane);
  }
  return race;
}

describe("25k maze 3-lane race stall budgets (issue #13)", () => {
  let graph: Graph;
  let chunks: TraceChunk[];

  beforeAll(() => {
    const genT0 = performance.now();
    const fixture = drainDijkstraTrace(TRACE_SPEC);
    const genMs = performance.now() - genT0;
    graph = fixture.graph;
    chunks = fixture.chunks;

    const expectedGraph = generateGraph("maze", SIZE_PRESETS.L, SEED);
    expect(fixture.graph.n).toBe(SIZE_PRESETS.L);
    expect(fixture.graph.n).toBe(expectedGraph.n);
    expect(fixture.graph.m).toBe(expectedGraph.m);

    let eventCount = 0;
    for (const chunk of chunks) {
      eventCount += chunk.count;
    }
    expect(eventCount).toBeGreaterThanOrEqual(SIZE_PRESETS.L);

    console.log(
      `race-scheduler-perf: n=${String(SIZE_PRESETS.L)} chunks=${String(chunks.length)} events=${String(eventCount)} genMs=${genMs.toFixed(2)}`,
    );
  }, 180_000);

  it("appendChunk, speed-8 advance, and backward seek stay under the 50ms stall budget", () => {
    const race = new RaceScheduler(graph, LANE_COUNT);
    let worstAppendMs = 0;

    for (const chunk of chunks) {
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        const t0 = performance.now();
        race.appendChunk(lane, chunk);
        const appendMs = performance.now() - t0;
        if (appendMs > worstAppendMs) {
          worstAppendMs = appendMs;
        }
      }
    }

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      race.markLaneComplete(lane);
    }

    expect(race.maxTotalWork).toBeGreaterThan(0);
    expect(race.allComplete).toBe(true);

    const midWork = race.maxTotalWork / 2;

    const { best: bestAdvanceStart, times: advanceStartTimes } = bestOfTimed(() => {
      const fresh = buildLoadedRaceScheduler(graph, chunks);
      fresh.seek(0);
      fresh.setSpeed(PLAY_SPEED);
      fresh.play();
      const t0 = performance.now();
      fresh.advance(FRAME_DT_SECONDS);
      return performance.now() - t0;
    });

    const { best: bestAdvanceMid, times: advanceMidTimes } = bestOfTimed(() => {
      const fresh = buildLoadedRaceScheduler(graph, chunks);
      fresh.seek(midWork);
      fresh.setSpeed(PLAY_SPEED);
      fresh.play();
      const t0 = performance.now();
      fresh.advance(FRAME_DT_SECONDS);
      return performance.now() - t0;
    });

    const { best: bestSeekBack, times: seekBackTimes } = bestOfTimed(() => {
      const fresh = buildLoadedRaceScheduler(graph, chunks);
      fresh.seek(fresh.maxTotalWork);
      const t0 = performance.now();
      fresh.seek(0);
      return performance.now() - t0;
    });

    const worstAdvanceMs = Math.max(bestAdvanceStart, bestAdvanceMid);

    console.log(
      `race-scheduler-perf: worstAppendMs=${worstAppendMs.toFixed(2)} ` +
        `advanceStartMs=[${advanceStartTimes.map((t) => t.toFixed(2)).join(", ")}] ` +
        `best=${bestAdvanceStart.toFixed(2)} ` +
        `advanceMidMs=[${advanceMidTimes.map((t) => t.toFixed(2)).join(", ")}] ` +
        `best=${bestAdvanceMid.toFixed(2)} ` +
        `seekBackMs=[${seekBackTimes.map((t) => t.toFixed(2)).join(", ")}] ` +
        `best=${bestSeekBack.toFixed(2)}`,
    );

    expect(worstAppendMs, `appendMs worst=${worstAppendMs.toFixed(2)}`).toBeLessThan(
      STALL_BUDGET_MS,
    );

    expect(
      bestAdvanceStart,
      `advanceStartMs=[${advanceStartTimes.map((t) => t.toFixed(2)).join(", ")}] best=${bestAdvanceStart.toFixed(2)}`,
    ).toBeLessThan(STALL_BUDGET_MS);

    expect(
      bestAdvanceMid,
      `advanceMidMs=[${advanceMidTimes.map((t) => t.toFixed(2)).join(", ")}] best=${bestAdvanceMid.toFixed(2)}`,
    ).toBeLessThan(STALL_BUDGET_MS);

    expect(
      bestSeekBack,
      `seekBackMs=[${seekBackTimes.map((t) => t.toFixed(2)).join(", ")}] best=${bestSeekBack.toFixed(2)}`,
    ).toBeLessThan(STALL_BUDGET_MS);

    expect(worstAdvanceMs).toBeLessThan(STALL_BUDGET_MS);
  }, 180_000);
});
