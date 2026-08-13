import { describe, expect, it } from "vitest";

import {
  BlockListD,
  type DPair,
  type DOpResult,
  type DPullResult,
} from "../src/core/bmssp/dstructure.ts";
import { mulberry32 } from "../src/core/prng.ts";

const LEMMA_33_SLACK = 32;

/** Total order: smaller value, then smaller key. */
function pairLess(a: DPair, b: DPair): boolean {
  if (a.value !== b.value) {
    return a.value < b.value;
  }
  return a.key < b.key;
}

/** Collapse duplicate keys, keeping the smallest pair per key. */
function collapsePairs(pairs: readonly DPair[]): DPair[] {
  const byKey = new Map<number, DPair>();

  for (const pair of pairs) {
    const existing = byKey.get(pair.key);
    if (existing === undefined) {
      byKey.set(pair.key, { key: pair.key, value: pair.value });
      continue;
    }
    if (pairLess(pair, existing)) {
      byKey.set(pair.key, { key: pair.key, value: pair.value });
    }
  }

  const result: DPair[] = [];
  for (const pair of byKey.values()) {
    result.push(pair);
  }
  return result;
}

/**
 * Naive Map reference for Lemma 3.3 D: insert keeps strictly smaller value,
 * batchPrepend same, pull takes M smallest by (value, key), keys sorted by id,
 * bound = min remaining value or B; if size <= M pull all and bound = B.
 */
class NaiveD {
  private readonly M: number;
  private readonly B: number;
  private readonly map: Map<number, number>;

  constructor(M: number, B: number) {
    this.M = M;
    this.B = B;
    this.map = new Map();
  }

  get size(): number {
    return this.map.size;
  }

  insert(key: number, value: number): DOpResult {
    const existing = this.map.get(key);
    if (existing !== undefined && value >= existing) {
      return { n: 1, cmps: 0 };
    }
    this.map.set(key, value);
    return { n: 1, cmps: 0 };
  }

  batchPrepend(pairs: readonly DPair[]): DOpResult {
    const operandSize = pairs.length;
    if (operandSize === 0) {
      return { n: 0, cmps: 0 };
    }

    const collapsed = collapsePairs(pairs);
    for (const pair of collapsed) {
      this.map.set(pair.key, pair.value);
    }
    return { n: operandSize, cmps: 0 };
  }

  pull(): DPullResult {
    const sizeBefore = this.map.size;
    if (sizeBefore === 0) {
      return { keys: [], bound: this.B, n: 0, cmps: 0 };
    }

    const allPairs: DPair[] = [];
    for (const [key, value] of this.map) {
      allPairs.push({ key, value });
    }

    if (sizeBefore <= this.M) {
      const keys = allPairs.map((pair) => pair.key).sort((a, b) => a - b);
      this.map.clear();
      return { keys, bound: this.B, n: keys.length, cmps: 0 };
    }

    const sorted = allPairs.slice().sort((a, b) => {
      if (a.value !== b.value) {
        return a.value - b.value;
      }
      return a.key - b.key;
    });
    const selected = sorted.slice(0, this.M);
    const keys = selected.map((pair) => pair.key).sort((a, b) => a - b);
    for (const pair of selected) {
      this.map.delete(pair.key);
    }

    let minValue: number | undefined;
    for (const value of this.map.values()) {
      if (minValue === undefined || value < minValue) {
        minValue = value;
      }
    }
    const bound = minValue === undefined ? this.B : minValue;
    return { keys, bound, n: keys.length, cmps: 0 };
  }

  minValue(): number | undefined {
    let min: number | undefined;
    for (const value of this.map.values()) {
      if (min === undefined || value < min) {
        min = value;
      }
    }
    return min;
  }
}

function keysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function formatKeys(keys: readonly number[]): string {
  return `[${keys.join(",")}]`;
}

