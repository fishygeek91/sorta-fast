import { describe, expect, it } from "vitest";

import {
  defaultKtSweepConfig,
  resolveT,
  runKtSweep,
  shouldSkipKtSweepCell,
  sweepCell,
} from "../bench/bmssp-kt-sweep.ts";
import { paperBmsspParams } from "../src/core/bmssp/params.ts";
import { GRAPH_KINDS, SIZE_PRESETS } from "../src/core/graph.ts";

describe("bmssp k/t sweep bench", () => {
  it("resolveT maps variants to expected t formulas", () => {
    const n = 500;
    const k = 4;

    expect(resolveT(n, k, "paper")).toBe(paperBmsspParams(n).t);
    expect(resolveT(n, k, "k2")).toBe(k * k);
    expect(resolveT(n, k, "twoK")).toBe(2 * k);
  });

  it("defaultKtSweepConfig encodes issue #52 skip rules", () => {
    const config = defaultKtSweepConfig();

    expect(config.kinds).toEqual([...GRAPH_KINDS]);
    expect(config.sizes).not.toContain(SIZE_PRESETS.XL);
    expect(config.sizes).not.toContain(100_000);
    expect(config.sizes).toContain(SIZE_PRESETS.S);
    expect(config.sizes).toContain(SIZE_PRESETS.M);
    expect(config.sizes).toContain(SIZE_PRESETS.L);
    expect(config.kinds).toContain("maze");
    expect(config.seeds).toHaveLength(10);
    expect(config.seeds[0]).toBe(0);
    expect(config.seeds[9]).toBe(9);
  });

  it("shouldSkipKtSweepCell excludes city at L and XL", () => {
    expect(shouldSkipKtSweepCell("city", SIZE_PRESETS.L)).toBe(true);
    expect(shouldSkipKtSweepCell("maze", SIZE_PRESETS.L)).toBe(false);
    expect(shouldSkipKtSweepCell("city", SIZE_PRESETS.XL)).toBe(true);
    expect(shouldSkipKtSweepCell("maze", SIZE_PRESETS.S)).toBe(false);
  });

  it("sweepCell drains both lanes with finite positive work", () => {
    const cell = sweepCell("maze", 20, 0, 2, "paper");

    expect(cell.dijkstraWork).toBeGreaterThan(0);
    expect(cell.bmsspWork).toBeGreaterThan(0);
    expect(Number.isFinite(cell.ratio)).toBe(true);
    expect(cell.ratio).toBeGreaterThan(0);
    expect(cell.k).toBe(2);
    expect(cell.tVariant).toBe("paper");
    expect(cell.L).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("runKtSweep reuses Dijkstra work across k on the same graph", () => {
    const cells = runKtSweep({
      kinds: ["maze"],
      sizes: [20],
      seeds: [0],
      kValues: [2, 8],
      tVariants: ["paper"],
    });
    expect(cells).toHaveLength(2);
    const first = cells[0];
    const second = cells[1];
    if (first === undefined || second === undefined) {
      throw new Error("expected two sweep cells");
    }
    expect(first.dijkstraWork).toBe(second.dijkstraWork);
    expect(first.k).toBe(2);
    expect(second.k).toBe(8);
  }, 30_000);
});
