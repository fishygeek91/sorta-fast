import { describe, expect, it } from "vitest";

import { devicePx, devicePxInt } from "../src/render/devicePx.ts";

describe("issue #79 devicePx", () => {
  it("scales CSS pixels at 1× pixelScale", () => {
    expect(devicePx(2, 1)).toBe(2);
    expect(devicePx(3, 1)).toBe(3);
    expect(devicePx(16, 1)).toBe(16);
  });

  it("scales CSS pixels at 2× pixelScale", () => {
    expect(devicePx(2, 2)).toBe(4);
    expect(devicePx(3, 2)).toBe(6);
    expect(devicePx(16, 2)).toBe(32);
  });

  it("supports fractional pixelScale", () => {
    expect(devicePx(3, 1.25)).toBe(3.75);
  });

  it("throws on non-finite cssPx", () => {
    expect(() => devicePx(NaN, 1)).toThrow(/cssPx/);
    expect(() => devicePx(Infinity, 1)).toThrow(/cssPx/);
  });

  it("throws on invalid pixelScale", () => {
    expect(() => devicePx(2, 0)).toThrow(/pixelScale/);
    expect(() => devicePx(2, -1)).toThrow(/pixelScale/);
    expect(() => devicePx(2, NaN)).toThrow(/pixelScale/);
    expect(() => devicePx(2, Infinity)).toThrow(/pixelScale/);
  });
});

describe("issue #79 devicePxInt", () => {
  it("rounds scaled CSS pixels to integers at integer pixelScale", () => {
    expect(devicePxInt(2, 1)).toBe(2);
    expect(devicePxInt(2, 2)).toBe(4);
  });

  it("rounds fractional scaled values", () => {
    expect(devicePxInt(2, 1.25)).toBe(3);
  });

  it("floors to at least 1 backing pixel", () => {
    expect(devicePxInt(2, 0.1)).toBe(1);
  });

  it("throws on non-finite cssPx", () => {
    expect(() => devicePxInt(NaN, 1)).toThrow(/cssPx/);
    expect(() => devicePxInt(Infinity, 1)).toThrow(/cssPx/);
  });

  it("throws on invalid pixelScale", () => {
    expect(() => devicePxInt(2, 0)).toThrow(/pixelScale/);
    expect(() => devicePxInt(2, -1)).toThrow(/pixelScale/);
    expect(() => devicePxInt(2, NaN)).toThrow(/pixelScale/);
    expect(() => devicePxInt(2, Infinity)).toThrow(/pixelScale/);
  });
});
