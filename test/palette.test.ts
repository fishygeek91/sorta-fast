import { describe, expect, it } from "vitest";

import { cssColorForSettleOrder, PALETTE_STOPS, rgbAt } from "../src/render/palette.ts";

describe("palette", () => {
  it("precomputes 256 LUT stops", () => {
    expect(PALETTE_STOPS).toBe(256);
  });

  it("rgbAt samples distinct endpoints", () => {
    expect(rgbAt(0)).not.toBe(rgbAt(1));
  });

  it("rgbAt clamps out-of-range t", () => {
    expect(rgbAt(-1)).toBe(rgbAt(0));
    expect(rgbAt(2)).toBe(rgbAt(1));
  });

  it("cssColorForSettleOrder returns rgb() strings", () => {
    expect(cssColorForSettleOrder(0, 10)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it("cssColorForSettleOrder varies with settle order", () => {
    expect(cssColorForSettleOrder(0, 5)).not.toBe(cssColorForSettleOrder(4, 5));
  });

  it("rejects invalid settle-order inputs", () => {
    expect(() => cssColorForSettleOrder(-1, 10)).toThrow(RangeError);
    expect(() => cssColorForSettleOrder(0, 0)).toThrow(RangeError);
  });

  it("sweeps hue from first to last settle index", () => {
    const n = 8;
    expect(cssColorForSettleOrder(0, n)).not.toBe(cssColorForSettleOrder(n - 1, n));
  });
});
