import { describe, expect, it } from "vitest";

import { LaneState } from "../src/harness/laneState.ts";
import { formatBmsspNarration } from "../src/ui/narration.ts";

/** Build a minimal lane and apply scalar overrides for narration branches. */
function laneWith(overrides: Partial<LaneState>): LaneState {
  const lane = new LaneState(4, 6);
  Object.assign(lane, overrides);
  return lane;
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

  it("describes a recent D pull when not in FindPivots", () => {
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

  it("prefers FindPivots when batchRound is positive", () => {
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