describe("BlockListD differential fuzz", () => {
  it("matches naive Map reference on 200 seeded workloads including ties", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 200; seed += 1) {
      const rng = mulberry32(seed);
      const M = 1 + (seed % 8);
      const B = 1_000_000;
      const d = new BlockListD(M, B);
      const naive = new NaiveD(M, B);

      let insertCmps = 0;
      let insertCount = 0;
      let maxSize = 0;

      for (let op = 0; op < 40; op += 1) {
        const r = rng.next();

        if (r < 0.5) {
          const key = Math.floor(rng.next() * 20);
          const value =
            seed % 2 === 0 ? Math.floor(rng.next() * 5) * 10 : Math.floor(rng.next() * 100);
          const dResult = d.insert(key, value);
          const naiveResult = naive.insert(key, value);

          insertCmps += dResult.cmps;
          insertCount += 1;
          maxSize = Math.max(maxSize, d.size, naive.size);

          if (dResult.n !== naiveResult.n) {
            violations.push(
              `seed=${seed} op=${op} insert n mismatch d=${dResult.n} naive=${naiveResult.n}`,
            );
          }
          if (d.size !== naive.size) {
            violations.push(
              `seed=${seed} op=${op} insert size mismatch d=${d.size} naive=${naive.size}`,
            );
          }
        } else if (r < 0.75) {
          const sizeBefore = d.size;
          const dResult = d.pull();
          const naiveResult = naive.pull();

          const pullBound = LEMMA_33_SLACK * (M + sizeBefore + 1);
          if (dResult.cmps > pullBound) {
            violations.push(
              `seed=${seed} op=${op} pull cmps=${dResult.cmps} > ${pullBound} (M=${M} sizeBefore=${sizeBefore})`,
            );
          }

          if (!keysEqual(dResult.keys, naiveResult.keys)) {
            violations.push(
              `seed=${seed} op=${op} pull keys mismatch d=${formatKeys(dResult.keys)} naive=${formatKeys(naiveResult.keys)}`,
            );
          }
          if (dResult.bound !== naiveResult.bound) {
            violations.push(
              `seed=${seed} op=${op} pull bound mismatch d=${dResult.bound} naive=${naiveResult.bound} keys=${formatKeys(dResult.keys)}`,
            );
          }
          if (dResult.n !== naiveResult.n) {
            violations.push(
              `seed=${seed} op=${op} pull n mismatch d=${dResult.n} naive=${naiveResult.n}`,
            );
          }
          if (d.size !== naive.size) {
            violations.push(
              `seed=${seed} op=${op} pull size-after mismatch d=${d.size} naive=${naive.size}`,
            );
          }

          maxSize = Math.max(maxSize, d.size, naive.size);
        } else {
          const pairCount = 1 + Math.floor(rng.next() * (M + 3));
          const pairs: DPair[] = [];
          const minSoFar = naive.minValue();

          if (naive.size === 0) {
            for (let i = 0; i < pairCount; i += 1) {
              pairs.push({
                key: Math.floor(rng.next() * 20),
                value: i,
              });
            }
          } else if (minSoFar !== undefined) {
            for (let i = 0; i < pairCount; i += 1) {
              pairs.push({
                key: Math.floor(rng.next() * 20),
                value: minSoFar - 1 - i,
              });
            }
          }

          const dResult = d.batchPrepend(pairs);
          const naiveResult = naive.batchPrepend(pairs);

          const L = pairs.length === 0 ? 1 : pairs.length;
          const batchBound = LEMMA_33_SLACK * L * (1 + Math.log2(L / M + 2));
          if (dResult.cmps > batchBound) {
            violations.push(
              `seed=${seed} op=${op} batchPrepend cmps=${dResult.cmps} > ${batchBound} (L=${L} M=${M})`,
            );
          }

          if (dResult.n !== naiveResult.n) {
            violations.push(
              `seed=${seed} op=${op} batchPrepend n mismatch d=${dResult.n} naive=${naiveResult.n}`,
            );
          }
          if (d.size !== naive.size) {
            violations.push(
              `seed=${seed} op=${op} batchPrepend size mismatch d=${d.size} naive=${naive.size}`,
            );
          }

          maxSize = Math.max(maxSize, d.size, naive.size);
        }
      }

      if (insertCount > 0) {
        const N = Math.max(1, maxSize);
        const insertBound = LEMMA_33_SLACK * insertCount * (1 + Math.log2(N / M + 2));
        if (insertCmps > insertBound) {
          violations.push(
            `seed=${seed} insert cmps=${insertCmps} > ${insertBound} (I=${insertCount} N=${N} M=${M})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  }, 30_000);
});
