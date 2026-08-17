/**
 * DMSY partial-sorting structure D — arXiv 2602.07868 Lemma 3.4 / Appendix A.2 (issue #25).
 *
 * Geometry: in-order array of blocks (the paper's BST of blocks). Pairs inside
 * a block are unsorted. A key→label store is the source of truth for membership
 * and size; blocks are a packed view used for interval search and Pull.
 */

import { type VertexId } from "../graph.ts";
import { SENTINEL } from "../trace.ts";
import { compareLabels, type DistanceLabel } from "./forest.ts";

/** Operand size and billed label comparisons for insert / merge. */
export type PartialSortOpResult = {
  readonly n: number;
  readonly cmps: number;
};

/** Pull output: extracted keys, new bound, operand size, and billed comparisons. */
export type PartialSortPullResult = {
  readonly keys: VertexId[];
  readonly bound: DistanceLabel;
  readonly n: number;
  readonly cmps: number;
};

/** Left endpoint of the initial interval `[0, B)` (DMSY-P26). */
export const ZERO_LABEL: DistanceLabel = {
  length: 0,
  nEdges: 0,
  curr: SENTINEL,
  pred: SENTINEL,
};

type SortPair = { readonly key: VertexId; readonly value: DistanceLabel };
type Block = {
  pairs: SortPair[];
  lo: DistanceLabel;
  hi: DistanceLabel;
  loKey: number;
  hiKey: number;
};
type Locator = { block: Block; offset: number };
type Cmps = { n: number };

function copyLabel(label: DistanceLabel): DistanceLabel {
  return { length: label.length, nEdges: label.nEdges, curr: label.curr, pred: label.pred };
}

function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function billedCmp(c: Cmps, a: DistanceLabel, b: DistanceLabel): "<" | "=" | ">" {
  c.n += 1;
  return compareLabels(a, b);
}

function pairLess(c: Cmps, a: SortPair, b: SortPair): boolean {
  const order = billedCmp(c, a.value, b.value);
  return order === "=" ? a.key < b.key : order === "<";
}

function pairBeforeLo(c: Cmps, pair: SortPair, block: Block): boolean {
  const order = billedCmp(c, pair.value, block.lo);
  return order === "=" ? pair.key < block.loKey : order === "<";
}

function pairAtOrAfterHi(c: Cmps, pair: SortPair, hi: DistanceLabel, hiKey: number): boolean {
  const order = billedCmp(c, pair.value, hi);
  return order === "=" ? pair.key >= hiKey : order === ">";
}

/**
 * Hoare-style selection of the 0-based k-th pair (adapted from BlockListD).
 */
function selectKthPair(c: Cmps, pairs: SortPair[], k: number): SortPair {
  let left = 0;
  let right = pairs.length - 1;
  while (left < right) {
    const pivot = must(pairs[left + ((right - left) >> 1)], "selectKthPair: missing pivot");
    let i = left - 1;
    let j = right + 1;
    for (;;) {
      do {
        i += 1;
      } while (pairLess(c, must(pairs[i], "selectKthPair: missing pair"), pivot));
      do {
        j -= 1;
      } while (pairLess(c, pivot, must(pairs[j], "selectKthPair: missing pair")));
      if (i >= j) {
        break;
      }
      const atI = must(pairs[i], "selectKthPair: swap i");
      pairs[i] = must(pairs[j], "selectKthPair: swap j");
      pairs[j] = atI;
    }
    if (k <= j) {
      right = j;
    } else {
      left = j + 1;
    }
  }
  return must(pairs[left], "selectKthPair: missing result");
}

function selectMSmallest(c: Cmps, pairs: readonly SortPair[], count: number): SortPair[] {
  if (pairs.length <= count) {
    return pairs.map((pair) => ({ key: pair.key, value: copyLabel(pair.value) }));
  }
  const work = pairs.map((pair) => ({ key: pair.key, value: copyLabel(pair.value) }));
  const threshold = selectKthPair(c, work, count - 1);
  const result: SortPair[] = [];
  for (const pair of pairs) {
    if (pairLess(c, pair, threshold)) {
      result.push(pair);
    }
  }
  if (result.length < count) {
    for (const pair of pairs) {
      if (result.length >= count) {
        break;
      }
      if (!pairLess(c, pair, threshold) && !pairLess(c, threshold, pair)) {
        result.push(pair);
      }
    }
  }
  return result;
}

