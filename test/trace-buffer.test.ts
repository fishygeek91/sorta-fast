import { describe, expect, it } from "vitest";

import { packCsr } from "../src/core/graph.ts";
import { type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { KEYFRAME_OPS, TraceBuffer } from "../src/harness/traceBuffer.ts";

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
