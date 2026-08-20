import { describe, expect, it } from "vitest";

import { LaneState, UNSETTLED } from "../src/harness/laneState.ts";
import {
  formatRaceBanner,
  formatSettleAllBanner,
  isLaneFrozen,
  raceCountersFromLane,
  walkGoldPath,
} from "../src/ui/photoFinish.ts";

/** Handmade lane with predecessor chain 2 ← 1 ← 0 (source at 0). */
function laneWithPredChain(): LaneState {
  const lane = new LaneState(3, 2);
  lane.pred[0] = UNSETTLED;
  lane.pred[1] = 0;
  lane.pred[2] = 1;
  lane.settleOrder[0] = 0;
  lane.settleOrder[1] = 1;
  lane.settleOrder[2] = 2;
  lane.settledCount = 3;
  return lane;
}

describe("isLaneFrozen", () => {
  it("is false until settleOrder[finish] is assigned", () => {
    const lane = new LaneState(4, 4);
    const finish = 2;

    expect(isLaneFrozen(lane, finish)).toBe(false);

    lane.settleOrder[finish] = 0;
    expect(isLaneFrozen(lane, finish)).toBe(true);
  });

  it("is false for out-of-range finish indices", () => {
    const lane = new LaneState(3, 2);
    lane.settleOrder[1] = 0;

    expect(isLaneFrozen(lane, -1)).toBe(false);
    expect(isLaneFrozen(lane, 3)).toBe(false);
    expect(isLaneFrozen(lane, 1.5)).toBe(false);
  });
});

describe("walkGoldPath", () => {
  it("walks pred chain 2 ← 1 ← 0 from finish to source", () => {
    const lane = laneWithPredChain();
    expect(walkGoldPath(lane, 2)).toEqual([2, 1, 0]);
  });

  it("returns [] when finish is unsettled", () => {
    const lane = laneWithPredChain();
    lane.settleOrder[2] = UNSETTLED;
    expect(walkGoldPath(lane, 2)).toEqual([]);
  });

  it("throws on a predecessor cycle", () => {
    const lane = new LaneState(3, 2);
    lane.settleOrder[2] = 0;
    lane.pred[0] = 1;
    lane.pred[1] = 2;
    lane.pred[2] = 0;

    expect(() => walkGoldPath(lane, 2)).toThrow(/cycle/i);
  });
});

describe("formatRaceBanner", () => {
  /**
   * Exact 2-lane banner (input order: Dijkstra then BMSSP):
   * headline from design.md; suffix lists totals in lane input order.
   */
  const twoLaneBanner =
    "BMSSP beat Dijkstra by 17,133 comparisons on this graph. (Dijkstra: 48,210; BMSSP: 31,077)";

  it("formats the 2-lane design headline plus per-lane totals suffix", () => {
    expect(
      formatRaceBanner([
        { label: "Dijkstra", work: 48210 },
        { label: "BMSSP", work: 31077 },
      ]),
    ).toBe(twoLaneBanner);
  });

  it("compares winner vs second-lowest work with three totals in input order", () => {
    expect(
      formatRaceBanner([
        { label: "Dijkstra", work: 50000 },
        { label: "BMSSP '25", work: 31077 },
        { label: "DMSY", work: 42000 },
      ]),
    ).toBe(
      "BMSSP '25 beat DMSY by 10,923 comparisons on this graph. (Dijkstra: 50,000; BMSSP '25: 31,077; DMSY: 42,000)",
    );
  });

  it("reports zero margin when top two lanes tie on floored work", () => {
    expect(
      formatRaceBanner([
        { label: "A", work: 100 },
        { label: "B", work: 100.9 },
      ]),
    ).toBe("A beat B by 0 comparisons on this graph. (A: 100; B: 100)");
  });

  it("throws when fewer than two lanes are provided", () => {
    expect(() => formatRaceBanner([{ label: "Only", work: 1 }])).toThrow(/at least two lanes/i);
  });
});

describe("formatSettleAllBanner", () => {
  /**
   * Exact 2-lane banner (input order: Dijkstra then BMSSP):
   * settle-all wording; suffix lists totals in lane input order.
   */
  const twoLaneBanner =
    "BMSSP beat Dijkstra by 17,133 comparisons on the settle-all work clock. (Dijkstra: 48,210; BMSSP: 31,077)";

  it("formats the 2-lane design headline plus per-lane totals suffix", () => {
    expect(
      formatSettleAllBanner([
        { label: "Dijkstra", work: 48210 },
        { label: "BMSSP", work: 31077 },
      ]),
    ).toBe(twoLaneBanner);
  });

  it("compares winner vs second-lowest work with three totals in input order", () => {
    expect(
      formatSettleAllBanner([
        { label: "Dijkstra", work: 50000 },
        { label: "BMSSP '25", work: 31077 },
        { label: "DMSY", work: 42000 },
      ]),
    ).toBe(
      "BMSSP '25 beat DMSY by 10,923 comparisons on the settle-all work clock. (Dijkstra: 50,000; BMSSP '25: 31,077; DMSY: 42,000)",
    );
  });

  it("reports zero margin when top two lanes tie on floored work", () => {
    expect(
      formatSettleAllBanner([
        { label: "A", work: 100 },
        { label: "B", work: 100.9 },
      ]),
    ).toBe("A beat B by 0 comparisons on the settle-all work clock. (A: 100; B: 100)");
  });

  it("throws when fewer than two lanes are provided", () => {
    expect(() => formatSettleAllBanner([{ label: "Only", work: 1 }])).toThrow(
      /at least two lanes/i,
    );
  });
});

describe("raceCountersFromLane", () => {
  it("maps lane scalars with floored comparisons", () => {
    const lane = new LaneState(5, 8);
    lane.work = 1234.7;
    lane.heapOps = 10;
    lane.dstructOps = 3;
    lane.relaxations = 7;
    lane.outOfOrderSettles = 2;
    lane.settledCount = 4;

    expect(raceCountersFromLane(lane)).toEqual({
      comparisons: 1234,
      heapOps: 10,
      dstructOps: 3,
      relaxations: 7,
      outOfOrderSettles: 2,
      settledCount: 4,
      n: 5,
    });
  });
});