/** Lemma 3.4 / Lemma A.2 partial-sort structure D for DMSY. */
export class PartialSortD {
  private readonly M: number;
  private readonly B: DistanceLabel;
  private readonly store: Map<VertexId, DistanceLabel>;
  private blocks: Block[];
  private readonly locators: Map<VertexId, Locator>;

  /**
   * Initialize D with one empty block on `[ZERO_LABEL, B)`.
   *
   * @param M - Block capacity; integer ≥ 1. `M = 1` is an ordinary BST.
   * @param B - Exclusive global upper bound (copied).
   * @throws If `M` is not an integer ≥ 1, or `B.length` is NaN / −∞.
   */
  constructor(M: number, B: DistanceLabel) {
    if (!Number.isInteger(M) || M < 1) {
      throw new Error(`M must be an integer >= 1, got ${String(M)}`);
    }
    if (!Number.isFinite(B.length) && B.length !== Number.POSITIVE_INFINITY) {
      throw new Error(`B.length must be finite or +Infinity, got ${String(B.length)}`);
    }
    this.M = M;
    this.B = copyLabel(B);
    this.store = new Map();
    this.locators = new Map();
    this.blocks = [this.rootBlock()];
  }

  /** Number of stored keys. */
  get size(): number {
    return this.store.size;
  }

  /** Alias of {@link size}: keys currently in the sorted region. */
  get sortedRegionSize(): number {
    return this.size;
  }

  /** Block capacity M. */
  get blockCapacity(): number {
    return this.M;
  }

  /**
   * Fraction of a caller-supplied frontier that currently lives in D.
   *
   * @param frontierSize - Positive integer size of the frontier (`|S|` or `|∪ P_j|`).
   * @throws If `frontierSize` is not an integer ≥ 1.
   */
  sortedRegionFraction(frontierSize: number): number {
    if (!Number.isInteger(frontierSize) || frontierSize < 1) {
      throw new Error(`frontierSize must be an integer >= 1, got ${String(frontierSize)}`);
    }
    return this.size / frontierSize;
  }

  /**
   * Insert or improve `key`. Keeps the Comparison-smaller label on duplicates.
   *
   * @param key - Vertex id.
   * @param value - Distance label; must be strictly `< B`.
   * @returns Operand size 1 and billed label comparisons.
   * @throws If `key` is not an integer or `value` is not `< B`.
   */
  insert(key: VertexId, value: DistanceLabel): PartialSortOpResult {
    const c: Cmps = { n: 0 };
    // arXiv 2602.07868 Lemma 3.4
    if (!Number.isInteger(key)) {
      throw new Error(`key must be an integer VertexId, got ${String(key)}`);
    }
    if (billedCmp(c, value, this.B) !== "<") {
      throw new Error("insert value must be strictly less than B");
    }
    const existing = this.store.get(key);
    if (existing !== undefined) {
      if (billedCmp(c, value, existing) !== "<") {
        return { n: 1, cmps: c.n };
      }
      this.removeKey(key);
    }
    const stored = copyLabel(value);
    this.store.set(key, stored);
    this.putPair(c, { key, value: stored });
    this.normalize(Math.ceil(this.M / 3), this.M, c);
    return { n: 1, cmps: c.n };
  }

  /**
   * Absorb `other` (consumed). Empty / `|D′| < M` / `|D′| ≥ M` per Lemma A.2.
   *
   * @param other - D′ with strictly smaller `M`; reset to empty on return.
   * @returns Operand size `|D′|` before the merge, plus billed comparisons.
   * @throws If nonempty `other.M >= this.M`.
   */
  merge(other: PartialSortD): PartialSortOpResult {
    const c: Cmps = { n: 0 };
    const n = other.size;
    if (n === 0) {
      return { n: 0, cmps: 0 };
    }
    if (other.M >= this.M) {
      throw new Error(`merge requires other.M < this.M, got ${other.M} >= ${this.M}`);
    }
    // arXiv 2602.07868 Lemma A.2
    const incoming = other.storePairs();
    other.resetToEmpty();
    for (const pair of incoming) {
      const existing = this.store.get(pair.key);
      if (existing !== undefined) {
        if (billedCmp(c, pair.value, existing) !== "<") {
          continue;
        }
        this.removeKey(pair.key);
      }
      const stored = copyLabel(pair.value);
      this.store.set(pair.key, stored);
      this.putPair(c, { key: pair.key, value: stored });
    }
    const pack: Cmps = { n: 0 };
    this.normalize(Math.ceil(this.M / 3), this.M, pack);
    return { n, cmps: c.n };
  }

