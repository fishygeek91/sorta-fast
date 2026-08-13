import { describe, expect, it } from "vitest";

import { generateGraph } from "../src/core/graph.ts";
import { type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { LaneState } from "../src/harness/laneState.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";
import { formatBmsspNarration } from "../src/ui/narration.ts";
import { drainBmsspRun } from "./bmssp-helpers.ts";

/** Build a minimal lane and apply scalar overrides for narration branches. */
function laneWith(overrides: Partial<LaneState>): LaneState {
  const lane = new LaneState(4, 6);
  Object.assign(lane, overrides);
  return lane;
}

/** Encode events into trace chunks via TraceWriter. */
function chunksFromEvents(events: readonly TraceEvent[]): ReturnType<TraceWriter["takeChunks"]> {
  const writer = new TraceWriter();
  for (const event of events) {
    writer.append(event);
  }
  return writer.takeChunks();
}

/**
 * Index of the first `dstruct` pull while recurse depth is positive, or -1.
 *
 * Depth is tracked from `recurse` in/out events only (matches TraceBuffer).
 */
function firstPullIndexAtPositiveDepth(events: readonly TraceEvent[]): number {
  let depth = 0;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === undefined) {
      throw new Error(`missing event at index ${i}`);
    }
    if (event.k === "recurse") {
      if (event.dir === "in") {
        depth += 1;
      } else {
        depth = Math.max(0, depth - 1);
      }
      continue;
    }
    if (event.k === "dstruct" && event.op === "pull" && depth > 0) {
      return i;
    }
  }
  return -1;
}

describe("formatBmsspNarration", () => {
  it("returns idle when recursion depth is zero", () => {
    expect(formatBmsspNarration(laneWith({ recursionDepth: 0 }))).toBe("BMSSP idle");
  });

  it("describes recurse level with finite bound", () => {
    expect(
      formatBmsspNarration(
        laneWith({
          recursionDepth: 2,
          currentBound: 17,
          batchOpen: 0,
          batchRound: 0,
          lastPullN: 0,
        }),
      ),
    ).toBe("BMSSP level 2: bound 17");
  });

  it("uses infinity symbol for non-finite bound", () => {
    expect(
      formatBmsspNarration(
        laneWith({
          recursionDepth: 1,
          currentBound: Infinity,
          batchOpen: 0,
          batchRound: 0,
          lastPullN: 0,
        }),
      ),
    ).toBe("BMSSP level 1: bound ∞");
  });

  it("describes a recent D pull when batchRound is zero (harness clears it on dstruct)", () => {
    expect(
      formatBmsspNarration(
        laneWith({
          recursionDepth: 3,
          currentBound: 42,
          batchOpen: 0,
          batchRound: 0,
          lastPullN: 8,
        }),
      ),
    ).toBe("BMSSP level 3: bound 42, pulled 8");
  });

  it("prefers FindPivots when batch is open", () => {
    expect(
      formatBmsspNarration(
        laneWith({
          recursionDepth: 2,
          currentBound: 99,
          batchOpen: 1,
          batchRound: 1,
          findPivotsK: 0,
          lastBatchSize: 12,
          pivotsFoundThisCall: 3,
          lastPullN: 5,
        }),
      ),
    ).toBe("FindPivots round 1: 12 vertices relaxed, 3 pivots found");
  });

  it("prefers FindPivots when batchRound is positive before dstruct clears it", () => {
    expect(
      formatBmsspNarration(
        laneWith({
          recursionDepth: 2,
          currentBound: 99,
          batchOpen: 0,
          batchRound: 2,
          findPivotsK: 0,
          lastBatchSize: 7,
          pivotsFoundThisCall: 1,
          lastPullN: 5,
        }),
      ),
    ).toBe("FindPivots round 2: 7 vertices relaxed, 1 pivots found");
  });

  it("includes findPivotsK in the round label when set", () => {
    expect(
      formatBmsspNarration(
        laneWith({
          recursionDepth: 1,
          batchOpen: 1,
          batchRound: 2,
          findPivotsK: 5,
          lastBatchSize: 20,
          pivotsFoundThisCall: 4,
        }),
      ),
    ).toBe("FindPivots round 2/5: 20 vertices relaxed, 4 pivots found");
  });
});

describe("formatBmsspNarration BMSSP trace integration", () => {
  it("shows pull narration after dstruct pull at interior recurse depth", () => {
    const graph = generateGraph("maze", 40, 1);
    const { events } = drainBmsspRun(graph, 0);

    const pullIndex = firstPullIndexAtPositiveDepth(events);
    expect(pullIndex).toBeGreaterThanOrEqual(0);

    const chunks = chunksFromEvents(events);
    const buf = new TraceBuffer(graph, chunks);
    for (let i = 0; i <= pullIndex; i += 1) {
      expect(buf.stepEvent()).toBe(true);
    }

    expect(buf.state.recursionDepth).toBeGreaterThan(0);
    expect(buf.state.lastPullN).toBeGreaterThan(0);
    expect(buf.state.batchRound).toBe(0);

    const narration = formatBmsspNarration(buf.state);
    expect(narration).toMatch(/pulled \d+/);
    expect(narration.startsWith("FindPivots")).toBe(false);
  });
});
