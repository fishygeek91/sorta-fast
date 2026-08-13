import { describe, expect, it } from "vitest";

import { bmsspParams } from "../src/core/bmssp/params.ts";

/** Mirror arXiv 2504.17033 §3.1 formulas for locked assertions. */
function expectedParams(n: number): { k: number; t: number } {
  if (n < 2) {
    return { k: 1, t: 1 };
  }
  const ln = Math.log(n);
  const k = Math.max(1, Math.floor(Math.pow(ln, 1 / 3)));
  const t = Math.max(1, Math.floor(Math.pow(ln, 2 / 3)));
  return { k, t };
}

describe("bmsspParams", () => {
  it("rejects invalid n", () => {
    for (const n of [0, -1, 0.5, Number.NaN]) {
      expect(() => bmsspParams(n)).toThrow(/integer >= 1/);
    }
  });

  it("returns k=1, t=1 for n=1", () => {
    expect(bmsspParams(1)).toEqual({ k: 1, t: 1 });
  });

  it("returns k>=1, t>=1 for n=2", () => {
    const { k, t } = bmsspParams(2);
    expect(k).toBeGreaterThanOrEqual(1);
    expect(t).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic and satisfies k,t >= 1 for n=8 and n=1000", () => {
    for (const n of [8, 1000]) {
      const first = bmsspParams(n);
      const second = bmsspParams(n);
      expect(first.k).toBeGreaterThanOrEqual(1);
      expect(first.t).toBeGreaterThanOrEqual(1);
      expect(second).toEqual(first);
    }
  });

  it("matches paper formulas for n=1000", () => {
    const n = 1000;
    const expected = expectedParams(n);
    expect(bmsspParams(n)).toEqual(expected);

    const ln = Math.log(n);
    expect(expected.k).toBe(Math.max(1, Math.floor(Math.pow(ln, 1 / 3))));
    expect(expected.t).toBe(Math.max(1, Math.floor(Math.pow(ln, 2 / 3))));
  });
});
