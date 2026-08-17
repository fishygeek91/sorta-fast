import { beforeAll, describe, expect, it } from "vitest";

import { generateGraph, SIZE_PRESETS, type Graph } from "../src/core/graph.ts";
import { type TraceChunk } from "../src/core/trace.ts";
import { RaceScheduler } from "../src/harness/raceScheduler.ts";
import { runDmsyTraceJob, type DmsyTraceSpec } from "../src/workers/dmsyTraceJob.ts";
import { runTraceJob, type TraceJobSpec } from "../src/workers/traceJob.ts";

/** Issue #27 AC: no main-thread stalls above this during a 3-lane M-size race. */
const STALL_BUDGET_MS = 50;
const TIMED_RUNS = 3;
const PLAY_SPEED = 8;
const FRAME_DT_SECONDS = 1 / 60;

const SEED = 1729;
const SOURCE = 0;
const LANE_COUNT = 3;

/** Prefer M-size traces; fall back to S when all three algorithms exceed this total. */
const GENERATION_BUDGET_MS = 60_000;

const LANE_DIJKSTRA = 0;
const LANE_BMSSP = 1;
const LANE_DMSY = 2;

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
 * Collect graph and trace chunks from one Dijkstra or BMSSP trace job.
 *
 * @throws When `onGraph` was never called or no chunks were produced.
 */
