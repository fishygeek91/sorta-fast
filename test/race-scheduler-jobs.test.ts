import { describe, expect, it } from "vitest";

import { type Graph } from "../src/core/graph.ts";
import { type TraceChunk } from "../src/core/trace.ts";
import { type LaneState } from "../src/harness/laneState.ts";
import { RaceScheduler } from "../src/harness/raceScheduler.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";
import { BASE_OPS_PER_SECOND } from "../src/harness/workClock.ts";
import { runTraceJob, type TraceJobSpec } from "../src/workers/traceJob.ts";

/** Shared maze spec — both algorithms use the same {@link generateGraph} inputs. */
const SHARED_SPEC: TraceJobSpec = {
  kind: "maze",
  n: 40,
  seed: 42,
  source: 0,
};

/**
 * Run a trace job and collect the emitted graph and chunks in order.
 *
 * @param algo - Lane algorithm selector.
 * @param spec - Trace job parameters (optional small `chunkCapacity` for streaming tests).
 * @returns CSR graph and trace slabs from `onGraph` / `onChunk`.
 * @throws When `onGraph` was never called.
 */
function collectTraceJob(
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

  return { graph, chunks };
}

/** Assert two lane snapshots match on scrub-critical playback fields. */
function compareLane(a: LaneState, b: LaneState): void {
  expect(a.n).toBe(b.n);
  expect(a.m).toBe(b.m);
  expect(a.settledCount).toBe(b.settledCount);
  expect(a.outOfOrderSettles).toBe(b.outOfOrderSettles);
  expect(a.maxSettledDist).toBe(b.maxSettledDist);
  expect(a.eventIndex).toBe(b.eventIndex);
  expect(a.work).toBe(b.work);
  expect(a.relaxations).toBe(b.relaxations);
  expect(a.heapOps).toBe(b.heapOps);

  for (let v = 0; v < a.n; v += 1) {
    const aOrder = a.settleOrder[v];
    const bOrder = b.settleOrder[v];
    expect(aOrder).toBe(bOrder);

    const aPred = a.pred[v];
    const bPred = b.pred[v];
    expect(aPred).toBe(bPred);

    const aDist = a.dist[v];
    const bDist = b.dist[v];
    expect(aDist).toBe(bDist);

    const aSettleWork = a.settleWork[v];
    const bSettleWork = b.settleWork[v];
    expect(aSettleWork).toBe(bSettleWork);
  }
}

/** Assert graphs share CSR topology (same seed → identical layout). */
function expectSameGraph(a: Graph, b: Graph): void {
  expect(a.n).toBe(b.n);
  expect(a.m).toBe(b.m);
  expect(a.offsets).toEqual(b.offsets);
  expect(a.targets).toEqual(b.targets);
}

/**
 * Load a paused 2-lane scheduler with full dijkstra/bmssp traces marked complete.
 *
 * @param dijkstra - Lane 0 chunks and graph.
 * @param bmssp - Lane 1 chunks (graph must match lane 0).
 */
function loadCompleteRace(
  dijkstra: { graph: Graph; chunks: TraceChunk[] },
  bmssp: { graph: Graph; chunks: TraceChunk[] },
): RaceScheduler {
  const race = new RaceScheduler(dijkstra.graph, 2);
  for (const chunk of dijkstra.chunks) {
    race.appendChunk(0, chunk);
  }
  for (const chunk of bmssp.chunks) {
    race.appendChunk(1, chunk);
  }
  race.markLaneComplete(0);
  race.markLaneComplete(1);
  return race;
}

describe("RaceScheduler real trace jobs — same graph+seed seek alignment", () => {
  const dijkstra = collectTraceJob("dijkstra", SHARED_SPEC);
  const bmssp = collectTraceJob("bmssp", SHARED_SPEC);

  expectSameGraph(dijkstra.graph, bmssp.graph);

  const total0 = (() => {
    const probe = new TraceBuffer(dijkstra.graph, dijkstra.chunks);
    return probe.totalWork;
  })();
  const total1 = (() => {
    const probe = new TraceBuffer(bmssp.graph, bmssp.chunks);
    return probe.totalWork;
  })();
  const minTotal = Math.min(total0, total1);
  const maxTotal = Math.max(total0, total1);
  const shorterLane = total0 <= total1 ? 0 : 1;

  const seekTargets = [
    0,
    1,
    Math.floor(minTotal / 4),
    Math.floor(minTotal / 2),
    minTotal > 0 ? minTotal - 1 : 0,
    minTotal,
    minTotal + Math.floor((maxTotal - minTotal) / 2),
    maxTotal,
  ];

  for (const t of seekTargets) {
    it(`dijkstra vs bmssp maze: shared seek at T=${String(t)}`, () => {
      const race = loadCompleteRace(dijkstra, bmssp);
      race.seek(t);

      const appliedT = race.appliedCursor;
      const expectedApplied = Math.min(t, maxTotal);
      expect(appliedT).toBe(expectedApplied);

      const ref0 = new TraceBuffer(dijkstra.graph, dijkstra.chunks);
      const ref1 = new TraceBuffer(bmssp.graph, bmssp.chunks);
      const work0 = Math.min(appliedT, total0);
      const work1 = Math.min(appliedT, total1);
      ref0.seekWork(work0);
      ref1.seekWork(work1);

      compareLane(race.laneState(0), ref0.state);
      compareLane(race.laneState(1), ref1.state);

      if (appliedT > minTotal) {
        expect(race.laneState(shorterLane).work).toBe(race.laneTotalWork(shorterLane));
        expect(race.laneFinished(shorterLane)).toBe(appliedT >= race.laneTotalWork(shorterLane));
      }
    });
  }
});

