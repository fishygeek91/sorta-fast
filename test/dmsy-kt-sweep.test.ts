/**
 * Headless tests for DMSY k/t sweep bench (issue #54).
 */

import { describe, expect, it } from "vitest";

import {
  defaultKtSweepConfig,
  formatKtSweepMarkdown,
  resolveT,
  runKtSweep,
  shouldSkipInfiniteBlock,
  shouldSkipKtSweepCell,
  sweepCell,
  xlKtSweepConfig,
  type DmsyKtTVariant,
} from "../bench/dmsy-kt-sweep.ts";
import {
  paperDmsyParams,
  dmsyBlockSize,
  dmsyRecursionDepth,
  dmsyWorkloadCap,
} from "../src/core/dmsy/dmsy.ts";
import { degreeReduce } from "../src/core/dmsy/degreeReduce.ts";
import { generateGraph, GRAPH_KINDS, SIZE_PRESETS } from "../src/core/graph.ts";

describe("dmsy k/t sweep bench", () => {
  it("resolveT maps variants to expected t formulas", () => {
    const n = 500;
    const k = 4;
    const graph = generateGraph("maze", n, 0);
    const delta = degreeReduce(graph).delta ?? 3;
    const paperT = paperDmsyParams(n, delta).t;

    expect(resolveT(n, k, "paper", delta)).toBe(paperT);
    expect(resolveT(n, k, "twoK", delta)).toBe(8);
    expect(resolveT(n, k, "paperPlus2", delta)).toBe(paperT + 2);
  });

  it("defaultKtSweepConfig encodes issue #54 grid and skip rules", () => {
    const config = defaultKtSweepConfig();

    expect(config.kinds).toEqual([...GRAPH_KINDS]);
    expect(config.sizes).toContain(SIZE_PRESETS.S);
    expect(config.sizes).toContain(SIZE_PRESETS.M);
    expect(config.sizes).toContain(SIZE_PRESETS.L);
    expect(config.sizes).not.toContain(SIZE_PRESETS.XL);
    expect(config.sizes).not.toContain(100_000);
    expect(config.seeds).toHaveLength(10);
    expect(config.seeds[0]).toBe(0);
    expect(config.seeds[9]).toBe(9);
    expect(config.kValues).toEqual([2, 3, 4, 6, 8, 12, 16]);
    expect(config.tVariants).toEqual(["paper", "twoK", "paperPlus2"]);
    expect(config.tVariants).not.toContain("k2");
  });

  it("shouldSkipKtSweepCell excludes city at L and XL", () => {
    expect(shouldSkipKtSweepCell("city", SIZE_PRESETS.L)).toBe(true);
    expect(shouldSkipKtSweepCell("maze", SIZE_PRESETS.L)).toBe(false);
    expect(shouldSkipKtSweepCell("city", SIZE_PRESETS.XL)).toBe(true);
    expect(shouldSkipKtSweepCell("maze", SIZE_PRESETS.S)).toBe(false);
    expect(shouldSkipKtSweepCell("sparse", SIZE_PRESETS.XL)).toBe(true);
  });

  it("xlKtSweepConfig encodes issue #103 XL confirm grid", () => {
    const config = xlKtSweepConfig();

    expect(config.kinds).toEqual(["sparse"]);
    expect(config.sizes).toEqual([SIZE_PRESETS.XL]);
    expect(config.sizes[0]).toBe(100_000);
    expect(config.seeds).toEqual([0, 1, 2, 3, 4]);
    expect(config.kValues).toEqual([6]);
    expect(config.tVariants).toEqual(["paper"]);
  });

  it("formatKtSweepMarkdown notes XL included when --xl cells are present", () => {
    const md = formatKtSweepMarkdown([
      {
        kind: "sparse",
        n: SIZE_PRESETS.XL,
        seed: 0,
        k: 6,
        t: 5,
        tVariant: "paper",
        L: 4,
        dijkstraWork: 1,
        dmsyWork: 1,
        ratio: 1,
      },
    ]);

    expect(md).toContain("included");
    expect(md).toContain("--xl");
    expect(md).not.toContain("XL (100k) is omitted");
  });

  it("shouldSkipKtSweepCell skip matrix respects allowXl", () => {
    for (const kind of GRAPH_KINDS) {
      for (const n of [SIZE_PRESETS.S, SIZE_PRESETS.M, SIZE_PRESETS.L, SIZE_PRESETS.XL]) {
        const defaultSkip = shouldSkipKtSweepCell(kind, n);
        const xlAllowedSkip = shouldSkipKtSweepCell(kind, n, true);

        if (kind === "city" && n === SIZE_PRESETS.L) {
          expect(defaultSkip).toBe(true);
          expect(xlAllowedSkip).toBe(true);
        } else if (n === SIZE_PRESETS.XL) {
          expect(defaultSkip).toBe(true);
          expect(xlAllowedSkip).toBe(false);
        } else {
          expect(defaultSkip).toBe(false);
          expect(xlAllowedSkip).toBe(false);
        }
      }
    }
  });

  it("shouldSkipInfiniteBlock skips cells with non-finite block or cap", () => {
    expect(shouldSkipInfiniteBlock(500, 4)).toBe(false);

    const n = 2 ** 60;
    const t = 1;
    const l = dmsyRecursionDepth(n, t);
    const blockNonFinite = !Number.isFinite(dmsyBlockSize(l, t));
    const capNonFinite = !Number.isFinite(dmsyWorkloadCap(l, t));
    if (blockNonFinite || capNonFinite) {
      expect(shouldSkipInfiniteBlock(n, t)).toBe(true);
    }
    // Gallery n ≤ 25k never drives M or the workload cap to Infinity at t ≥ 1;
    // the n=2^60, t=1 case above exercises the skip path when pow2 overflows.
  });

  it("sweepCell drains both lanes with finite positive work", () => {
    const tVariant: DmsyKtTVariant = "paper";
    const cell = sweepCell("maze", 20, 0, 2, tVariant);

    expect(cell.dmsyWork).toBeGreaterThan(0);
    expect(cell.dijkstraWork).toBeGreaterThan(0);
    expect(Number.isFinite(cell.ratio)).toBe(true);
    expect(cell.ratio).toBeGreaterThan(0);
    expect(cell.k).toBe(2);
    expect(cell.tVariant).toBe(tVariant);
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
