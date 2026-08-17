import { describe, expect, it } from "vitest";

import { bmsspParams, paperBmsspParams } from "../src/core/bmssp/params.ts";
import { generateGraph, packCsr } from "../src/core/graph.ts";
import { type TraceChunk, type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { D_BLOCK_CAP, LaneState, UNSETTLED } from "../src/harness/laneState.ts";
import { KEYFRAME_OPS, TraceBuffer } from "../src/harness/traceBuffer.ts";
import { drainRun } from "./dijkstra-helpers.ts";
import { drainBmsspRun } from "./bmssp-helpers.ts";

/** Assert two lane snapshots are identical (scrub-safe fields + live counters). */
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

/** Sum per-vertex outOfOrder bits (must equal {@link LaneState.outOfOrderSettles}). */
function sumOutOfOrderBits(state: LaneState): number {
  let sum = 0;
  for (let v = 0; v < state.n; v += 1) {
    sum += state.outOfOrder[v];
  }
  return sum;
}

/** Assert outOfOrder bitset is consistent with the scalar counter. */
function expectOutOfOrderBitsetConsistent(state: LaneState): void {
  const bitSum = sumOutOfOrderBits(state);
  expect(bitSum).toBe(state.outOfOrderSettles);
  if (state.outOfOrderSettles > 0) {
    let anyBit = false;
    for (let v = 0; v < state.n; v += 1) {
      if (state.outOfOrder[v] === 1) {
        anyBit = true;
        break;
      }
    }
    expect(anyBit).toBe(true);
  }
}

/** Replay a BMSSP maze trace to completion and return lane state. */
function bmsspMazeLaneState(
  n: number,
  seed: number,
  params?: ReturnType<typeof paperBmsspParams>,
): LaneState {
  const graph = generateGraph("maze", n, seed);
  const { events } = drainBmsspRun(graph, 0, params);
  const buf = new TraceBuffer(graph, chunksFromEvents(events), 0);
  buf.seekWork(buf.totalWork);
  return buf.state;
}

/** Read keyframe table length for appendChunk cadence tests. */
function keyframeCount(buf: TraceBuffer): number {
  return buf.keyframeCount;
}

/** Build a single-event trace slab. */
function singleEventChunk(event: TraceEvent): TraceChunk {
  const writer = new TraceWriter();
  writer.append(event);
  const chunks = writer.takeChunks();
  const chunk = chunks[0];
  if (chunk === undefined) {
    throw new Error("expected at least one chunk from single event");
  }
  return chunk;
}

/** Encode events into trace chunks via TraceWriter. */
function chunksFromEvents(events: readonly TraceEvent[]): ReturnType<TraceWriter["takeChunks"]> {
  const writer = new TraceWriter();
  for (const event of events) {
    writer.append(event);
  }
  return writer.takeChunks();
}

describe("TraceBuffer empty chunks", () => {
  it("totalEvents 0, totalWork 0, seekWork(0) ok", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const buf = new TraceBuffer(graph, []);

    expect(buf.totalEvents).toBe(0);
    expect(buf.totalWork).toBe(0);
    buf.seekWork(0);
    expect(buf.state.eventIndex).toBe(0);
    expect(buf.state.work).toBe(0);
  });
});

describe("TraceBuffer one settle", () => {
  it("after seekWork(1), settleOrder and frontier match settled vertex", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const chunks = chunksFromEvents([{ k: "settle", v: 1, order: 0, cost: 1 }]);
    const buf = new TraceBuffer(graph, chunks);

    buf.seekWork(1);
    expect(buf.state.settleOrder[1]).toBe(0);
    expect(buf.state.settledCount).toBe(1);
    expect(buf.state.frontier[1]).toBe(0);
  });
});

