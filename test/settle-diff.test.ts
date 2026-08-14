import { describe, expect, it } from "vitest";

import { paperBmsspParams } from "../src/core/bmssp/params.ts";
import { run } from "../src/core/dijkstra.ts";
import { generateGraph } from "../src/core/graph.ts";
import { type TraceChunk, type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { LaneState, UNSETTLED } from "../src/harness/laneState.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";
import {
  fillSettleDiff,
  SETTLE_DIFF_BOTH,
  SETTLE_DIFF_LEFT,
  SETTLE_DIFF_NEITHER,
  SETTLE_DIFF_RIGHT,
} from "../src/render/settleDiff.ts";
import { drainBmsspRun } from "./bmssp-helpers.ts";

/** Encode events into trace chunks via TraceWriter. */
function chunksFromEvents(events: readonly TraceEvent[]): TraceChunk[] {
  const writer = new TraceWriter();
  for (const event of events) {
    writer.append(event);
  }
  return writer.takeChunks();
}

/** Collect a full Dijkstra trace for `graph` from source 0. */
function collectDijkstraChunks(graph: ReturnType<typeof generateGraph>): TraceChunk[] {
  const writer = new TraceWriter();
  const gen = run(graph, 0);
  for (;;) {
    const step = gen.next();
    if (step.done) {
      break;
    }
    writer.append(step.value);
  }
  return writer.takeChunks();
}

/**
 * Scrub identity for {@link fillSettleDiff}: forward seek vs seek-to-end-then-back
 * must yield identical settle-diff buckets and lane outOfOrder bitsets.
 */
function expectSettleDiffScrubIdentity(
  graph: ReturnType<typeof generateGraph>,
  leftChunks: TraceChunk[],
  rightChunks: TraceChunk[],
): void {
  const probeLeft = new TraceBuffer(graph, leftChunks, 0);
  const probeRight = new TraceBuffer(graph, rightChunks, 0);
  const midT = Math.floor(Math.min(probeLeft.totalWork, probeRight.totalWork) / 2);

  const leftForward = new TraceBuffer(graph, leftChunks, 0);
  const rightForward = new TraceBuffer(graph, rightChunks, 0);
  leftForward.seekWork(midT);
  rightForward.seekWork(midT);

  const outA = new Uint8Array(graph.n);
  fillSettleDiff(outA, leftForward.state, rightForward.state);
  const leftSnap = leftForward.state.clone();
  const rightSnap = rightForward.state.clone();

  const leftScrub = new TraceBuffer(graph, leftChunks, 0);
  const rightScrub = new TraceBuffer(graph, rightChunks, 0);
  leftScrub.seekWork(leftScrub.totalWork);
  rightScrub.seekWork(rightScrub.totalWork);
  leftScrub.seekWork(midT);
  rightScrub.seekWork(midT);

  const outB = new Uint8Array(graph.n);
  fillSettleDiff(outB, leftScrub.state, rightScrub.state);

  expect(Array.from(outA)).toEqual(Array.from(outB));

  for (let v = 0; v < graph.n; v += 1) {
    expect(leftScrub.state.outOfOrder[v]).toBe(leftSnap.outOfOrder[v]);
    expect(rightScrub.state.outOfOrder[v]).toBe(rightSnap.outOfOrder[v]);
  }
}

describe("fillSettleDiff", () => {
  it("all UNSETTLED yields SETTLE_DIFF_NEITHER for every vertex", () => {
    const left = new LaneState(4, 0);
    const right = new LaneState(4, 0);
    const out = new Uint8Array(4);
    fillSettleDiff(out, left, right);
    expect(Array.from(out)).toEqual([
      SETTLE_DIFF_NEITHER,
      SETTLE_DIFF_NEITHER,
      SETTLE_DIFF_NEITHER,
      SETTLE_DIFF_NEITHER,
    ]);
  });

  it("left settled only yields SETTLE_DIFF_LEFT at that vertex", () => {
    const left = new LaneState(4, 0);
    const right = new LaneState(4, 0);
    left.settleOrder[0] = 0;
    const out = new Uint8Array(4);
    fillSettleDiff(out, left, right);
    expect(out[0]).toBe(SETTLE_DIFF_LEFT);
    expect(out[1]).toBe(SETTLE_DIFF_NEITHER);
  });

  it("right settled only yields SETTLE_DIFF_RIGHT at that vertex", () => {
    const left = new LaneState(4, 0);
    const right = new LaneState(4, 0);
    right.settleOrder[1] = 0;
    const out = new Uint8Array(4);
    fillSettleDiff(out, left, right);
    expect(out[1]).toBe(SETTLE_DIFF_RIGHT);
    expect(out[0]).toBe(SETTLE_DIFF_NEITHER);
  });

  it("both settled at the same vertex yields SETTLE_DIFF_BOTH", () => {
    const left = new LaneState(4, 0);
    const right = new LaneState(4, 0);
    left.settleOrder[2] = 0;
    right.settleOrder[2] = 1;
    const out = new Uint8Array(4);
    fillSettleDiff(out, left, right);
    expect(out[2]).toBe(SETTLE_DIFF_BOTH);
    expect(out[0]).toBe(SETTLE_DIFF_NEITHER);
  });

  it("throws when lane vertex counts differ", () => {
    const left = new LaneState(4, 0);
    const right = new LaneState(3, 0);
    const out = new Uint8Array(4);
    expect(() => fillSettleDiff(out, left, right)).toThrow(/vertex count mismatch/);
  });

  it("throws when output length does not match n", () => {
    const left = new LaneState(4, 0);
    const right = new LaneState(4, 0);
    const out = new Uint8Array(3);
    expect(() => fillSettleDiff(out, left, right)).toThrow(/output length mismatch/);
  });

  it("does not require UNSETTLED sentinel beyond settle-order comparison", () => {
    const left = new LaneState(2, 0);
    const right = new LaneState(2, 0);
    left.settleOrder[0] = UNSETTLED;
    right.settleOrder[0] = UNSETTLED;
    const out = new Uint8Array(2);
    fillSettleDiff(out, left, right);
    expect(out[0]).toBe(SETTLE_DIFF_NEITHER);
  });
});

describe("fillSettleDiff scrub identity", () => {
  const graph = generateGraph("maze", 40, 1);

  it("dijkstra vs demo BMSSP lanes: scrub-safe settle diff at mid work", () => {
    const leftChunks = collectDijkstraChunks(graph);
    const { events } = drainBmsspRun(graph, 0);
    const rightChunks = chunksFromEvents(events);
    expectSettleDiffScrubIdentity(graph, leftChunks, rightChunks);
  });

  it("dijkstra vs paper-params BMSSP lanes: scrub-safe settle diff at mid work", () => {
    const leftChunks = collectDijkstraChunks(graph);
    const { events } = drainBmsspRun(graph, 0, paperBmsspParams(graph.n));
    const rightChunks = chunksFromEvents(events);
    expectSettleDiffScrubIdentity(graph, leftChunks, rightChunks);
  });
});