  /**
   * Extract the M smallest keys (or all keys when `|D| ≤ M`).
   *
   * Selection runs on the store (source of truth) so Pull matches a naive
   * Comparison sort even if a prior packing drifted. Blocks are then
   * rebuilt from the leftover keys.
   *
   * @returns Keys sorted by id (unbilled), `B_pull`, operand `n`, billed `cmps`.
   */
  pull(): PartialSortPullResult {
    const c: Cmps = { n: 0 };
    // arXiv 2602.07868 Lemma 3.4
    const all = this.storePairs();
    if (all.length === 0) {
      return { keys: [], bound: copyLabel(this.B), n: 0, cmps: 0 };
    }
    if (all.length <= this.M) {
      const keys = all.map((pair) => pair.key).sort((a, b) => a - b);
      this.resetToEmpty();
      return { keys, bound: copyLabel(this.B), n: keys.length, cmps: 0 };
    }
    const ranked = all.map((pair) => ({ key: pair.key, value: copyLabel(pair.value) }));
    ranked.sort((a, b) => {
      const order = billedCmp(c, a.value, b.value);
      if (order !== "=") {
        return order === "<" ? -1 : 1;
      }
      return a.key - b.key;
    });
    const selected = ranked.slice(0, this.M);
    const threshold = must(ranked[this.M], "pull: missing (M+1)st pair");
    for (const pair of selected) {
      this.store.delete(pair.key);
    }
    this.repackFromStore();
    const pack: Cmps = { n: 0 };
    this.normalize(Math.ceil(this.M / 2), Math.max(1, Math.floor((2 * this.M) / 3)), pack);
    return {
      keys: selected.map((pair) => pair.key).sort((a, b) => a - b),
      bound: copyLabel(threshold.value),
      n: selected.length,
      cmps: c.n,
    };
  }

  /** In-order pair counts per block. */
  debugBlockSizes(): number[] {
    return this.blocks.map((block) => block.pairs.length);
  }

  private rootBlock(pairs: SortPair[] = []): Block {
    return {
      pairs,
      lo: copyLabel(ZERO_LABEL),
      hi: copyLabel(this.B),
      loKey: Number.NEGATIVE_INFINITY,
      hiKey: Number.POSITIVE_INFINITY,
    };
  }

  private resetToEmpty(): void {
    this.store.clear();
    this.locators.clear();
    this.blocks = [this.rootBlock()];
  }

  private storePairs(): SortPair[] {
    const out: SortPair[] = [];
    for (const [key, value] of this.store) {
      out.push({ key, value: copyLabel(value) });
    }
    return out;
  }

  private removeKey(key: VertexId): void {
    this.store.delete(key);
    const loc = this.locators.get(key);
    if (loc === undefined) {
      return;
    }
    const { block, offset } = loc;
    const last = block.pairs.length - 1;
    if (offset !== last) {
      const moved = must(block.pairs[last], "removeKey: missing last");
      block.pairs[offset] = moved;
      const movedLoc = this.locators.get(moved.key);
      if (movedLoc !== undefined) {
        movedLoc.offset = offset;
      }
    }
    block.pairs.pop();
    this.locators.delete(key);
  }

  private putPair(c: Cmps, pair: SortPair): void {
    const idx = this.findBlock(c, pair);
    const block = must(this.blocks[idx], "putPair: missing block");
    block.pairs.push(pair);
    this.locators.set(pair.key, { block, offset: block.pairs.length - 1 });
  }