describe("TraceBuffer improved relax then settle", () => {
  it("frontier marks target after relax; clears after settle", () => {
    const graph = packCsr(2, [{ from: 0, to: 1, weight: 1 }], [0, 1], [0, 0]);
    const chunks = chunksFromEvents([
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    buf.seekWork(1);
    expect(buf.state.frontier[1]).toBe(1);

    buf.seekWork(2);
    expect(buf.state.frontier[1]).toBe(0);
  });
});

describe("TraceBuffer zero-cost pivot events", () => {
  it("seekWork(T) applies pivots that share cumulative work T", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "pivot", v: 1, level: 0 },
      { k: "pivot", v: 2, level: 0 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    buf.seekWork(1);
    expect(buf.state.eventIndex).toBe(3);
    expect(buf.state.work).toBe(1);
    expect(buf.state.settledCount).toBe(1);
    expect(buf.state.settleOrder[0]).toBe(0);
    expect(buf.state.settleOrder[1]).toBe(-1);
  });
});

describe("TraceBuffer keyframes", () => {
  it("backward scrub from end crosses KEYFRAME_OPS boundaries", () => {
    const graph = packCsr(1, [], [0], [0]);
    const writer = new TraceWriter();
    for (let i = 0; i < 52; i += 1) {
      writer.append({ k: "heap", op: "push", cmps: 10_000 });
    }
    const chunks = writer.takeChunks();
    const buf = new TraceBuffer(graph, chunks);

    expect(buf.totalWork).toBeGreaterThan(500_000);

    const crossed = Math.floor(buf.totalWork / KEYFRAME_OPS);
    expect(crossed).toBeGreaterThanOrEqual(2);

    const minKeyframes = 1 + crossed;
    expect(minKeyframes).toBeGreaterThanOrEqual(3);

    const mid = Math.floor(buf.totalWork / 2);
    const fresh = new TraceBuffer(graph, chunks);
    fresh.seekWork(mid);

    buf.seekWork(buf.totalWork);
    buf.seekWork(mid);

    expect(buf.state.eventIndex).toBe(fresh.state.eventIndex);
    expect(buf.state.work).toBe(fresh.state.work);

    for (let k = 0; k <= crossed; k += 1) {
      const t = k * KEYFRAME_OPS;
      const forward = new TraceBuffer(graph, chunks);
      forward.seekWork(t);

      const backward = new TraceBuffer(graph, chunks);
      backward.seekWork(buf.totalWork);
      backward.seekWork(t);

      expect(backward.state.eventIndex).toBe(forward.state.eventIndex);
      expect(backward.state.work).toBe(forward.state.work);
    }
  });
});

describe("TraceBuffer double settle", () => {
  it("throws when applying a second settle on the same vertex", () => {
    const graph = packCsr(2, [], [0, 0], [0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "settle", v: 0, order: 1, cost: 1 },
    ]);

    expect(() => new TraceBuffer(graph, chunks)).toThrow(/double settle/);
  });
});

describe("TraceBuffer appendChunk streaming", () => {
  it("empty buffer grows totals on append; live cursor stays at T=0", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const buf = new TraceBuffer(graph, []);

    expect(buf.totalEvents).toBe(0);
    expect(buf.totalWork).toBe(0);

    const chunks = chunksFromEvents([{ k: "settle", v: 1, order: 0, cost: 1 }]);
    const slab = chunks[0];
    if (slab === undefined) {
      throw new Error("expected at least one chunk from settle event");
    }

    buf.appendChunk(slab);

    expect(buf.totalEvents).toBe(1);
    expect(buf.totalWork).toBe(1);
    expect(buf.state.eventIndex).toBe(0);
    expect(buf.state.work).toBe(0);
    expect(buf.state.settledCount).toBe(0);
  });

  it("small appendChunk slabs replace trailing end keyframe instead of accumulating", () => {
    const graph = packCsr(1, [], [0], [0]);
    const events: TraceEvent[] = [
      { k: "heap", op: "push", cmps: 1 },
      { k: "heap", op: "push", cmps: 1 },
      { k: "heap", op: "push", cmps: 1 },
      { k: "heap", op: "push", cmps: 1 },
    ];

    const incremental = new TraceBuffer(graph, []);
    for (const event of events) {
      incremental.appendChunk(singleEventChunk(event));
    }

    expect(incremental.totalWork).toBeLessThan(KEYFRAME_OPS);
    expect(keyframeCount(incremental)).toBe(2);

    const oneShot = new TraceBuffer(graph, chunksFromEvents(events));
    incremental.seekWork(incremental.totalWork);
    oneShot.seekWork(oneShot.totalWork);
    compareLane(incremental.state, oneShot.state);
  });

  it("incremental append matches one-shot buffer at end seek", () => {
    const graph = packCsr(3, [{ from: 0, to: 1, weight: 1 }], [0, 1, 2], [0, 0, 0]);
    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "pivot", v: 2, level: 0 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];
    const allChunks = chunksFromEvents(events);

    const incremental = new TraceBuffer(graph, []);
    for (const chunk of allChunks) {
      incremental.appendChunk(chunk);
    }

    const oneShot = new TraceBuffer(graph, allChunks);

    incremental.seekWork(incremental.totalWork);
    oneShot.seekWork(oneShot.totalWork);

    compareLane(incremental.state, oneShot.state);
  });

  it("seek to 0 then end restores relaxations and heapOps", () => {
    const graph = packCsr(3, [{ from: 0, to: 1, weight: 1 }], [0, 1, 2], [0, 0, 0]);
    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ];
    const chunks = chunksFromEvents(events);
    const buf = new TraceBuffer(graph, chunks);

    buf.seekWork(buf.totalWork);
    const endRelaxations = buf.state.relaxations;
    const endHeapOps = buf.state.heapOps;

    buf.seekWork(0);
    expect(buf.state.relaxations).toBe(0);
    expect(buf.state.heapOps).toBe(0);

    buf.seekWork(buf.totalWork);
    expect(buf.state.relaxations).toBe(endRelaxations);
    expect(buf.state.heapOps).toBe(endHeapOps);
  });
});