describe("RaceScheduler real trace jobs — stream-while-generating interleaved chunks", () => {
  it("interleaved dijkstra/bmssp chunks grow appliedCursor before markLaneComplete", () => {
    const streamSpec: TraceJobSpec = { ...SHARED_SPEC, chunkCapacity: 8 };
    const dijkstra = collectTraceJob("dijkstra", streamSpec);
    const bmssp = collectTraceJob("bmssp", streamSpec);

    expect(dijkstra.chunks.length).toBeGreaterThan(1);
    expect(bmssp.chunks.length).toBeGreaterThan(1);

    const race = new RaceScheduler(dijkstra.graph, 2);
    const pairCount = Math.min(dijkstra.chunks.length, bmssp.chunks.length);
    let appliedAfterFirstPair = 0;

    for (let i = 0; i < pairCount; i += 1) {
      const chunk0 = dijkstra.chunks[i];
      const chunk1 = bmssp.chunks[i];
      if (chunk0 === undefined || chunk1 === undefined) {
        throw new Error(`missing chunk pair at index ${String(i)}`);
      }

      const prevApplied = race.appliedCursor;
      race.appendChunk(0, chunk0);
      race.appendChunk(1, chunk1);

      if (i === 0) {
        expect(race.streamCap).toBeGreaterThan(0);

        race.play();
        race.advance(1);

        expect(race.appliedCursor).toBeGreaterThan(0);
        expect(race.laneState(0).work).toBe(race.appliedCursor);
        expect(race.laneState(1).work).toBe(race.appliedCursor);
        expect(race.laneComplete(0)).toBe(false);
        expect(race.laneComplete(1)).toBe(false);
        appliedAfterFirstPair = race.appliedCursor;
      } else {
        race.seek(race.clock.cursor);
        expect(race.appliedCursor).toBeGreaterThanOrEqual(prevApplied);
        expect(race.laneState(0).work).toBe(Math.min(race.appliedCursor, race.laneTotalWork(0)));
        expect(race.laneState(1).work).toBe(Math.min(race.appliedCursor, race.laneTotalWork(1)));
      }
    }

    expect(race.appliedCursor).toBeGreaterThanOrEqual(appliedAfterFirstPair);
    expect(race.appliedCursor).toBeLessThanOrEqual(race.streamCap);
    expect(race.clock.cursor).toBe(BASE_OPS_PER_SECOND);

    for (let i = pairCount; i < dijkstra.chunks.length; i += 1) {
      const chunk = dijkstra.chunks[i];
      if (chunk === undefined) {
        throw new Error(`missing dijkstra chunk at index ${String(i)}`);
      }
      race.appendChunk(0, chunk);
    }
    for (let i = pairCount; i < bmssp.chunks.length; i += 1) {
      const chunk = bmssp.chunks[i];
      if (chunk === undefined) {
        throw new Error(`missing bmssp chunk at index ${String(i)}`);
      }
      race.appendChunk(1, chunk);
    }

    race.markLaneComplete(0);
    race.markLaneComplete(1);

    expect(race.allComplete).toBe(true);
    expect(race.laneTotalWork(0)).toBeGreaterThan(0);
    expect(race.laneTotalWork(1)).toBeGreaterThan(0);
  });
});

describe("RaceScheduler real trace jobs — bidirectional scrub identity", () => {
  const dijkstra = collectTraceJob("dijkstra", SHARED_SPEC);
  const bmssp = collectTraceJob("bmssp", SHARED_SPEC);

  const minTotal = (() => {
    const w0 = new TraceBuffer(dijkstra.graph, dijkstra.chunks).totalWork;
    const w1 = new TraceBuffer(bmssp.graph, bmssp.chunks).totalWork;
    return Math.min(w0, w1);
  })();
  const t = Math.floor(minTotal / 2);

  it(`dijkstra vs bmssp maze: scrub identity at T=${String(t)}`, () => {
    const race = loadCompleteRace(dijkstra, bmssp);

    race.seek(t);
    const snap0 = race.laneState(0).clone();
    const snap1 = race.laneState(1).clone();

    const ref0 = new TraceBuffer(dijkstra.graph, dijkstra.chunks);
    const ref1 = new TraceBuffer(bmssp.graph, bmssp.chunks);
    ref0.seekWork(t);
    ref1.seekWork(t);
    compareLane(snap0, ref0.state);
    compareLane(snap1, ref1.state);

    race.seek(0);
    race.seek(t);

    compareLane(race.laneState(0), snap0);
    compareLane(race.laneState(1), snap1);
    compareLane(race.laneState(0), ref0.state);
    compareLane(race.laneState(1), ref1.state);
  });
});