  private findBlock(c: Cmps, pair: SortPair): number {
    let lo = 0;
    let hi = this.blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const block = must(this.blocks[mid], "findBlock: missing block");
      if (pairBeforeLo(c, pair, block)) {
        hi = mid;
      } else if (pairAtOrAfterHi(c, pair, block.hi, block.hiKey)) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }
    return Math.max(0, Math.min(lo, this.blocks.length - 1));
  }

  private remap(block: Block): void {
    for (let i = 0; i < block.pairs.length; i += 1) {
      const pair = must(block.pairs[i], "remap: missing pair");
      this.locators.set(pair.key, { block, offset: i });
    }
  }

  private rebuildLocators(): void {
    this.locators.clear();
    for (const block of this.blocks) {
      this.remap(block);
    }
  }

  private repackFromStore(): void {
    const pairs = this.storePairs();
    this.locators.clear();
    this.blocks = [this.rootBlock(pairs)];
    this.remap(must(this.blocks[0], "repack: missing root"));
  }

  private splitAt(index: number, c: Cmps, maxSize: number): void {
    const block = this.blocks[index];
    if (block === undefined || block.pairs.length <= maxSize || block.pairs.length < 2) {
      return;
    }
    const leftCount = Math.max(1, Math.floor(block.pairs.length / 2));
    const left = selectMSmallest(c, block.pairs, leftCount);
    const leftKeys = new Set(left.map((pair) => pair.key));
    const right = block.pairs.filter((pair) => !leftKeys.has(pair.key));
    if (right.length === 0) {
      return;
    }
    const cut = selectKthPair(
      c,
      right.map((pair) => ({ key: pair.key, value: copyLabel(pair.value) })),
      0,
    );
    const rightBlock: Block = {
      pairs: right,
      lo: copyLabel(cut.value),
      loKey: cut.key,
      hi: copyLabel(block.hi),
      hiKey: block.hiKey,
    };
    block.pairs = left;
    block.hi = copyLabel(cut.value);
    block.hiKey = cut.key;
    this.blocks.splice(index + 1, 0, rightBlock);
    this.remap(block);
    this.remap(rightBlock);
    if (rightBlock.pairs.length > maxSize) {
      this.splitAt(index + 1, c, maxSize);
    }
  }

  private joinAt(leftIndex: number, rightIndex: number): void {
    const left = must(this.blocks[leftIndex], "join: missing left");
    const right = must(this.blocks[rightIndex], "join: missing right");
    left.pairs = left.pairs.concat(right.pairs);
    left.hi = copyLabel(right.hi);
    left.hiKey = right.hiKey;
    this.blocks.splice(rightIndex, 1);
    this.remap(left);
  }

  private normalize(minSize: number, maxSize: number, c: Cmps): void {
    if (this.M === 1) {
      for (let i = 0; i < this.blocks.length; i += 1) {
        this.splitAt(i, c, 1);
      }
      this.dropEmptyBlocks();
      this.rebuildLocators();
      return;
    }
    if (this.size < Math.ceil(this.M / 3) && this.M >= 2) {
      this.repackFromStore();
      return;
    }
    for (let i = 0; i < this.blocks.length; i += 1) {
      const block = this.blocks[i];
      if (block === undefined) {
        continue;
      }
      let guard = 0;
      while (block.pairs.length > maxSize && guard < 8) {
        const before = block.pairs.length;
        this.splitAt(i, c, maxSize);
        if (block.pairs.length >= before) {
          break;
        }
        guard += 1;
      }
    }
    for (let i = 0; i < this.blocks.length;) {
      const block = this.blocks[i];
      if (block === undefined || this.blocks.length <= 1 || block.pairs.length >= minSize) {
        i += 1;
        continue;
      }
      if (i > 0) {
        this.joinAt(i - 1, i);
        continue;
      }
      if (i + 1 < this.blocks.length) {
        this.joinAt(i, i + 1);
        continue;
      }
      i += 1;
    }
    this.dropEmptyBlocks();
    this.rebuildLocators();
  }

  private dropEmptyBlocks(): void {
    this.blocks = this.blocks.filter((block) => block.pairs.length > 0);
    if (this.blocks.length === 0) {
      this.blocks = [this.rootBlock()];
    }
    const first = must(this.blocks[0], "dropEmpty: missing first");
    first.lo = copyLabel(ZERO_LABEL);
    first.loKey = Number.NEGATIVE_INFINITY;
    const last = must(this.blocks[this.blocks.length - 1], "dropEmpty: missing last");
    last.hi = copyLabel(this.B);
    last.hiKey = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.blocks.length - 1; i += 1) {
      const left = must(this.blocks[i], "dropEmpty: missing left");
      const right = must(this.blocks[i + 1], "dropEmpty: missing right");
      left.hi = copyLabel(right.lo);
      left.hiKey = right.loKey;
    }
  }
}
