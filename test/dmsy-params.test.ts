import { describe, expect, it } from "vitest";

import {
  demoDmsyParams,
  dmsyParams,
  paperDmsyParams,
  type DmsyParamOptions,
} from "../src/core/dmsy/dmsy.ts";

describe("paperDmsyParams", () => {
  it("rejects invalid n", () => {
    for (const n of [0, -1, 0.5, Number.NaN]) {
      expect(() => paperDmsyParams(n)).toThrow(/n must be an integer >= 1/);
    }
  });

  it("returns k=1, t=1 for n=1", () => {
    expect(paperDmsyParams(1)).toEqual({ k: 1, t: 1 });
  });

  it("matches paper-notes §1.3 gallery table at delta=3", () => {
    const cases: Array<{ n: number; k: number; t: number }> = [
      { n: 500, k: 2, t: 4 },
      { n: 5000, k: 2, t: 4 },
      { n: 25000, k: 3, t: 5 },
      { n: 100000, k: 3, t: 5 },
    ];

    for (const { n, k, t } of cases) {
      expect(paperDmsyParams(n, 3)).toEqual({ k, t });
    }
  });
});

describe("demoDmsyParams", () => {
  it("rejects invalid n", () => {
    for (const n of [0, -1, 0.5, Number.NaN]) {
      expect(() => demoDmsyParams(n)).toThrow(/n must be an integer >= 1/);
    }
  });

  it("raises k to at least 6 while keeping paper t", () => {
    for (const n of [1, 8, 500, 25000, 100000]) {
      const paper = paperDmsyParams(n);
      expect(demoDmsyParams(n)).toEqual({
        k: Math.max(6, paper.k),
        t: paper.t,
      });
    }
  });

  it("uses k=6 at n=500, not BMSSP demo k=4", () => {
    const paper = paperDmsyParams(500);
    expect(paper.k).toBe(2);
    expect(demoDmsyParams(500)).toEqual({ k: 6, t: paper.t });
    expect(demoDmsyParams(500).k).not.toBe(Math.max(4, paper.k));
  });

  it("returns k=6, t=1 for n=1", () => {
    expect(demoDmsyParams(1)).toEqual({ k: 6, t: 1 });
  });
});

describe("dmsyParams", () => {
  it("rejects invalid n", () => {
    for (const n of [0, -1, 0.5, Number.NaN]) {
      expect(() => dmsyParams(n)).toThrow(/n must be an integer >= 1/);
    }
  });

  it("defaults to demo params for n=1", () => {
    expect(dmsyParams(1)).toEqual({ k: 6, t: 1 });
    expect(dmsyParams(1)).toEqual(demoDmsyParams(1));
  });

  it("returns k>=1, t>=1 for n=2", () => {
    const { k, t } = dmsyParams(2);
    expect(k).toBeGreaterThanOrEqual(1);
    expect(t).toBeGreaterThanOrEqual(1);
    expect(dmsyParams(2)).toEqual(demoDmsyParams(2));
  });

  it("is deterministic and satisfies k,t >= 1 for n=8 and n=500", () => {
    for (const n of [8, 500]) {
      const first = dmsyParams(n);
      const second = dmsyParams(n);
      expect(first.k).toBeGreaterThanOrEqual(1);
      expect(first.t).toBeGreaterThanOrEqual(1);
      expect(second).toEqual(first);
      expect(first).toEqual(demoDmsyParams(n));
    }
  });

  it("matches demo defaults for n=500, not paper", () => {
    const n = 500;
    const paper = paperDmsyParams(n);
    const demo = demoDmsyParams(n);
    expect(dmsyParams(n)).toEqual(demo);
    expect(demo).toEqual({ k: 6, t: paper.t });
    expect(demo.k).not.toBe(paper.k);
    expect(demo.k).toBe(6);
  });

  it("matches paper params when mode is paper", () => {
    for (const n of [1, 8, 500, 25000, 100000]) {
      expect(dmsyParams(n, { mode: "paper" })).toEqual(paperDmsyParams(n));
    }
  });

  it("applies optional k override while keeping demo t", () => {
    const n = 500;
    const demo = demoDmsyParams(n);
    expect(dmsyParams(n, { k: 8 })).toEqual({ k: 8, t: demo.t });
  });

  it("applies optional t override while keeping demo k", () => {
    const n = 500;
    const demo = demoDmsyParams(n);
    expect(dmsyParams(n, { t: 3 })).toEqual({ k: demo.k, t: 3 });
  });

  it("applies paper k override while keeping paper t", () => {
    const n = 500;
    const paper = paperDmsyParams(n);
    expect(dmsyParams(n, { mode: "paper", k: 8 })).toEqual({
      k: 8,
      t: paper.t,
    });
  });

  it("applies both k and t overrides", () => {
    expect(dmsyParams(500, { k: 8, t: 3 })).toEqual({ k: 8, t: 3 });
  });

  it("rejects invalid mode", () => {
    const options: DmsyParamOptions = { mode: "demo" };
    (options as { mode: string }).mode = "invalid";
    expect(() => dmsyParams(500, options)).toThrow(/mode must be "demo" or "paper"/);
  });

  it("rejects invalid k overrides", () => {
    for (const k of [0, -1, 1.5]) {
      expect(() => dmsyParams(500, { k })).toThrow(/k must be an integer >= 1/);
    }
  });

  it("rejects invalid t overrides", () => {
    expect(() => dmsyParams(500, { t: 0 })).toThrow(/t must be an integer >= 1/);
  });

  it("demo k is 6 at gallery n=500 and n=25000, never BMSSP demo k=4", () => {
    for (const n of [500, 25000]) {
      const demo = demoDmsyParams(n);
      expect(demo.k).toBe(6);
      expect(demo.k).not.toBe(4);
    }
  });
});
