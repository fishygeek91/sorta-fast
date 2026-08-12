import { describe, expect, it } from "vitest";

import { packCsr } from "../src/core/graph.ts";
import { type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { type LaneState, UNSETTLED } from "../src/harness/laneState.ts";
import { KEYFRAME_OPS, TraceBuffer } from "../src/harness/traceBuffer.ts";

/** Assert two lane snapshots are identical (scrub-safe fields + live counters). */
function compareLane(a: LaneState, b: LaneState): void {
  expect(a.n).toBe(b.n);
  expect(a.m).toBe(b.m);
  expect(a.settledCount).toBe(b.settledCount);
  expect(a.eventIndex).toBe(b.eventIndex);
  expect(a.work).toBe(b.work);
  expect(a.relaxations).toBe(b.relaxations);
  expect(a.heapOps).toBe(b.heapOps);

  for (let v = 0; v < a.n; v += 1) {
    const aOrder = a.settleOrder[v];
    const bOrder = b.settleOrder[v];
    expect(aOrder).toBe(bOrder);

    const aFrontier = a.frontier[v];
    const bFrontier = b.frontier[v];
    expect(aFrontier).toBe(bFrontier);
  }

  for (let e = 0; e < a.m; e += 1) {
    const aRelaxWork = a.lastRelaxWork[e];
    const bRelaxWork = b.lastRelaxWork[e];
    expect(aRelaxWork).toBe(bRelaxWork);
  }
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
