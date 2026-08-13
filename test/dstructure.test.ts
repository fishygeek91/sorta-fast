import { describe, expect, it } from "vitest";

import { BlockListD } from "../src/core/bmssp/dstructure.ts";
import { costOf, decodeChunk, OP_COST, TraceWriter, type TraceEvent } from "../src/core/trace.ts";

describe("BlockListD constructor", () => {
  it("throws on invalid M", () => {
    for (const M of [0, -1, 1.5]) {
      expect(() => new BlockListD(M, 100)).toThrow(/integer >= 1/);
    }
  });

  it("throws on invalid B", () => {
    for (const B of [Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => new BlockListD(4, B)).toThrow(/finite or \+Infinity/);
    }
  });

  it("accepts B=Infinity", () => {
    const d = new BlockListD(4, Number.POSITIVE_INFINITY);
    expect(d.size).toBe(0);
  });
});

describe("BlockListD empty pull", () => {
  it("returns empty keys with global bound and zero n", () => {
    const d = new BlockListD(4, 100);
    const result = d.pull();
    expect(result.keys).toEqual([]);
    expect(result.bound).toBe(100);
    expect(result.n).toBe(0);
    expect(Number.isFinite(result.cmps)).toBe(true);
    expect(result.cmps).toBeGreaterThanOrEqual(0);
  });
});

describe("BlockListD insert and pull", () => {
  it("pulls a single inserted key and clears D", () => {
    const d = new BlockListD(4, 100);
    d.insert(7, 3.5);
    const result = d.pull();
    expect(result.keys).toEqual([7]);
    expect(result.bound).toBe(100);
    expect(d.size).toBe(0);
  });
});

describe("BlockListD duplicate keys", () => {
  it("keeps the smaller value for the same key", () => {
    const d = new BlockListD(4, 100);
    d.insert(1, 10);
    d.insert(1, 12);
    d.insert(1, 4);
    const result = d.pull();
    expect(result.keys).toEqual([1]);
    expect(d.size).toBe(0);
  });

  it("pulls the key with the smaller stored value when M=1", () => {
    const d = new BlockListD(1, 100);
    d.insert(1, 10);
    d.insert(2, 20);
    d.insert(1, 4);
    const result = d.pull();
    expect(result.keys).toEqual([1]);
    expect(result.bound).toBe(20);
  });
});

describe("BlockListD batchPrepend", () => {
  it("places L<=M pairs in one D0 block", () => {
    const d = new BlockListD(4, 100);
    d.batchPrepend([
      { key: 0, value: 0 },
      { key: 1, value: 1 },
      { key: 2, value: 2 },
    ]);
    const sizes = d.debugBlockSizes();
    expect(sizes.d0).toEqual([3]);
    expect(sizes.d1).toEqual([0]);
  });

  it("splits L>M prepends into blocks of at most ceil(M/2)", () => {
    const M = 4;
    const cap = Math.ceil(M / 2);
    const d = new BlockListD(M, 100);
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      key: i,
      value: i,
    }));
    d.batchPrepend(pairs);
    const sizes = d.debugBlockSizes();
    for (const blockSize of sizes.d0) {
      expect(blockSize).toBeLessThanOrEqual(cap);
    }
    const total = sizes.d0.reduce((sum, n) => sum + n, 0);
    expect(total).toBe(10);
  });
});

describe("BlockListD split on insert", () => {
  it("splits D1 blocks and pulls the M smallest keys", () => {
    const d = new BlockListD(4, 1000);
    for (let i = 0; i <= 4; i += 1) {
      d.insert(i, i);
    }
    const sizes = d.debugBlockSizes();
    for (const blockSize of sizes.d1) {
      expect(blockSize).toBeLessThanOrEqual(4);
    }
    const total = sizes.d1.reduce((sum, n) => sum + n, 0);
    expect(total).toBe(5);

    const pull = d.pull();
    expect(pull.keys).toEqual([0, 1, 2, 3]);
    expect(pull.bound).toBe(4);
    expect(d.size).toBe(1);
  });
});

describe("BlockListD M=1 adversarial", () => {
  it("pulls one key at a time with correct bounds", () => {
    const B = 500;
    const d = new BlockListD(1, B);
    d.insert(0, 0);
    d.insert(1, 1);
    d.insert(2, 2);

    const first = d.pull();
    expect(first.keys).toEqual([0]);
    expect(first.bound).toBe(1);

    const second = d.pull();
    expect(second.keys).toEqual([1]);
    expect(second.bound).toBe(2);

    const third = d.pull();
    expect(third.keys).toEqual([2]);
    expect(third.bound).toBe(B);
  });
});

describe("BlockListD all-equal values", () => {
  it("does not hang and tie-breaks by key on pull", () => {
    const d = new BlockListD(2, 100);
    for (let key = 0; key <= 3; key += 1) {
      d.insert(key, 5);
    }
    const result = d.pull();
    expect(result.keys).toEqual([0, 1]);
    expect(result.bound).toBe(5);
  });
});

describe("BlockListD interleaved operations", () => {
  it("keeps non-negative size through mixed ops", () => {
    const d = new BlockListD(4, 1000);
    const assertNonNegativeSize = (): void => {
      expect(d.size).toBeGreaterThanOrEqual(0);
    };

    d.insert(10, 10);
    d.insert(11, 11);
    d.insert(12, 12);
    assertNonNegativeSize();

    d.batchPrepend([
      { key: 0, value: 0 },
      { key: 1, value: 1 },
    ]);
    assertNonNegativeSize();

    const firstPull = d.pull();
    expect(firstPull.n).toBeGreaterThan(0);
    assertNonNegativeSize();

    d.insert(5, 5);
    assertNonNegativeSize();

    const sizeBeforeFinalPull = d.size;
    const finalPull = d.pull();
    assertNonNegativeSize();
    expect(d.size).toBe(0);
    expect(finalPull.n).toBe(sizeBeforeFinalPull);
  });
});

describe("BlockListD key reuse after pull", () => {
  it("accepts a key again after it was pulled", () => {
    const d = new BlockListD(4, 100);
    d.insert(1, 10);
    d.pull();
    d.insert(1, 42);
    const result = d.pull();
    expect(result.keys).toEqual([1]);
  });
});

describe("BlockListD TraceWriter round-trip", () => {
  it("encodes dstruct ops with correct billed costs", () => {
    const d = new BlockListD(4, 100);
    const insertRes = d.insert(3, 7);
    const batchRes = d.batchPrepend([
      { key: 0, value: 0 },
      { key: 1, value: 1 },
    ]);
    const pullRes = d.pull();

    const events: TraceEvent[] = [
      { k: "dstruct", op: "insert", n: insertRes.n, cmps: insertRes.cmps },
      { k: "dstruct", op: "batchPrepend", n: batchRes.n, cmps: batchRes.cmps },
      { k: "dstruct", op: "pull", n: pullRes.n, cmps: pullRes.cmps },
    ];

    const writer = new TraceWriter();
    for (const event of events) {
      writer.append(event);
    }
    const chunks = writer.takeChunks();
    const decoded = chunks.flatMap((chunk) => decodeChunk(chunk));
    expect(decoded).toEqual(events);

    expect(costOf(events[0])).toBe(insertRes.cmps * OP_COST.comparison);
    expect(costOf(events[1])).toBe(batchRes.cmps * OP_COST.comparison);
    expect(costOf(events[2])).toBe(pullRes.cmps * OP_COST.comparison);
  });
});