describe("TraceBuffer live counters", () => {
  it("tracks relaxations, heapOps, and lastRelaxWork through seek to end", () => {
    const graph = packCsr(
      3,
      [
        { from: 0, to: 1, weight: 1 },
        { from: 1, to: 2, weight: 1 },
      ],
      [0, 1, 2],
      [0, 0, 0],
    );
    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "relax", e: 1, improved: false, cost: 1 },
    ];
    const chunks = chunksFromEvents(events);
    const buf = new TraceBuffer(graph, chunks);

    buf.seekWork(4);
    const workAfterImprovingRelax = buf.state.work;

    buf.seekWork(buf.totalWork);

    expect(buf.state.heapOps).toBe(1);
    expect(buf.state.relaxations).toBe(2);
    expect(buf.state.lastRelaxWork[0]).toBe(workAfterImprovingRelax);
    expect(buf.state.lastRelaxWork[1]).toBe(UNSETTLED);
  });
});

describe("TraceBuffer.applyCount", () => {
  it("empty buffer: applyCount 0 and seekWork(0) noop", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const buf = new TraceBuffer(graph, []);

    expect(buf.applyCount).toBe(0);
    buf.seekWork(0);
    expect(buf.applyCount).toBe(0);
  });

  it("non-empty constructor: applyCount equals totalEvents after keyframe pass", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    expect(buf.totalEvents).toBe(3);
    expect(buf.applyCount).toBe(buf.totalEvents);
    expect(buf.state.eventIndex).toBe(0);
  });

  it("seekWork(0) after constructor does not increment applyCount", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
    ]);
    const buf = new TraceBuffer(graph, chunks);
    const afterCtor = buf.applyCount;

    buf.seekWork(0);
    expect(buf.applyCount).toBe(afterCtor);
  });

  it("forward seekWork increments applyCount by event delta", () => {
    const graph = packCsr(3, [{ from: 0, to: 1, weight: 1 }], [0, 1, 2], [0, 0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks);
    const beforeCount = buf.applyCount;
    const beforeIndex = buf.state.eventIndex;

    const midT = Math.floor(buf.totalWork / 2);
    buf.seekWork(midT);

    const deltaIndex = buf.state.eventIndex - beforeIndex;
    expect(deltaIndex).toBeGreaterThan(0);
    expect(buf.applyCount - beforeCount).toBe(deltaIndex);
  });

  it("repeated seekWork to same position increments applyCount by 0", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    buf.seekWork(1);
    const afterFirst = buf.applyCount;

    buf.seekWork(1);
    expect(buf.applyCount).toBe(afterFirst);
  });

  it("stepEvent increments applyCount by 1; at end returns false without increment", () => {
    const graph = packCsr(2, [], [0, 0], [0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
    ]);
    const buf = new TraceBuffer(graph, chunks);
    const afterCtor = buf.applyCount;

    expect(buf.stepEvent()).toBe(true);
    expect(buf.applyCount).toBe(afterCtor + 1);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.applyCount).toBe(afterCtor + 2);

    expect(buf.stepEvent()).toBe(false);
    expect(buf.applyCount).toBe(afterCtor + 2);
  });

  it("backward seekWork adds applies; applyCount survives copyFrom restore", () => {
    const graph = packCsr(3, [{ from: 0, to: 1, weight: 1 }], [0, 1, 2], [0, 0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "heap", op: "push", cmps: 2 },
      { k: "settle", v: 1, order: 1, cost: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks);
    const afterCtor = buf.applyCount;

    buf.seekWork(buf.totalWork);
    const afterFullSeek = buf.applyCount;
    expect(afterFullSeek).toBe(afterCtor + buf.totalEvents);

    const midT = Math.floor(buf.totalWork / 2);
    buf.seekWork(midT);
    expect(buf.applyCount).toBeGreaterThan(afterFullSeek);
  });
});

