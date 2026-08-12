import { describe, expect, it } from "vitest";

import { run } from "../src/core/dijkstra.ts";
import { generateGraph, packCsr } from "../src/core/graph.ts";
import { type TraceChunk, type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { type LaneState } from "../src/harness/laneState.ts";
import { Playback } from "../src/harness/playback.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";

/** Assert two lane snapshots are identical for scrub-safe playback. */
function compareLane(a: LaneState, b: LaneState): void {
  expect(a.n).toBe(b.n);
  expect(a.settledCount).toBe(b.settledCount);
  expect(a.eventIndex).toBe(b.eventIndex);
  expect(a.work).toBe(b.work);

  for (let v = 0; v < a.n; v += 1) {
    const aOrder = a.settleOrder[v];
    const bOrder = b.settleOrder[v];
    expect(aOrder).toBe(bOrder);

    const aFrontier = a.frontier[v];
    const bFrontier = b.frontier[v];
    expect(aFrontier).toBe(bFrontier);
  }
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