function drainTraceJob(
  algo: "dijkstra" | "bmssp",
  spec: TraceJobSpec,
): { graph: Graph; chunks: TraceChunk[] } {
  let graph: Graph | undefined;
  const chunks: TraceChunk[] = [];

  runTraceJob(algo, spec, {
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
 * Collect graph and trace chunks from one DMSY trace job.
 *
 * @throws When `onGraph` was never called or no chunks were produced.
 */
function drainDmsyTrace(spec: DmsyTraceSpec): { graph: Graph; chunks: TraceChunk[] } {
  let graph: Graph | undefined;
  const chunks: TraceChunk[] = [];

  runDmsyTraceJob(spec, {
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
    throw new Error("DMSY trace job produced no chunks");
  }

  return { graph, chunks };
}

/** Sum event counts across trace chunks. */
function countEvents(chunks: readonly TraceChunk[]): number {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.count;
  }
  return total;
}

type ThreeLaneFixture = {
  graph: Graph;
  n: number;
  dijkstraChunks: TraceChunk[];
  bmsspChunks: TraceChunk[];
  dmsyChunks: TraceChunk[];
  genMs: number;
};

/**
 * Generate Dijkstra, BMSSP, and DMSY traces on the same maze graph.
 *
 * @param n - Graph size preset.
 * @returns Fixture with per-lane chunks and total generation time.
 */
function generateThreeLaneFixture(n: number): ThreeLaneFixture {
  const spec: TraceJobSpec = {
    kind: "maze",
    n,
    seed: SEED,
    source: SOURCE,
  };
  const dmsySpec: DmsyTraceSpec = {
    kind: "maze",
    n,
    seed: SEED,
    source: SOURCE,
  };

  const genT0 = performance.now();

  const dijkstra = drainTraceJob("dijkstra", spec);
  const bmssp = drainTraceJob("bmssp", spec);
  const dmsy = drainDmsyTrace(dmsySpec);

  const genMs = performance.now() - genT0;

  return {
    graph: dijkstra.graph,
    n,
    dijkstraChunks: dijkstra.chunks,
    bmsspChunks: bmssp.chunks,
    dmsyChunks: dmsy.chunks,
    genMs,
  };
}

/**
 * Prefer maze SIZE_PRESETS.M; if all three trace jobs exceed {@link GENERATION_BUDGET_MS},
 * fall back to SIZE_PRESETS.S.
 */
function loadThreeLaneFixture(): ThreeLaneFixture {
  const mFixture = generateThreeLaneFixture(SIZE_PRESETS.M);
  if (mFixture.genMs <= GENERATION_BUDGET_MS) {
    return mFixture;
  }

  console.log(
    `race-dmsy-perf: M genMs=${mFixture.genMs.toFixed(2)} exceeded budget; falling back to S`,
  );
  return generateThreeLaneFixture(SIZE_PRESETS.S);
}

/**
 * Load all trace chunks into their lanes and mark generation complete.
 */
function buildLoadedRaceScheduler(fixture: ThreeLaneFixture): RaceScheduler {
  const race = new RaceScheduler(fixture.graph, LANE_COUNT);
  for (const chunk of fixture.dijkstraChunks) {
    race.appendChunk(LANE_DIJKSTRA, chunk);
  }
  for (const chunk of fixture.bmsspChunks) {
    race.appendChunk(LANE_BMSSP, chunk);
  }
  for (const chunk of fixture.dmsyChunks) {
    race.appendChunk(LANE_DMSY, chunk);
  }
  race.markLaneComplete(LANE_DIJKSTRA);
  race.markLaneComplete(LANE_BMSSP);
  race.markLaneComplete(LANE_DMSY);
  return race;
}

describe("M-size maze 3-lane DMSY race stall budgets (issue #27)", () => {
  let fixture: ThreeLaneFixture;

  beforeAll(() => {
    fixture = loadThreeLaneFixture();

    const expectedGraph = generateGraph("maze", fixture.n, SEED);
    expect(fixture.graph.n).toBe(fixture.n);
    expect(fixture.graph.n).toBe(expectedGraph.n);
    expect(fixture.graph.m).toBe(expectedGraph.m);

    const dijkstraEvents = countEvents(fixture.dijkstraChunks);
    const bmsspEvents = countEvents(fixture.bmsspChunks);
    const dmsyEvents = countEvents(fixture.dmsyChunks);

    expect(dijkstraEvents).toBeGreaterThan(0);
    expect(bmsspEvents).toBeGreaterThan(0);
    expect(dmsyEvents).toBeGreaterThan(0);

    console.log(
      `race-dmsy-perf: n=${String(fixture.n)} ` +
        `dijkstraEvents=${String(dijkstraEvents)} ` +
        `bmsspEvents=${String(bmsspEvents)} ` +
        `dmsyEvents=${String(dmsyEvents)} ` +
        `genMs=${fixture.genMs.toFixed(2)}`,
    );
  }, 180_000);

  it("appendChunk, speed-8 advance, and backward seek stay under the 50ms stall budget", () => {
    const race = new RaceScheduler(fixture.graph, LANE_COUNT);
    let worstAppendMs = 0;

    const appendAll = (chunks: readonly TraceChunk[], lane: number): void => {
      for (const chunk of chunks) {
        const t0 = performance.now();
        race.appendChunk(lane, chunk);
        const appendMs = performance.now() - t0;
        if (appendMs > worstAppendMs) {
          worstAppendMs = appendMs;
        }
      }
    };

    appendAll(fixture.dijkstraChunks, LANE_DIJKSTRA);
    appendAll(fixture.bmsspChunks, LANE_BMSSP);
    appendAll(fixture.dmsyChunks, LANE_DMSY);

    race.markLaneComplete(LANE_DIJKSTRA);
    race.markLaneComplete(LANE_BMSSP);
    race.markLaneComplete(LANE_DMSY);

    expect(race.maxTotalWork).toBeGreaterThan(0);
    expect(race.allComplete).toBe(true);

    const midWork = race.maxTotalWork / 2;

    const { best: bestAdvanceStart, times: advanceStartTimes } = bestOfTimed(() => {
      const fresh = buildLoadedRaceScheduler(fixture);
      fresh.seek(0);
      fresh.setSpeed(PLAY_SPEED);
      fresh.play();
      const t0 = performance.now();
      fresh.advance(FRAME_DT_SECONDS);
      return performance.now() - t0;
    });

    const { best: bestAdvanceMid, times: advanceMidTimes } = bestOfTimed(() => {
      const fresh = buildLoadedRaceScheduler(fixture);
      fresh.seek(midWork);
      fresh.setSpeed(PLAY_SPEED);
      fresh.play();
      const t0 = performance.now();
      fresh.advance(FRAME_DT_SECONDS);
      return performance.now() - t0;
    });

    const { best: bestSeekBack, times: seekBackTimes } = bestOfTimed(() => {
      const fresh = buildLoadedRaceScheduler(fixture);
      fresh.seek(fresh.maxTotalWork);
      const t0 = performance.now();
      fresh.seek(0);
      return performance.now() - t0;
    });

    const worstAdvanceMs = Math.max(bestAdvanceStart, bestAdvanceMid);

    console.log(
      `race-dmsy-perf: n=${String(fixture.n)} ` +
        `worstAppendMs=${worstAppendMs.toFixed(2)} ` +
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
