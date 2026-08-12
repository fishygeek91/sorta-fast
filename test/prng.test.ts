import { describe, expect, it } from "vitest";

import { mulberry32 } from "../src/core/prng.ts";

const SAMPLE_COUNT = 1024;

describe("mulberry32", () => {
  it("yields an identical float stream for the same seed", () => {
    const a = mulberry32(1729);
    const b = mulberry32(1729);
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("yields an identical uint32 stream for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it("keeps next() in [0, 1)", () => {
    const rng = mulberry32(0);
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("keeps nextUint32() in 0 .. 2^32-1", () => {
    const rng = mulberry32(123456789);
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("shares one stream between next and nextUint32", () => {
    const floats = mulberry32(7);
    const ints = mulberry32(7);
    for (let i = 0; i < 64; i += 1) {
      expect(floats.next()).toBe(ints.nextUint32() / 0x1_0000_0000);
    }
  });

  it("diverges for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let identical = 0;
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      if (a.next() === b.next()) {
        identical += 1;
      }
    }
    expect(identical).toBeLessThan(SAMPLE_COUNT);
  });

  it("coerces the seed to Uint32", () => {
    const a = mulberry32(-1);
    const b = mulberry32(0xffffffff);
    expect(a.next()).toBe(b.next());
  });
});
