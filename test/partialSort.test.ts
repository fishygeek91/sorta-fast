import { describe, expect, it } from "vitest";

import { B_INFINITY, compareLabels, type DistanceLabel } from "../src/core/dmsy/forest.ts";
import { PartialSortD } from "../src/core/dmsy/partialSort.ts";
import {
  costOf,
  decodeChunk,
  OP_COST,
  SENTINEL,
  TraceWriter,
  type TraceEvent,
} from "../src/core/trace.ts";

/** Build a distance label with defaults for forest fields. */
function lab(length: number, nEdges = 0, curr = 0, pred = SENTINEL): DistanceLabel {
  return { length, nEdges, curr, pred };
}

/** True when two labels compare equal under lex order. */
function labelsEqual(a: DistanceLabel, b: DistanceLabel): boolean {
  return compareLabels(a, b) === "=";
}

/** Pull every key from `d`, returning keys in extraction order. */
function pullAllKeys(d: PartialSortD): number[] {
  const keys: number[] = [];
  while (d.size > 0) {
    const result = d.pull();
    keys.push(...result.keys);
  }
  return keys;
}

/**
 * Record key→label pairs, then pull-all and assert each key appears once
 * with the expected label (smaller label wins on duplicates).
 */
function expectPullAllLabels(d: PartialSortD, expected: ReadonlyMap<number, DistanceLabel>): void {
  const pulled = pullAllKeys(d);
  expect(pulled).toHaveLength(expected.size);
  expect(new Set(pulled)).toEqual(new Set(expected.keys()));

  const scratch = new PartialSortD(d.blockCapacity, B_INFINITY);
  for (const [key, value] of expected) {
    scratch.insert(key, value);
  }
  expect(pullAllKeys(scratch)).toEqual(pulled);
}

describe("PartialSortD constructor", () => {
  it("throws on invalid M", () => {
    for (const M of [0, -1, 1.5]) {
      expect(() => new PartialSortD(M, B_INFINITY)).toThrow(/integer >= 1/);
    }
  });

  it("throws on invalid B.length", () => {
    for (const length of [Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => new PartialSortD(4, lab(length))).toThrow(/finite or \+Infinity/);
    }
  });

  it("accepts B_INFINITY with size 0 and sortedRegionFraction(1) === 0", () => {
    const d = new PartialSortD(4, B_INFINITY);
    expect(d.size).toBe(0);
    expect(d.sortedRegionFraction(1)).toBe(0);
  });

  it("throws sortedRegionFraction(0)", () => {
    const d = new PartialSortD(4, B_INFINITY);
    expect(() => d.sortedRegionFraction(0)).toThrow(/integer >= 1/);
  });
});

describe("PartialSortD empty pull", () => {
  it("returns empty keys with global bound and zero n", () => {
    const B = lab(100);
    const d = new PartialSortD(4, B);
    const result = d.pull();
    expect(result.keys).toEqual([]);
    expect(labelsEqual(result.bound, B)).toBe(true);
    expect(result.n).toBe(0);
    expect(Number.isFinite(result.cmps)).toBe(true);
    expect(result.cmps).toBeGreaterThanOrEqual(0);
  });
});

describe("PartialSortD insert and pull", () => {
  it("pulls a single inserted key and clears D", () => {
    const d = new PartialSortD(4, B_INFINITY);
    d.insert(7, lab(3.5));
    const result = d.pull();
    expect(result.keys).toEqual([7]);
    expect(labelsEqual(result.bound, B_INFINITY)).toBe(true);
    expect(d.size).toBe(0);
  });
});

describe("PartialSortD duplicate keys", () => {
  it("keeps the smaller label for the same key", () => {
    const d = new PartialSortD(4, B_INFINITY);
    d.insert(1, lab(10));
    d.insert(1, lab(12));
    d.insert(1, lab(4));
    const result = d.pull();
    expect(result.keys).toEqual([1]);
    expect(d.size).toBe(0);
  });

  it("pulls the key with the smaller stored label when M=1", () => {
    const d = new PartialSortD(1, B_INFINITY);
    d.insert(1, lab(10));
    d.insert(2, lab(20));
    d.insert(1, lab(4));
    const result = d.pull();
    expect(result.keys).toEqual([1]);
    expect(labelsEqual(result.bound, lab(20))).toBe(true);
  });
});

describe("PartialSortD insert value >= B throws", () => {
  it("rejects labels at or above a finite B", () => {
    const B = lab(100);
    const d = new PartialSortD(4, B);
    expect(() => d.insert(1, lab(100))).toThrow(/strictly less than B/);
    expect(() => d.insert(1, lab(101))).toThrow(/strictly less than B/);
    expect(d.size).toBe(0);
  });
});

describe("PartialSortD M=1 BST", () => {
  it("pulls keys in label order one at a time", () => {
    const d = new PartialSortD(1, B_INFINITY);
    d.insert(3, lab(30));
    d.insert(1, lab(10));
    d.insert(2, lab(20));

    const first = d.pull();
    expect(first.keys).toEqual([1]);
    expect(labelsEqual(first.bound, lab(20))).toBe(true);

    const second = d.pull();
    expect(second.keys).toEqual([2]);
    expect(labelsEqual(second.bound, lab(30))).toBe(true);

    const third = d.pull();
    expect(third.keys).toEqual([3]);
    expect(labelsEqual(third.bound, B_INFINITY)).toBe(true);
  });
});

describe("PartialSortD all-equal labels", () => {
  it("returns the M smallest keys and the tied bound", () => {
    const d = new PartialSortD(2, B_INFINITY);
    for (let key = 0; key <= 3; key += 1) {
      d.insert(key, lab(5));
    }
    const result = d.pull();
    expect(result.n).toBe(2);
    expect(result.keys).toEqual([0, 1]);
    expect(labelsEqual(result.bound, lab(5))).toBe(true);
    expect(d.size).toBe(2);
  });
});

