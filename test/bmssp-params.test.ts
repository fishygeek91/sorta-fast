import { describe, expect, it } from "vitest";

import {
  bmsspParams,
  bmsspRecursionDepth,
  demoBmsspParams,
  paperBmsspParams,
} from "../src/core/bmssp/params.ts";

/** Mirror arXiv 2504.17033 §3.1 formulas for locked assertions. */
function expectedParams(n: number): { k: number; t: number } {
  if (n < 2) {
    return { k: 1, t: 1 };
  }
  const log2n = Math.log2(n);
  const k = Math.max(1, Math.floor(Math.pow(log2n, 1 / 3)));
  const t = Math.max(1, Math.floor(Math.pow(log2n, 2 / 3)));
  return { k, t };
}

describe("paperBmsspParams", () => {
  it("rejects invalid n", () => {
    for (const n of [0, -1, 0.5, Number.NaN]) {
      expect(() => paperBmsspParams(n)).toThrow(/integer >= 1/);
    }
  });

  it("matches paper formulas for n=1000", () => {
    const n = 1000;
    const expected = expectedParams(n);
    expect(paperBmsspParams(n)).toEqual(expected);
    expect(expected.k).toBe(2);
  });
});

describe("demoBmsspParams", () => {
  it("rejects invalid n", () => {
    for (const n of [0, -1, 0.5, Number.NaN]) {
      expect(() => demoBmsspParams(n)).toThrow(/integer >= 1/);
    }
  });

  it("raises k to at least 4 while keeping paper t", () => {
    for (const n of [1, 8, 1000, 25000]) {
      const paper = paperBmsspParams(n);
      expect(demoBmsspParams(n)).toEqual({
        k: Math.max(4, paper.k),
        t: paper.t,
      });
    }
  });

  it("returns k=4, t=1 for n=1", () => {
    expect(demoBmsspParams(1)).toEqual({ k: 4, t: 1 });
  });
});

describe("bmsspParams", () => {
  it("rejects invalid n", () => {
    for (const n of [0, -1, 0.5, Number.NaN]) {
      expect(() => bmsspParams(n)).toThrow(/integer >= 1/);
    }
  });

  it("defaults to demo params for n=1", () => {
    expect(bmsspParams(1)).toEqual({ k: 4, t: 1 });
    expect(bmsspParams(1)).toEqual(demoBmsspParams(1));
  });

  it("returns k>=1, t>=1 for n=2", () => {
    const { k, t } = bmsspParams(2);
    expect(k).toBeGreaterThanOrEqual(1);
    expect(t).toBeGreaterThanOrEqual(1);
    expect(bmsspParams(2)).toEqual(demoBmsspParams(2));
  });

  it("is deterministic and satisfies k,t >= 1 for n=8 and n=1000", () => {
    for (const n of [8, 1000]) {
      const first = bmsspParams(n);
      const second = bmsspParams(n);
      expect(first.k).toBeGreaterThanOrEqual(1);
      expect(first.t).toBeGreaterThanOrEqual(1);
      expect(second).toEqual(first);
      expect(first).toEqual(demoBmsspParams(n));
    }
  });

  it("matches demo defaults for n=1000, not paper", () => {
    const n = 1000;
    const paper = paperBmsspParams(n);
    const demo = demoBmsspParams(n);
    expect(bmsspParams(n)).toEqual(demo);
    expect(demo).toEqual({ k: 4, t: paper.t });
    expect(demo.k).not.toBe(paper.k);

    const log2n = Math.log2(n);
    expect(paper.t).toBe(Math.max(1, Math.floor(Math.pow(log2n, 2 / 3))));
    expect(demo.k).toBeGreaterThanOrEqual(4);
  });

  it("matches paper params when mode is paper", () => {
    for (const n of [1, 8, 1000, 25000]) {
      expect(bmsspParams(n, { mode: "paper" })).toEqual(paperBmsspParams(n));
    }
  });

  it("applies optional k override while keeping demo t", () => {
    const n = 1000;
    const demo = demoBmsspParams(n);
    expect(bmsspParams(n, { k: 8 })).toEqual({ k: 8, t: demo.t });
  });

  it("applies optional t override while keeping demo k", () => {
    const n = 1000;
    const demo = demoBmsspParams(n);
    expect(bmsspParams(n, { t: 3 })).toEqual({ k: demo.k, t: 3 });
  });

  it("applies paper k override while keeping paper t", () => {
    const n = 1000;
    const paper = paperBmsspParams(n);
    expect(bmsspParams(n, { mode: "paper", k: 8 })).toEqual({
      k: 8,
      t: paper.t,
    });
  });

  it("applies both k and t overrides", () => {
    expect(bmsspParams(1000, { k: 8, t: 3 })).toEqual({ k: 8, t: 3 });
  });

  it("rejects invalid k overrides", () => {
    for (const k of [0, -1, 1.5]) {
      expect(() => bmsspParams(1000, { k })).toThrow(/k must be an integer >= 1/);
    }
  });

  it("rejects invalid t overrides", () => {
    expect(() => bmsspParams(1000, { t: 0 })).toThrow(/t must be an integer >= 1/);
  });
});

describe("bmsspRecursionDepth", () => {
  it("returns 1 for n=1 regardless of t", () => {
    expect(bmsspRecursionDepth(1, 1)).toBe(1);
    expect(bmsspRecursionDepth(1, 5)).toBe(1);
  });

  it("matches Algorithm 3 L for sample (n, t) pairs", () => {
    expect(bmsspRecursionDepth(1000, paperBmsspParams(1000).t)).toBe(
      Math.max(1, Math.ceil(Math.log2(1000) / paperBmsspParams(1000).t)),
    );
    expect(bmsspRecursionDepth(8, 2)).toBe(Math.max(1, Math.ceil(Math.log2(8) / 2)));
  });

  it("rejects invalid n and t", () => {
    expect(() => bmsspRecursionDepth(0, 1)).toThrow(/integer >= 1/);
    expect(() => bmsspRecursionDepth(10, 0)).toThrow(/t must be an integer >= 1/);
  });
});
