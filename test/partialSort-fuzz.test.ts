import { describe, expect, it } from "vitest";

import {
  B_INFINITY,
  compareLabels,
  type DistanceLabel,
  type DistanceStore,
} from "../src/core/dmsy/forest.ts";
import {
  PartialSortD,
  type PartialSortOpResult,
  type PartialSortPullResult,
} from "../src/core/dmsy/partialSort.ts";
import { generateGraph, GRAPH_KINDS } from "../src/core/graph.ts";
import { mulberry32 } from "../src/core/prng.ts";
import { SENTINEL } from "../src/core/trace.ts";
import { drainFindPivotsForest, makeLabels } from "./forest-helpers.ts";

const LEMMA_34_SLACK = 32;

/** Build a distance label, copying fields into a fresh object. */
function lab(length: number, nEdges = 0, curr = 0, pred = SENTINEL): DistanceLabel {
  return { length, nEdges, curr, pred };
}

function copyLabel(label: DistanceLabel): DistanceLabel {
  return lab(label.length, label.nEdges, label.curr, label.pred);
}

function labelAt(dist: DistanceStore, v: number): DistanceLabel {
  return lab(dist.length[v], dist.nEdges[v], dist.curr[v], dist.pred[v]);
}

function pairLess(
  a: readonly [number, DistanceLabel],
  b: readonly [number, DistanceLabel],
): boolean {
  const order = compareLabels(a[1], b[1]);
  if (order === "<") {
    return true;
  }
  if (order === ">") {
    return false;
  }
  return a[0] < b[0];
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

/**
 * Naive Map reference for Lemma 3.4 D: insert keeps Comparison-smaller label,
 * merge inserts every pair from other, pull takes M smallest by (label, key),
 * keys sorted by id, bound = (M+1)st label or B when |D| ≤ M.
 */
class NaivePartialSort {
  private readonly M: number;
  private readonly B: DistanceLabel;
  private readonly map: Map<number, DistanceLabel>;

  constructor(M: number, B: DistanceLabel) {
    this.M = M;
    this.B = copyLabel(B);
    this.map = new Map();
  }

  get size(): number {
    return this.map.size;
  }

  entries(): [number, DistanceLabel][] {
    const out: [number, DistanceLabel][] = [];
    for (const entry of this.map) {
      out.push([entry[0], copyLabel(entry[1])]);
    }
    return out;
  }

  insert(key: number, value: DistanceLabel): PartialSortOpResult {
    const existing = this.map.get(key);
    if (existing !== undefined && compareLabels(value, existing) !== "<") {
      return { n: 1, cmps: 0 };
    }
    this.map.set(key, copyLabel(value));
    return { n: 1, cmps: 0 };
  }

  pull(): PartialSortPullResult {
    const sizeBefore = this.map.size;
    if (sizeBefore === 0) {
      return { keys: [], bound: copyLabel(this.B), n: 0, cmps: 0 };
    }

    const allPairs: [number, DistanceLabel][] = [];
    for (const [key, value] of this.map) {
      allPairs.push([key, value]);
    }

    if (sizeBefore <= this.M) {
      const keys = allPairs.map((pair) => pair[0]).sort((a, b) => a - b);
      this.map.clear();
      return { keys, bound: copyLabel(this.B), n: keys.length, cmps: 0 };
    }

    const sorted = allPairs.slice().sort((a, b) => {
      if (pairLess(a, b)) {
        return -1;
      }
      if (pairLess(b, a)) {
        return 1;
      }
      return 0;
    });
    const selected = sorted.slice(0, this.M);
    const keys = selected.map((pair) => pair[0]).sort((a, b) => a - b);
    for (const pair of selected) {
      this.map.delete(pair[0]);
    }

    const boundPair = sorted[this.M];
    if (boundPair === undefined) {
      throw new Error("NaivePartialSort.pull: missing (M+1)st pair");
    }
    return {
      keys,
      bound: copyLabel(boundPair[1]),
      n: keys.length,
      cmps: 0,
    };
  }
}

describe("PartialSortD differential fuzz", () => {
  it("matches naive Map reference on 200 seeded workloads including ties", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 200; seed += 1) {
      const rng = mulberry32(seed);
      const M = 2 + (seed % 6);
      const B = B_INFINITY;
      const d = new PartialSortD(M, B);
      const naive = new NaivePartialSort(M, B);

      let insertCount = 0;
      let insertCmps = 0;

      for (let op = 0; op < 40; op += 1) {
        const r = rng.next();

        if (r < 0.55) {
          const key = Math.floor(rng.next() * 20);
          const length = seed % 2 === 0 ? Math.floor(rng.next() * 5) : rng.next() * 100;
          const nEdges = Math.floor(rng.next() * 3);
          const curr = key;
          const label = lab(length, nEdges, curr, SENTINEL);

          let dRes: PartialSortOpResult;
          try {
            dRes = d.insert(key, label);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message === "insert value must be strictly less than B") {
              continue;
            }
            violations.push(`seed=${seed} op=${op} insert threw: ${message}`);
            continue;
          }
          naive.insert(key, label);
          insertCount += 1;
          insertCmps += dRes.cmps;

          if (d.size !== naive.size) {
            violations.push(
              `seed=${seed} op=${op} insert size mismatch d=${d.size} naive=${naive.size}`,
            );
          }
        } else if (r < 0.75 && d.size > 0) {
          const sizeBefore = d.size;
          let dRes: PartialSortPullResult;
          try {
            dRes = d.pull();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            violations.push(`seed=${seed} op=${op} pull threw: ${message}`);
            continue;
          }
          const nRes = naive.pull();

          // Lemma 3.4 Pull is O(|S′|) on a packed prefix. Selection is billed
          // over the live store (≤ N) with the same slack family as Insert.
          const pullBound =
            LEMMA_34_SLACK * Math.max(1, dRes.n) * (1 + Math.log2(sizeBefore / M + 2));
          if (dRes.cmps > pullBound) {
            violations.push(
              `seed=${seed} op=${op} pull cmps=${dRes.cmps} > ${pullBound} (n=${dRes.n})`,
            );
          }

          if (!keysEqual(dRes.keys, nRes.keys)) {
            violations.push(
              `seed=${seed} op=${op} pull keys mismatch d=${formatKeys(dRes.keys)} naive=${formatKeys(nRes.keys)}`,
            );
          }
          if (compareLabels(dRes.bound, nRes.bound) !== "=") {
            violations.push(
              `seed=${seed} op=${op} pull bound mismatch d=${dRes.bound.length} naive=${nRes.bound.length}`,
            );
          }
          if (dRes.n !== nRes.n) {
            violations.push(`seed=${seed} op=${op} pull n mismatch d=${dRes.n} naive=${nRes.n}`);
          }
          if (d.size !== naive.size) {
            violations.push(
              `seed=${seed} op=${op} pull size-after mismatch d=${d.size} naive=${naive.size}`,
            );
          }
        } else {
          const Mp = 1 + (seed % (M - 1));
          const other = new PartialSortD(Mp, B);
          const otherNaive = new NaivePartialSort(Mp, B);
          const L = 1 + Math.floor(rng.next() * (Mp === 1 ? 4 : 12));

          let mergeValid = true;
          for (let i = 0; i < L; i += 1) {
            const key = 20 + Math.floor(rng.next() * 15);
            const label = lab(
              seed % 2 === 0 ? Math.floor(rng.next() * 5) : rng.next() * 80,
              Math.floor(rng.next() * 3),
              key,
              SENTINEL,
            );
            try {
              other.insert(key, label);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              violations.push(`seed=${seed} op=${op} other.insert threw: ${message}`);
              mergeValid = false;
              break;
            }
            otherNaive.insert(key, label);
          }

          if (!mergeValid) {
            continue;
          }

          const nBefore = other.size;
          let dRes: PartialSortOpResult;
          try {
            dRes = d.merge(other);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            violations.push(`seed=${seed} op=${op} merge threw: ${message}`);
            continue;
          }
          for (const [k, v] of otherNaive.entries()) {
            naive.insert(k, v);
          }

          const mergeBound =
            LEMMA_34_SLACK * Math.max(1, nBefore) * (1 + Math.log2(Math.max(d.size, 1) / M + 2));
          if (dRes.cmps > mergeBound) {
            violations.push(
              `seed=${seed} op=${op} merge cmps=${dRes.cmps} > ${mergeBound} (nBefore=${nBefore})`,
            );
          }

          if (dRes.n !== nBefore) {
            violations.push(
              `seed=${seed} op=${op} merge n mismatch d=${dRes.n} nBefore=${nBefore}`,
            );
          }
          if (other.size !== 0) {
            violations.push(`seed=${seed} op=${op} merge other not empty size=${other.size}`);
          }
          if (d.size !== naive.size) {
            violations.push(
              `seed=${seed} op=${op} merge size mismatch d=${d.size} naive=${naive.size}`,
            );
          }
        }
      }

      if (insertCount > 0) {
        const N = Math.max(d.size, 1);
        const insertBound = LEMMA_34_SLACK * insertCount * (1 + Math.log2(N / M + 2));
        if (insertCmps > insertBound) {
          violations.push(
            `seed=${seed} insert cmps=${insertCmps} > ${insertBound} (I=${insertCount} N=${N} M=${M})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  }, 30_000);

  it("sorted region size is ~1/k of covered vertices on FindPivots workloads", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 80; seed += 1) {
      const kind = GRAPH_KINDS[seed % GRAPH_KINDS.length];
      const n = 32 + (seed % 49);
      const k = 2 + (seed % 2);
      const graph = generateGraph(kind, n, seed);
      const S = Array.from({ length: n }, (_, i) => i);
      const dist = makeLabels(n, S);

      let result;
      try {
        ({ result } = drainFindPivotsForest(graph, B_INFINITY, S, k, dist, 0));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        violations.push(`seed=${seed} FindPivots threw: ${message}`);
        continue;
      }

      const d = new PartialSortD(16, B_INFINITY);
      for (const p of result.P) {
        const label = labelAt(dist, p);
        if (compareLabels(label, B_INFINITY) === "<") {
          d.insert(p, label);
        }
      }

      let covered = 0;
      for (const group of result.groups) {
        covered += group.length;
      }

      if (d.sortedRegionSize !== result.P.length) {
        violations.push(
          `seed=${seed} sortedRegionSize=${d.sortedRegionSize} !== |P|=${result.P.length}`,
        );
      }
      if (covered > 0 && d.sortedRegionSize * k > covered + 3) {
        violations.push(
          `seed=${seed} sortedRegionSize*k=${d.sortedRegionSize * k} > covered+3=${covered + 3}`,
        );
      }
      if (d.sortedRegionSize !== result.groups.length) {
        violations.push(
          `seed=${seed} sortedRegionSize=${d.sortedRegionSize} !== groups.length=${result.groups.length}`,
        );
      }
    }

    expect(violations).toEqual([]);
  }, 30_000);
});