describe("PartialSortD interleaved insert/pull", () => {
  it("keeps size consistent through mixed ops", () => {
    const d = new PartialSortD(4, B_INFINITY);
    d.insert(10, lab(10));
    d.insert(11, lab(11));
    d.insert(12, lab(12));
    expect(d.size).toBe(3);

    const firstPull = d.pull();
    expect(firstPull.n).toBeGreaterThan(0);
    expect(d.size).toBe(3 - firstPull.n);

    d.insert(5, lab(5));
    expect(d.size).toBe(3 - firstPull.n + 1);

    const sizeBeforeFinalPull = d.size;
    const finalPull = d.pull();
    expect(d.size).toBe(0);
    expect(finalPull.n).toBe(sizeBeforeFinalPull);
  });
});

describe("PartialSortD merge empty", () => {
  it("leaves both structures unchanged when other is empty", () => {
    const d = new PartialSortD(4, B_INFINITY);
    const other = new PartialSortD(2, B_INFINITY);
    d.insert(1, lab(1));
    d.insert(2, lab(2));

    const result = d.merge(other);
    expect(result.n).toBe(0);
    expect(result.cmps).toBe(0);
    expect(d.size).toBe(2);
    expect(other.size).toBe(0);
  });
});

describe("PartialSortD merge tiny (|D′| < M)", () => {
  it.each([
    { otherM: 1, keys: [10] },
    { otherM: 2, keys: [20, 21, 22] },
  ])("absorbs other.M=$otherM with $keys.length key(s)", ({ otherM, keys }) => {
    const d = new PartialSortD(4, B_INFINITY);
    d.insert(1, lab(1));
    d.insert(2, lab(2));

    const other = new PartialSortD(otherM, B_INFINITY);
    for (const key of keys) {
      other.insert(key, lab(key));
    }

    const mergeRes = d.merge(other);
    expect(mergeRes.n).toBe(keys.length);
    expect(other.size).toBe(0);

    const expected = new Map<number, DistanceLabel>([
      [1, lab(1)],
      [2, lab(2)],
      ...keys.map((key) => [key, lab(key)] as const),
    ]);
    expectPullAllLabels(d, expected);
  });
});

describe("PartialSortD merge large (|D′| >= M)", () => {
  it("absorbs many keys from a smaller-M structure", () => {
    const d = new PartialSortD(8, B_INFINITY);
    d.insert(0, lab(0));

    const other = new PartialSortD(2, B_INFINITY);
    for (let key = 1; key <= 8; key += 1) {
      other.insert(key, lab(key));
    }

    const mergeRes = d.merge(other);
    expect(mergeRes.n).toBe(8);
    expect(other.size).toBe(0);

    const expected = new Map<number, DistanceLabel>();
    for (let key = 0; key <= 8; key += 1) {
      expected.set(key, lab(key));
    }
    expectPullAllLabels(d, expected);
  });
});

describe("PartialSortD merge duplicate keep-smaller", () => {
  it("keeps the smaller label when the same key exists in both", () => {
    const d = new PartialSortD(4, B_INFINITY);
    d.insert(5, lab(50));

    const other = new PartialSortD(2, B_INFINITY);
    other.insert(5, lab(10));
    other.insert(6, lab(60));

    d.merge(other);
    expect(other.size).toBe(0);

    const expected = new Map<number, DistanceLabel>([
      [5, lab(10)],
      [6, lab(60)],
    ]);
    expectPullAllLabels(d, expected);
  });
});

describe("PartialSortD merge throws if other.M >= this.M", () => {
  it("rejects a nonempty other with M not strictly smaller", () => {
    const d = new PartialSortD(4, B_INFINITY);
    const other = new PartialSortD(4, B_INFINITY);
    other.insert(1, lab(1));
    expect(() => d.merge(other)).toThrow(/other\.M < this\.M/);
  });
});

describe("PartialSortD adversarial", () => {
  it("normalizes blocks and pulls every inserted key once", () => {
    const M = 3;
    const d = new PartialSortD(M, B_INFINITY);
    for (let key = 0; key < 20; key += 1) {
      d.insert(key, lab(key));
      for (const blockSize of d.debugBlockSizes()) {
        expect(blockSize).toBeLessThanOrEqual(M);
      }
    }

    const pulled = pullAllKeys(d);
    expect(pulled).toHaveLength(20);
    expect(new Set(pulled)).toEqual(new Set(Array.from({ length: 20 }, (_, i) => i)));
  });

  it("collapses to one block when size stays below M/3", () => {
    const d = new PartialSortD(8, B_INFINITY);
    d.insert(0, lab(0));
    d.insert(1, lab(1));
    expect(d.debugBlockSizes()).toHaveLength(1);
  });
});

describe("PartialSortD golden TraceWriter", () => {
  it("encodes dstruct ops with correct billed costs", () => {
    const d = new PartialSortD(4, B_INFINITY);
    const insertRes = d.insert(3, lab(7));

    const other = new PartialSortD(2, B_INFINITY);
    other.insert(1, lab(1));
    const mergeRes = d.merge(other);

    const pullRes = d.pull();

    const events: TraceEvent[] = [
      { k: "dstruct", op: "insert", n: insertRes.n, cmps: insertRes.cmps },
      { k: "dstruct", op: "merge", n: mergeRes.n, cmps: mergeRes.cmps },
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
    expect(costOf(events[1])).toBe(mergeRes.cmps * OP_COST.comparison);
    expect(costOf(events[2])).toBe(pullRes.cmps * OP_COST.comparison);
  });
});
