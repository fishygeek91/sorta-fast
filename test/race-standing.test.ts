import { describe, expect, it } from "vitest";

import {
  bestInClassSecondary,
  rankLaneIndices,
  settleLead,
  type RaceBannerLane,
  type RaceLaneCounters,
} from "../src/ui/photoFinish.ts";

/**
 * Build {@link RaceLaneCounters} with defaults for fields not under test.
 */
function counters(
  partial: Pick<RaceLaneCounters, "heapOps" | "dstructOps" | "relaxations" | "outOfOrderSettles"> &
    Partial<Pick<RaceLaneCounters, "comparisons" | "settledCount" | "n">>,
): RaceLaneCounters {
  return {
    comparisons: partial.comparisons ?? 0,
    heapOps: partial.heapOps,
    dstructOps: partial.dstructOps,
    relaxations: partial.relaxations,
    outOfOrderSettles: partial.outOfOrderSettles,
    settledCount: partial.settledCount ?? 0,
    n: partial.n ?? 0,
  };
}

/** Minimal banner lane row for ranking tests. */
function lane(label: string, work: number): RaceBannerLane {
  return { label, work };
}

describe("rankLaneIndices", () => {
  it("ranks Dijkstra ahead of BMSSP when Dijkstra has lower work", () => {
    expect(rankLaneIndices([lane("Dijkstra", 139608), lane("BMSSP", 237827)])).toEqual([0, 1]);
  });

  it("ranks BMSSP ahead of Dijkstra when BMSSP has lower work (formatRaceBanner golden)", () => {
    expect(rankLaneIndices([lane("Dijkstra", 48210), lane("BMSSP", 31077)])).toEqual([1, 0]);
  });

  it("ranks three lanes by floored work with ties keeping input order", () => {
    expect(
      rankLaneIndices([lane("Dijkstra", 50000), lane("BMSSP", 31077), lane("DMSY", 42000)]),
    ).toEqual([1, 2, 0]);
  });

  it("keeps the first index when floored work ties", () => {
    expect(rankLaneIndices([lane("A", 100), lane("B", 100.9)])).toEqual([0, 1]);
  });
});

describe("bestInClassSecondary", () => {
  it("flags each lane's best-in-class secondary counters on a Dijkstra-vs-BMSSP shape", () => {
    const flags = bestInClassSecondary([
      counters({
        heapOps: 14692,
        dstructOps: 0,
        relaxations: 8000,
        outOfOrderSettles: 0,
      }),
      counters({
        heapOps: 346,
        dstructOps: 120,
        relaxations: 9000,
        outOfOrderSettles: 40,
      }),
    ]);

    expect(flags[0]).toEqual({
      heapOps: false,
      dstructOps: true,
      relaxations: true,
      outOfOrderSettles: true,
    });
    expect(flags[1]).toEqual({
      heapOps: true,
      dstructOps: false,
      relaxations: false,
      outOfOrderSettles: false,
    });
  });

  it("marks both lanes when heapOps tie at the minimum", () => {
    const flags = bestInClassSecondary([
      counters({ heapOps: 10, dstructOps: 5, relaxations: 1, outOfOrderSettles: 0 }),
      counters({ heapOps: 10, dstructOps: 3, relaxations: 2, outOfOrderSettles: 1 }),
    ]);

    expect(flags[0].heapOps).toBe(true);
    expect(flags[1].heapOps).toBe(true);
  });

  it("returns all-false flags for a single lane", () => {
    expect(
      bestInClassSecondary([
        counters({ heapOps: 1, dstructOps: 2, relaxations: 3, outOfOrderSettles: 4 }),
      ]),
    ).toEqual([
      {
        heapOps: false,
        dstructOps: false,
        relaxations: false,
        outOfOrderSettles: false,
      },
    ]);
  });

  it("returns an empty array for no lanes", () => {
    expect(bestInClassSecondary([])).toEqual([]);
  });

  it("throws when a secondary counter is non-finite, naming the field and lane index", () => {
    expect(() =>
      bestInClassSecondary([
        counters({ heapOps: 1, dstructOps: 0, relaxations: 0, outOfOrderSettles: 0 }),
        counters({ heapOps: Number.NaN, dstructOps: 0, relaxations: 0, outOfOrderSettles: 0 }),
      ]),
    ).toThrow(/heapOps/i);

    expect(() =>
      bestInClassSecondary([
        counters({ heapOps: 1, dstructOps: 0, relaxations: 0, outOfOrderSettles: 0 }),
        counters({ heapOps: Number.NaN, dstructOps: 0, relaxations: 0, outOfOrderSettles: 0 }),
      ]),
    ).toThrow(/lane 1/i);
  });
});

describe("settleLead", () => {
  it("returns the leader index and margin for two lanes", () => {
    expect(settleLead([10, 14])).toEqual({ leaderIndex: 1, margin: 4 });
  });

  it("returns null when the top two lanes tie on settled count", () => {
    expect(settleLead([10, 10])).toBeNull();
  });

  it("returns the max settled lane and margin over second place with three lanes", () => {
    expect(settleLead([5, 8, 12])).toEqual({ leaderIndex: 2, margin: 4 });
  });

  it("returns null when two lanes tie for the maximum settled count", () => {
    expect(settleLead([12, 12, 8])).toBeNull();
  });

  it("returns null for a single lane", () => {
    expect(settleLead([3])).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(settleLead([])).toBeNull();
  });

  it("returns null when any settled count is NaN", () => {
    expect(settleLead([1, Number.NaN])).toBeNull();
  });

  it("returns null when any settled count is positive infinity", () => {
    expect(settleLead([1, Number.POSITIVE_INFINITY])).toBeNull();
  });
});
