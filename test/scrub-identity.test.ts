import { describe, expect, it } from "vitest";

import { run } from "../src/core/dijkstra.ts";
import { generateGraph, packCsr } from "../src/core/graph.ts";
import { costOf, type TraceChunk, type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { D_BLOCK_CAP, type LaneState } from "../src/harness/laneState.ts";
import { Playback } from "../src/harness/playback.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";
import { drainBmsspRun } from "./bmssp-helpers.ts";

/** Assert two lane snapshots are identical for scrub-safe playback. */
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

  expect(a.recursionDepth).toBe(b.recursionDepth);
  expect(a.currentBound).toBe(b.currentBound);
  expect(a.batchOpen).toBe(b.batchOpen);
  expect(a.batchLevel).toBe(b.batchLevel);
  expect(a.batchRound).toBe(b.batchRound);
  expect(a.findPivotsK).toBe(b.findPivotsK);
  expect(a.lastBatchSize).toBe(b.lastBatchSize);
  expect(a.pivotsFoundThisCall).toBe(b.pivotsFoundThisCall);
  expect(a.lastPullN).toBe(b.lastPullN);
  expect(a.dstructOps).toBe(b.dstructOps);
  expect(a.bloomMinX).toBe(b.bloomMinX);
  expect(a.bloomMinY).toBe(b.bloomMinY);
  expect(a.bloomMaxX).toBe(b.bloomMaxX);
  expect(a.bloomMaxY).toBe(b.bloomMaxY);
  expect(a.bloomActive).toBe(b.bloomActive);
  expect(a.dBlockCount).toBe(b.dBlockCount);

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

    const aFrontier = a.frontier[v];
    const bFrontier = b.frontier[v];
    expect(aFrontier).toBe(bFrontier);

    const aPivotFlare = a.pivotFlareWork[v];
    const bPivotFlare = b.pivotFlareWork[v];
    expect(aPivotFlare).toBe(bPivotFlare);

    const aBloom = a.bloomVertex[v];
    const bBloom = b.bloomVertex[v];
    expect(aBloom).toBe(bBloom);

    expect(a.outOfOrder[v]).toBe(b.outOfOrder[v]);
  }

  for (let i = 0; i < D_BLOCK_CAP; i += 1) {
    const aSize = a.dBlockSizes[i];
    const bSize = b.dBlockSizes[i];
    expect(aSize).toBe(bSize);
  }

  for (let e = 0; e < a.m; e += 1) {
    const aRelaxWork = a.lastRelaxWork[e];
    const bRelaxWork = b.lastRelaxWork[e];
    expect(aRelaxWork).toBe(bRelaxWork);
  }
}

/** Cumulative billed work after applying events `0..index` inclusive. */
function workAtEventIndex(events: readonly TraceEvent[], index: number): number {
  let cumulative = 0;
  const last = Math.min(index, events.length - 1);
  for (let i = 0; i <= last; i += 1) {
    const event = events[i];
    if (event === undefined) {
      throw new Error(`missing event at index ${i}`);
    }
    cumulative += costOf(event);
  }
  return cumulative;
}

/** Encode events into trace chunks via TraceWriter. */
function chunksFromEvents(events: readonly TraceEvent[]): TraceChunk[] {
  const writer = new TraceWriter();
  for (const event of events) {
    writer.append(event);
  }
  return writer.takeChunks();
}

describe("scrub identity mixed synthetic trace", () => {
  const graph = packCsr(3, [{ from: 0, to: 1, weight: 1 }], [0, 1, 2], [0, 0, 0]);

  const chunks = chunksFromEvents([
    { k: "settle", v: 0, order: 0, cost: 1 },
    { k: "relax", e: 0, improved: true, cost: 1 },
    { k: "heap", op: "push", cmps: 2 },
    { k: "pivot", v: 2, level: 0 },
    { k: "settle", v: 1, order: 1, cost: 1 },
  ]);

  const probe = new TraceBuffer(graph, chunks);
  const totalWork = probe.totalWork;
  const mid = Math.floor(totalWork / 2);

  /** Cumulative work at the zero-cost pivot (settle + relax + heap = 4; pivot adds 0). */
  const pivotT = 4;

  const targets = [0, 1, pivotT, mid, totalWork];

  for (const t of targets) {
    it(`forward-only seek matches scrub-back at T=${String(t)}`, () => {
      const fresh = new TraceBuffer(graph, chunks);
      fresh.seekWork(t);

      const scrub = new TraceBuffer(graph, chunks);
      scrub.seekWork(scrub.totalWork);
      scrub.seekWork(t);

      compareLane(fresh.state, scrub.state);
    });

    it(`Playback.seek matches fresh forward seek at T=${String(t)}`, () => {
      const fresh = new TraceBuffer(graph, chunks);
      fresh.seekWork(t);

      const playback = new Playback(graph, chunks);
      playback.seek(t);

      compareLane(fresh.state, playback.state);
    });
  }
});

describe("scrub identity Dijkstra maze trace", () => {
  const graph = generateGraph("maze", 40, 1);

  const writer = new TraceWriter();
  const gen = run(graph, 0);
  for (;;) {
    const step = gen.next();
    if (step.done) {
      break;
    }
    writer.append(step.value);
  }
  const chunks = writer.takeChunks();

  const probe = new TraceBuffer(graph, chunks);
  const totalWork = probe.totalWork;
  const mid = Math.floor(totalWork / 2);

  const targets = [0, 1, mid, totalWork];

  for (const t of targets) {
    it(`Dijkstra maze: scrub identity at T=${String(t)}`, () => {
      const fresh = new TraceBuffer(graph, chunks);
      fresh.seekWork(t);

      const scrub = new TraceBuffer(graph, chunks);
      scrub.seekWork(scrub.totalWork);
      scrub.seekWork(t);

      compareLane(fresh.state, scrub.state);
    });

    it(`Dijkstra maze: Playback.seek matches fresh at T=${String(t)}`, () => {
      const fresh = new TraceBuffer(graph, chunks);
      fresh.seekWork(t);

      const playback = new Playback(graph, chunks);
      playback.seek(t);

      compareLane(fresh.state, playback.state);
    });
  }
});

describe("scrub identity BMSSP maze trace", () => {
  const graph = generateGraph("maze", 40, 1);
  const { events } = drainBmsspRun(graph, 0);
  const chunks = chunksFromEvents(events);

  const probe = new TraceBuffer(graph, chunks);
  const totalWork = probe.totalWork;
  const mid = Math.floor(totalWork / 2);

  /** Event-boundary tick: cumulative work after the first quarter of events. */
  const eventBoundaryT = workAtEventIndex(events, Math.floor(events.length / 4));

  const targets = [0, mid, eventBoundaryT, totalWork];

  for (const t of targets) {
    it(`BMSSP maze: scrub identity at T=${String(t)}`, () => {
      const fresh = new TraceBuffer(graph, chunks);
      fresh.seekWork(t);

      const scrub = new TraceBuffer(graph, chunks);
      scrub.seekWork(scrub.totalWork);
      scrub.seekWork(t);

      compareLane(fresh.state, scrub.state);
    });

    it(`BMSSP maze: Playback.seek matches fresh at T=${String(t)}`, () => {
      const fresh = new TraceBuffer(graph, chunks);
      fresh.seekWork(t);

      const playback = new Playback(graph, chunks);
      playback.seek(t);

      compareLane(fresh.state, playback.state);
    });
  }
});