describe("BMSSP overlay state", () => {
  it("recurse out with empty stack throws", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const chunks = chunksFromEvents([{ k: "recurse", dir: "out", level: 0, bound: 100 }]);

    expect(() => new TraceBuffer(graph, chunks)).toThrow(/recurse out with empty stack/);
  });

  it("dstruct clears batchRound after FindPivots batch rounds", () => {
    const graph = packCsr(4, [], [0, 1, 2, 3], [0, 0, 0, 0]);
    const chunks = chunksFromEvents([
      { k: "recurse", dir: "in", level: 1, bound: 42 },
      { k: "batch", phase: "start", level: 1, size: 3 },
      { k: "batch", phase: "end", level: 1, size: 2 },
      { k: "dstruct", op: "insert", n: 3, cmps: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.stepEvent()).toBe(true);
    expect(buf.stepEvent()).toBe(true);
    expect(buf.state.batchRound).toBe(1);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.state.batchRound).toBe(0);
    expect(buf.state.dstructOps).toBe(1);
  });

  it("recurse in resets lastPullN inherited from parent level", () => {
    const graph = packCsr(2, [], [0, 1], [0, 0]);
    const chunks = chunksFromEvents([
      { k: "recurse", dir: "in", level: 1, bound: 10 },
      { k: "dstruct", op: "pull", n: 5, cmps: 1 },
      { k: "recurse", dir: "in", level: 0, bound: 20 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    buf.seekWork(buf.totalWork);
    expect(buf.state.recursionDepth).toBe(2);
    expect(buf.state.lastPullN).toBe(0);
  });

  it("recurse in then out: depth, bound, and findPivotsK", () => {
    const n = 5;
    const graph = packCsr(n, [], [0, 1, 2, 3, 4], [0, 0, 0, 0, 0]);
    const boundIn = 42;
    const boundOut = 100;
    const chunks = chunksFromEvents([
      { k: "recurse", dir: "in", level: 0, bound: boundIn },
      { k: "recurse", dir: "out", level: 0, bound: boundOut },
    ]);
    const buf = new TraceBuffer(graph, chunks);
    const expectedK = bmsspParams(n).k;

    expect(buf.state.recursionDepth).toBe(0);
    expect(buf.state.currentBound).toBe(Infinity);
    expect(buf.state.findPivotsK).toBe(0);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.state.recursionDepth).toBe(1);
    expect(buf.state.currentBound).toBe(boundIn);
    expect(buf.state.findPivotsK).toBe(expectedK);
    expect(buf.state.pivotsFoundThisCall).toBe(0);
    expect(buf.state.batchRound).toBe(0);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.state.recursionDepth).toBe(0);
    expect(buf.state.currentBound).toBe(boundOut);
    expect(buf.state.findPivotsK).toBe(expectedK);
  });

  it("recurse in uses explicit findPivotsK override", () => {
    const n = 5;
    const graph = packCsr(n, [], [0, 1, 2, 3, 4], [0, 0, 0, 0, 0]);
    const boundIn = 42;
    const chunks = chunksFromEvents([{ k: "recurse", dir: "in", level: 0, bound: boundIn }]);
    const overrideK = 8;
    const buf = new TraceBuffer(graph, chunks, 0, overrideK);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.state.findPivotsK).toBe(overrideK);
    expect(buf.state.findPivotsK).not.toBe(bmsspParams(n).k);
  });

  it("pivot sets pivotFlareWork and pivotsFoundThisCall without changing work", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "pivot", v: 1, level: 0 },
      { k: "pivot", v: 2, level: 0 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    buf.seekWork(1);
    expect(buf.state.work).toBe(1);
    expect(buf.state.pivotFlareWork[0]).toBe(UNSETTLED);
    expect(buf.state.pivotFlareWork[1]).toBe(1);
    expect(buf.state.pivotFlareWork[2]).toBe(1);
    expect(buf.state.pivotsFoundThisCall).toBe(2);
  });

  it("batch start opens round and clears bloom; relax expands bbox; end closes batch", () => {
    const graph = packCsr(
      3,
      [
        { from: 0, to: 1, weight: 1 },
        { from: 0, to: 2, weight: 1 },
      ],
      [0, 10, 5],
      [0, 0, 10],
    );
    const chunks = chunksFromEvents([
      { k: "batch", phase: "start", level: 2, size: 3 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "relax", e: 1, improved: true, cost: 1 },
      { k: "batch", phase: "end", level: 2, size: 2 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    expect(buf.state.batchOpen).toBe(0);
    expect(buf.state.batchRound).toBe(0);
    expect(buf.state.bloomActive).toBe(0);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.state.batchOpen).toBe(1);
    expect(buf.state.batchLevel).toBe(2);
    expect(buf.state.lastBatchSize).toBe(3);
    expect(buf.state.batchRound).toBe(1);
    expect(buf.state.bloomVertex[1]).toBe(0);
    expect(buf.state.bloomVertex[2]).toBe(0);
    expect(buf.state.bloomActive).toBe(0);

    buf.seekWork(1);
    expect(buf.state.batchOpen).toBe(1);
    expect(buf.state.bloomVertex[1]).toBe(1);
    expect(buf.state.bloomVertex[2]).toBe(0);
    expect(buf.state.bloomMinX).toBe(10);
    expect(buf.state.bloomMinY).toBe(0);
    expect(buf.state.bloomMaxX).toBe(10);
    expect(buf.state.bloomMaxY).toBe(0);
    expect(buf.state.bloomActive).toBe(1);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.state.batchOpen).toBe(1);
    expect(buf.state.bloomVertex[1]).toBe(1);
    expect(buf.state.bloomVertex[2]).toBe(1);
    expect(buf.state.bloomMinX).toBe(5);
    expect(buf.state.bloomMinY).toBe(0);
    expect(buf.state.bloomMaxX).toBe(10);
    expect(buf.state.bloomMaxY).toBe(10);
    expect(buf.state.bloomActive).toBe(1);

    expect(buf.stepEvent()).toBe(true);
    expect(buf.state.batchOpen).toBe(0);
    expect(buf.state.lastBatchSize).toBe(2);
    expect(buf.state.bloomActive).toBe(1);
    expect(buf.state.bloomVertex[1]).toBe(1);
    expect(buf.state.bloomVertex[2]).toBe(1);
  });

  it("dstruct insert, batchPrepend, and pull mutate dBlockSizes schematically", () => {
    const graph = packCsr(1, [], [0], [0]);
    const chunks = chunksFromEvents([
      { k: "dstruct", op: "insert", n: 3, cmps: 1 },
      { k: "dstruct", op: "insert", n: 2, cmps: 1 },
      { k: "dstruct", op: "batchPrepend", n: 5, cmps: 1 },
      { k: "dstruct", op: "pull", n: 4, cmps: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    expect(buf.state.dstructOps).toBe(0);
    expect(buf.state.dBlockCount).toBe(0);

    buf.seekWork(1);
    expect(buf.state.dstructOps).toBe(1);
    expect(buf.state.dBlockCount).toBe(1);
    expect(buf.state.dBlockSizes[0]).toBe(3);

    buf.seekWork(2);
    expect(buf.state.dstructOps).toBe(2);
    expect(buf.state.dBlockCount).toBe(2);
    expect(buf.state.dBlockSizes[0]).toBe(3);
    expect(buf.state.dBlockSizes[1]).toBe(2);

    buf.seekWork(3);
    expect(buf.state.dstructOps).toBe(3);
    expect(buf.state.dBlockCount).toBe(3);
    expect(buf.state.dBlockSizes[0]).toBe(5);
    expect(buf.state.dBlockSizes[1]).toBe(3);
    expect(buf.state.dBlockSizes[2]).toBe(2);

    buf.seekWork(buf.totalWork);
    expect(buf.state.dstructOps).toBe(4);
    expect(buf.state.lastPullN).toBe(4);
    expect(buf.state.dBlockCount).toBe(3);
    expect(buf.state.dBlockSizes[0]).toBe(1);
    expect(buf.state.dBlockSizes[1]).toBe(3);
    expect(buf.state.dBlockSizes[2]).toBe(2);
  });

  it("dstruct merge appends a schematic block like insert", () => {
    const graph = packCsr(1, [], [0], [0]);
    const chunks = chunksFromEvents([
      { k: "dstruct", op: "insert", n: 3, cmps: 1 },
      { k: "dstruct", op: "merge", n: 4, cmps: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks);

    expect(buf.state.dstructOps).toBe(0);
    expect(buf.state.dBlockCount).toBe(0);

    buf.seekWork(1);
    expect(buf.state.dstructOps).toBe(1);
    expect(buf.state.dBlockCount).toBe(1);
    expect(buf.state.dBlockSizes[0]).toBe(3);

    buf.seekWork(buf.totalWork);
    expect(buf.state.dstructOps).toBe(2);
    expect(buf.state.dBlockCount).toBe(2);
    expect(buf.state.dBlockSizes[0]).toBe(3);
    expect(buf.state.dBlockSizes[1]).toBe(4);
  });

  it("seekWork(0) after BMSSP events resets overlay fields via keyframe", () => {
    const graph = packCsr(4, [{ from: 0, to: 1, weight: 1 }], [0, 5, 0, 0], [0, 0, 5, 0]);
    const chunks = chunksFromEvents([
      { k: "heap", op: "push", cmps: 1 },
      { k: "recurse", dir: "in", level: 0, bound: 20 },
      { k: "batch", phase: "start", level: 1, size: 2 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "pivot", v: 1, level: 0 },
      { k: "dstruct", op: "insert", n: 3, cmps: 1 },
      { k: "batch", phase: "end", level: 1, size: 1 },
      { k: "recurse", dir: "out", level: 0, bound: 50 },
    ]);
    const buf = new TraceBuffer(graph, chunks);
    const fresh = new TraceBuffer(graph, chunks).state;

    buf.seekWork(buf.totalWork);
    expect(buf.state.recursionDepth).toBe(0);
    expect(buf.state.dstructOps).toBe(1);
    expect(buf.state.bloomActive).toBe(1);

    buf.seekWork(0);
    compareLane(buf.state, fresh);
  });

  it("forward seek to mid T matches scrub-back via compareLane", () => {
    const n = 6;
    const graph = packCsr(
      n,
      [
        { from: 0, to: 1, weight: 1 },
        { from: 1, to: 2, weight: 1 },
      ],
      [0, 8, 2, 0, 0, 0],
      [0, 0, 6, 0, 0, 0],
    );
    const chunks = chunksFromEvents([
      { k: "recurse", dir: "in", level: 0, bound: 15 },
      { k: "batch", phase: "start", level: 0, size: 2 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "pivot", v: 1, level: 0 },
      { k: "dstruct", op: "insert", n: 2, cmps: 0 },
      { k: "dstruct", op: "batchPrepend", n: 4, cmps: 0 },
      { k: "relax", e: 1, improved: true, cost: 1 },
      { k: "batch", phase: "end", level: 0, size: 2 },
      { k: "dstruct", op: "pull", n: 3, cmps: 0 },
      { k: "recurse", dir: "out", level: 0, bound: 99 },
    ]);
    const buf = new TraceBuffer(graph, chunks);
    const midT = Math.floor(buf.totalWork / 2);

    const forward = new TraceBuffer(graph, chunks);
    forward.seekWork(midT);

    buf.seekWork(buf.totalWork);
    buf.seekWork(midT);

    compareLane(buf.state, forward.state);
  });
});

describe("TraceBuffer photo-finish path reconstruction", () => {
  it("chain 0→1→2: pred/dist/settleWork after full seek", () => {
    const w01 = 3;
    const w12 = 5;
    const graph = packCsr(
      3,
      [
        { from: 0, to: 1, weight: w01 },
        { from: 1, to: 2, weight: w12 },
      ],
      [0, 1, 2],
      [0, 0, 0],
    );
    const chunks = chunksFromEvents([
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: 0, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "relax", e: 1, improved: true, cost: 1 },
      { k: "settle", v: 2, order: 2, cost: 1 },
    ]);
    const buf = new TraceBuffer(graph, chunks, 0);
    buf.seekWork(buf.totalWork);

    expect(buf.state.pred[1]).toBe(0);
    expect(buf.state.pred[2]).toBe(1);
    expect(buf.state.dist[0]).toBe(0);
    expect(buf.state.dist[1]).toBe(w01);
    expect(buf.state.dist[2]).toBe(w01 + w12);
    expect(buf.state.settleWork[0]).not.toBe(UNSETTLED);
    expect(buf.state.settleWork[1]).not.toBe(UNSETTLED);
    expect(buf.state.settleWork[2]).not.toBe(UNSETTLED);
  });

  it("Dijkstra maze trace has zero out-of-order settles", () => {
    const graph = generateGraph("maze", 40, 1);
    const source = 0;
    const { events } = drainRun(graph, source);
    const chunks = chunksFromEvents(events);
    const buf = new TraceBuffer(graph, chunks, source);
    buf.seekWork(buf.totalWork);
    expect(buf.state.outOfOrderSettles).toBe(0);
    for (let v = 0; v < graph.n; v += 1) {
      expect(buf.state.outOfOrder[v]).toBe(0);
    }
    expect(sumOutOfOrderBits(buf.state)).toBe(0);
  });

  it("BMSSP demo maze trace outOfOrder bitset matches counter", () => {
    const primary = bmsspMazeLaneState(40, 1);
    expectOutOfOrderBitsetConsistent(primary);

    const fallbacks: { n: number; seed: number }[] = [
      { n: 40, seed: 2 },
      { n: 80, seed: 1 },
      { n: 40, seed: 3 },
    ];
    let sawOutOfOrder = primary.outOfOrderSettles > 0;
    for (const { n, seed } of fallbacks) {
      const state = bmsspMazeLaneState(n, seed);
      expectOutOfOrderBitsetConsistent(state);
      if (state.outOfOrderSettles > 0) {
        sawOutOfOrder = true;
      }
    }
    expect(sawOutOfOrder).toBe(true);
  });

  it("BMSSP paper-params maze trace outOfOrder bitset matches counter", () => {
    const graph = generateGraph("maze", 40, 1);
    const state = bmsspMazeLaneState(graph.n, 1, paperBmsspParams(graph.n));
    expectOutOfOrderBitsetConsistent(state);
  });

  it("LaneState clone and copyFrom preserve outOfOrder bitset; reset clears bits", () => {
    const lane = new LaneState(4, 0);
    lane.outOfOrder[1] = 1;
    lane.outOfOrder[3] = 1;
    lane.outOfOrderSettles = 2;

    const cloned = lane.clone();
    for (let v = 0; v < lane.n; v += 1) {
      expect(cloned.outOfOrder[v]).toBe(lane.outOfOrder[v]);
    }
    expect(cloned.outOfOrderSettles).toBe(lane.outOfOrderSettles);

    const copied = new LaneState(4, 0);
    copied.copyFrom(lane);
    for (let v = 0; v < lane.n; v += 1) {
      expect(copied.outOfOrder[v]).toBe(lane.outOfOrder[v]);
    }
    expect(copied.outOfOrderSettles).toBe(lane.outOfOrderSettles);

    copied.reset();
    for (let v = 0; v < lane.n; v += 1) {
      expect(copied.outOfOrder[v]).toBe(0);
    }
    expect(copied.outOfOrderSettles).toBe(0);
  });
});
