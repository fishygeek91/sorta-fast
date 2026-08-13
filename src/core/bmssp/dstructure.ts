/**
 * BMSSP data structure D (issue #9); design.md §2.2; arXiv 2504.17033 Lemma 3.3.
 *
 * Linked-list-of-blocks partial-sort structure supporting Insert, BatchPrepend,
 * and Pull of the M smallest keys. Two block sequences D0 (prepends) and D1
 * (inserts); comparison counts surface via `{ k: "dstruct", ... }` trace events.
 */

/** Key–value pair stored in a D block. */
export type DPair = {
  readonly key: number;
  readonly value: number;
};

/** Result of Insert or BatchPrepend: operand size and billed comparisons. */
export type DOpResult = {
  readonly n: number;
  readonly cmps: number;
};

/** Result of Pull: extracted keys, new bound, operand size, and billed comparisons. */
export type DPullResult = {
  readonly keys: number[];
  readonly bound: number;
  readonly n: number;
  readonly cmps: number;
};

/** Internal block: unsorted pairs plus an upper bound (D1 only; D0 bounds unused). */
type Block = {
  pairs: DPair[];
  upperBound: number;
};

/** Locator for a key: block object reference and offset within that block. */
type Locator = {
  block: Block;
  offset: number;
};

/**
 * Lemma 3.3 data structure D: block-list partial sort for BMSSP.
 *
 * D0 holds batch-prepended pairs; D1 holds inserted pairs in blocks sorted by
 * upper bound. At most one pair per key; locators map keys to block slots.
 *
 * Billed comparisons are value/key total-order tests (Insert search, median
 * split, Pull select, bound). Map lookups and the final Pull key-id sort for
 * deterministic output are not billed — they are not paper value comparisons.
 */
export class BlockListD {
  private readonly M: number;
  private readonly B: number;
  private cmps: number;
  private d0: Block[];
  private d1: Block[];
  private readonly locators: Map<number, Locator>;

  /**
   * Initialize D with block capacity M and global upper bound B.
   *
   * @param M - Maximum pairs per block before split; integer ≥ 1.
   * @param B - Upper bound for the last D1 block; finite or `+Infinity`.
   */
  constructor(M: number, B: number) {
    if (!Number.isInteger(M) || M < 1) {
      throw new Error(`M must be an integer >= 1, got ${String(M)}`);
    }
    if (!Number.isFinite(B) && B !== Number.POSITIVE_INFINITY) {
      throw new Error(`B must be finite or +Infinity, got ${String(B)}`);
    }

    this.M = M;
    this.B = B;
    this.cmps = 0;
    this.d0 = [];
    this.d1 = [{ pairs: [], upperBound: B }];
    this.locators = new Map();
  }

  /** Number of unique keys currently stored in D. */
  get size(): number {
    return this.locators.size;
  }

  /**
   * Insert key `a` with value `b` into D1.
   *
   * arXiv 2504.17033 Lemma 3.3 Insert: binary-search D1 by upper bound, append,
   * split when a block exceeds M. Values must be strictly less than B (the
   * structure's global upper bound); `value >= B` throws rather than clamping
   * into the last D1 block and violating the block upper-bound invariant.
   *
   * @param key - Vertex / key identifier.
   * @param value - Distance value to insert; must be finite and `< B`.
   */
  insert(key: number, value: number): DOpResult {
    this.cmps = 0;

    if (!(Number.isFinite(value) && value < this.B)) {
      throw new Error(`insert value must be finite and < B, got ${String(value)}`);
    }

    const existing = this.locators.get(key);
    if (existing !== undefined) {
      const oldPair = this.pairAtLocator(existing);
      this.cmps += 1;
      if (value >= oldPair.value) {
        return { n: 1, cmps: this.cmps };
      }
      this.removePairAtLocator(existing);
    }

    const blockIndex = this.findD1BlockForValue(value);
    const block = this.d1[blockIndex];
    if (block === undefined) {
      throw new Error(`dstruct insert: missing D1 block at index ${blockIndex}`);
    }

    const offset = block.pairs.length;
    const pair: DPair = { key, value };
    block.pairs.push(pair);
    this.locators.set(key, { block, offset });

    // arXiv 2504.17033 Lemma 3.3: split oversized D1 block.
    this.splitD1BlockIfNeeded(blockIndex);

    return { n: 1, cmps: this.cmps };
  }

  /**
   * Batch-prepend pairs onto the front of D0.
   *
   * Caller contract: every value in `pairs` is strictly smaller than every
   * value currently in D. Violations are not redirected to insert().
   *
   * arXiv 2504.17033 Lemma 3.3 BatchPrepend.
   *
   * @param pairs - Pairs to prepend (may contain duplicate keys).
   */
  batchPrepend(pairs: readonly DPair[]): DOpResult {
    this.cmps = 0;
    const operandSize = pairs.length;

    if (operandSize === 0) {
      return { n: 0, cmps: 0 };
    }

    const collapsed = this.collapsePairs(pairs);

    for (const pair of collapsed) {
      const existing = this.locators.get(pair.key);
      if (existing !== undefined) {
        this.removePairAtLocator(existing);
      }
    }

    const newBlocks = this.buildD0Blocks(collapsed);
    this.d0 = [...newBlocks, ...this.d0];

    for (const block of newBlocks) {
      this.remapLocatorsForBlock(block);
    }

    return { n: operandSize, cmps: this.cmps };
  }

  /**
   * Pull the M smallest keys from D (or all keys when |D| ≤ M).
   *
   * arXiv 2504.17033 Lemma 3.3 Pull: collect a prefix of D0 and D1 blocks until
   * each side has ≥ M pairs (O(M) pairs; each block has size ≤ M), select M
   * smallest from that union, delete them, and take the bound from leftover
   * prefix pairs plus the first nonempty unconsumed D0/D1 block — not a full
   * |D| scan. Empty holes (BatchPrepend deleting the last key of a later
   * block) are skipped without billed compares.
   * Ties among equal values are broken by key inside the prefix only.
   */
  pull(): DPullResult {
    this.cmps = 0;

    const totalSize = this.locators.size;
    if (totalSize === 0) {
      return { keys: [], bound: this.B, n: 0, cmps: this.cmps };
    }

    if (totalSize <= this.M) {
      const allPairs = this.collectAllPairs();
      const keys = this.sortedKeysFromPairs(allPairs);
      this.locators.clear();
      this.d0 = [];
      this.d1 = [{ pairs: [], upperBound: this.B }];
      return { keys, bound: this.B, n: keys.length, cmps: this.cmps };
    }

    // Drop blocks emptied by a prior BatchPrepend/Insert overwrite so prefix
    // indices land on real data. Unbilled: length checks, not pair compares.
    this.cleanupEmptyBlocks();

    // Lemma 3.3: prefix blocks until ≥ M pairs per sequence, then select.
    const d0Prefix = this.collectPrefix(this.d0, this.M);
    const d1Prefix = this.collectPrefix(this.d1, this.M);
    const union = d0Prefix.pairs.concat(d1Prefix.pairs);
    const selected = this.selectMSmallest(union, this.M);
    const selectedKeys = new Set<number>();
    for (const pair of selected) {
      selectedKeys.add(pair.key);
    }

    const leftover: DPair[] = [];
    for (const pair of union) {
      if (!selectedKeys.has(pair.key)) {
        leftover.push(pair);
      }
    }

    const keys = this.sortedKeysFromPairs(selected);

    for (const pair of selected) {
      const locator = this.locators.get(pair.key);
      if (locator === undefined) {
        throw new Error(`dstruct pull: missing locator for key ${pair.key}`);
      }
      this.removePairAtLocator(locator);
    }

    const bound = this.boundAfterPrefixPull(leftover, this.d0, d0Prefix.end, this.d1, d1Prefix.end);
    this.cleanupEmptyBlocks();

    return { keys, bound, n: keys.length, cmps: this.cmps };
  }

  /**
   * Test-only: pair counts per D0 / D1 block in sequence order.
   */
  debugBlockSizes(): { d0: number[]; d1: number[] } {
    return {
      d0: this.d0.map((block) => block.pairs.length),
      d1: this.d1.map((block) => block.pairs.length),
    };
  }

  /** Total order: smaller value, then smaller key. Bills one comparison. */
  private less(a: DPair, b: DPair): boolean {
    this.cmps += 1;
    if (a.value !== b.value) {
      return a.value < b.value;
    }
    return a.key < b.key;
  }

  private pairAtLocator(locator: Locator): DPair {
    const pair = locator.block.pairs[locator.offset];
    if (pair === undefined) {
      throw new Error(`dstruct: missing pair at offset ${locator.offset}`);
    }
    return pair;
  }

  private removePairAtLocator(locator: Locator): void {
    const block = locator.block;
    const offset = locator.offset;
    const pair = block.pairs[offset];
    if (pair === undefined) {
      throw new Error(`dstruct remove: missing pair at offset ${offset}`);
    }

    const lastIdx = block.pairs.length - 1;
    if (offset !== lastIdx) {
      const lastPair = block.pairs[lastIdx];
      if (lastPair === undefined) {
        throw new Error(`dstruct remove: missing last pair at offset ${lastIdx}`);
      }
      block.pairs[offset] = lastPair;
      const lastLocator = this.locators.get(lastPair.key);
      if (lastLocator === undefined) {
        throw new Error(`dstruct remove: missing locator for key ${lastPair.key}`);
      }
      lastLocator.offset = offset;
    }
    block.pairs.pop();
    this.locators.delete(pair.key);
  }

  private remapLocatorsForBlock(block: Block): void {
    for (let i = 0; i < block.pairs.length; i += 1) {
      const pair = block.pairs[i];
      if (pair === undefined) {
        throw new Error(`dstruct remap: missing pair at offset ${i}`);
      }
      this.locators.set(pair.key, { block, offset: i });
    }
  }

  /** Leftmost D1 block index whose upper bound is ≥ value (Lemma 3.3 Insert step 2). */
  private findD1BlockForValue(value: number): number {
    let lo = 0;
    let hi = this.d1.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const block = this.d1[mid];
      if (block === undefined) {
        throw new Error(`dstruct findD1: missing block at index ${mid}`);
      }
      this.cmps += 1;
      if (block.upperBound >= value) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }

    if (lo >= this.d1.length) {
      return this.d1.length - 1;
    }
    return lo;
  }

  /** arXiv 2504.17033 Lemma 3.3: split D1 block when length exceeds M. */
  private splitD1BlockIfNeeded(blockIndex: number): void {
    let index = blockIndex;

    for (;;) {
      const block = this.d1[index];
      if (block === undefined) {
        throw new Error(`dstruct splitD1: missing block at index ${index}`);
      }
      if (block.pairs.length <= this.M) {
        return;
      }

      // Rank split (not a strict-less cut): all-equal keys would otherwise
      // send every pair to the right half and loop forever.
      const { left: leftPairs, right: rightPairs } = this.partitionByMedian(block.pairs);

      const rightUpper = block.upperBound;
      const replacement: Block[] = [];
      const leftMax = this.maxPair(leftPairs);

      if (leftPairs.length > 0) {
        replacement.push({
          pairs: leftPairs,
          upperBound: leftMax === undefined ? rightUpper : leftMax.value,
        });
      }
      if (rightPairs.length > 0) {
        replacement.push({ pairs: rightPairs, upperBound: rightUpper });
      }

      this.d1.splice(index, 1, ...replacement);

      for (const newBlock of replacement) {
        this.remapLocatorsForBlock(newBlock);
      }

      if (replacement.length === 0) {
        return;
      }

      // If a half still exceeds M (safety), split the oversized replacement block.
      let oversizedIndex = -1;
      for (let i = 0; i < replacement.length; i += 1) {
        const candidate = replacement[i];
        if (candidate === undefined) {
          throw new Error(`dstruct splitD1: missing replacement at ${i}`);
        }
        if (candidate.pairs.length > this.M) {
          oversizedIndex = index + i;
          break;
        }
      }

      if (oversizedIndex === -1) {
        return;
      }
      index = oversizedIndex;
    }
  }

  private collapsePairs(pairs: readonly DPair[]): DPair[] {
    const byKey = new Map<number, DPair>();

    for (const pair of pairs) {
      const existing = byKey.get(pair.key);
      if (existing === undefined) {
        byKey.set(pair.key, { key: pair.key, value: pair.value });
        continue;
      }
      if (this.less(pair, existing)) {
        byKey.set(pair.key, { key: pair.key, value: pair.value });
      }
    }

    const result: DPair[] = [];
    for (const pair of byKey.values()) {
      result.push(pair);
    }
    return result;
  }

  /** Build D0 blocks for a collapsed prepend list (Lemma 3.3 BatchPrepend). */
  private buildD0Blocks(collapsed: readonly DPair[]): Block[] {
    if (collapsed.length === 0) {
      return [];
    }

    if (collapsed.length <= this.M) {
      return [{ pairs: collapsed.slice(), upperBound: Number.NaN }];
    }

    const cap = Math.ceil(this.M / 2);
    return this.splitIntoBlocksRecursive(collapsed.slice(), cap);
  }

  /**
   * Recursively split pairs into blocks of at most `cap` elements via median partition.
   * Returns blocks in order: left subtree blocks, then right subtree blocks.
   */
  private splitIntoBlocksRecursive(pairs: DPair[], cap: number): Block[] {
    if (pairs.length <= cap) {
      return [{ pairs, upperBound: Number.NaN }];
    }

    const { left: leftPairs, right: rightPairs } = this.partitionByMedian(pairs);
    const leftBlocks = leftPairs.length === 0 ? [] : this.splitIntoBlocksRecursive(leftPairs, cap);
    const rightBlocks =
      rightPairs.length === 0 ? [] : this.splitIntoBlocksRecursive(rightPairs, cap);
    return leftBlocks.concat(rightBlocks);
  }

  /**
   * Split `pairs` into two nonempty halves by rank in pair order.
   *
   * Uses {@link selectMSmallest} so equal values still make progress (a
   * strict-less cut around the median would leave one half empty).
   */
  private partitionByMedian(pairs: readonly DPair[]): {
    left: DPair[];
    right: DPair[];
  } {
    if (pairs.length < 2) {
      throw new Error("dstruct partition: need at least 2 pairs");
    }

    const leftCount = Math.floor(pairs.length / 2);
    const left = this.selectMSmallest(pairs, leftCount);
    const leftKeys = new Set<number>();
    for (const pair of left) {
      leftKeys.add(pair.key);
    }

    const right: DPair[] = [];
    for (const pair of pairs) {
      if (!leftKeys.has(pair.key)) {
        right.push(pair);
      }
    }

    return { left, right };
  }

  /** Maximum pair in `pairs` under {@link less}; undefined when empty. */
  private maxPair(pairs: readonly DPair[]): DPair | undefined {
    let best: DPair | undefined;
    for (const pair of pairs) {
      if (best === undefined || this.less(best, pair)) {
        best = pair;
      }
    }
    return best;
  }

  /**
   * Hoare-style selection: k-th smallest pair (0-based) in pair order.
   * Pivot index = midpoint of the current range. Every pair compare uses {@link less}.
   */
  private selectKthPair(pairs: DPair[], k: number): DPair {
    let left = 0;
    let right = pairs.length - 1;

    while (left < right) {
      const pivotIndex = left + Math.floor((right - left) / 2);
      const pivot = pairs[pivotIndex];
      if (pivot === undefined) {
        throw new Error(`dstruct select: missing pivot at index ${pivotIndex}`);
      }

      let i = left - 1;
      let j = right + 1;

      for (;;) {
        let pi: DPair | undefined;
        do {
          i += 1;
          pi = pairs[i];
          if (pi === undefined) {
            throw new Error(`dstruct select: missing pair at index ${i}`);
          }
        } while (this.less(pi, pivot));

        let pj: DPair | undefined;
        do {
          j -= 1;
          pj = pairs[j];
          if (pj === undefined) {
            throw new Error(`dstruct select: missing pair at index ${j}`);
          }
        } while (this.less(pivot, pj));

        if (i >= j) {
          break;
        }

        const atI = pairs[i];
        const atJ = pairs[j];
        if (atI === undefined || atJ === undefined) {
          throw new Error(`dstruct select: missing pair during swap at ${i} or ${j}`);
        }
        pairs[i] = atJ;
        pairs[j] = atI;
      }

      const partitionEnd = j;
      if (k <= partitionEnd) {
        right = partitionEnd;
      } else {
        left = partitionEnd + 1;
      }
    }

    const result = pairs[left];
    if (result === undefined) {
      throw new Error(`dstruct select: missing result at index ${left}`);
    }
    return result;
  }

  private selectMSmallest(pairs: readonly DPair[], count: number): DPair[] {
    if (pairs.length <= count) {
      return pairs.slice();
    }

    const work = pairs.slice();
    const threshold = this.selectKthPair(work, count - 1);

    const strictlyLess: DPair[] = [];
    for (const pair of pairs) {
      if (this.less(pair, threshold)) {
        strictlyLess.push(pair);
      }
    }

    const result = strictlyLess.slice();
    if (result.length < count) {
      for (const pair of pairs) {
        if (result.length >= count) {
          break;
        }
        if (!this.less(pair, threshold) && !this.less(threshold, pair)) {
          result.push(pair);
        }
      }
    }

    return result;
  }

  private collectAllPairs(): DPair[] {
    const pairs: DPair[] = [];
    for (const block of this.d0) {
      for (const pair of block.pairs) {
        pairs.push(pair);
      }
    }
    for (const block of this.d1) {
      for (const pair of block.pairs) {
        pairs.push(pair);
      }
    }
    return pairs;
  }

  /**
   * Whole-block prefix until `maxPairs` pairs or the sequence is exhausted.
   * Each block has size ≤ M, so the result is O(M) pairs.
   */
  private collectPrefix(
    blocks: readonly Block[],
    maxPairs: number,
  ): { pairs: DPair[]; end: number } {
    const pairs: DPair[] = [];
    let end = 0;
    while (pairs.length < maxPairs && end < blocks.length) {
      const block = blocks[end];
      if (block === undefined) {
        throw new Error(`dstruct prefix: missing block at index ${end}`);
      }
      for (const pair of block.pairs) {
        pairs.push(pair);
      }
      end += 1;
    }
    return { pairs, end };
  }

  /**
   * Bound after a prefix Pull: min leftover in the O(M) prefix, else min of
   * the first nonempty unconsumed D0/D1 block. D0 is value-ordered
   * front-to-back (prepend contract: new batches < old D; rank-ordered splits
   * within a batch; D0 never split after creation), so the remaining D0 min
   * is in that first nonempty block — not a scan of every later D0 block.
   *
   * BatchPrepend of an existing key can leave an empty D0/D1 hole; walking
   * those holes is unbilled (length checks). Only the first nonempty block
   * is billed via {@link minPairInBlock}.
   */
  private boundAfterPrefixPull(
    leftover: readonly DPair[],
    d0: readonly Block[],
    d0End: number,
    d1: readonly Block[],
    d1End: number,
  ): number {
    let minPair: DPair | undefined;
    for (const pair of leftover) {
      if (minPair === undefined || this.less(pair, minPair)) {
        minPair = pair;
      }
    }
    minPair = this.minPairInBlock(this.firstNonEmptyBlock(d0, d0End), minPair);
    minPair = this.minPairInBlock(this.firstNonEmptyBlock(d1, d1End), minPair);
    if (minPair === undefined) {
      return this.B;
    }
    return minPair.value;
  }

  /**
   * First nonempty block at or after `start`, or undefined if none remain.
   * Skips empty holes without billed pair comparisons.
   */
  private firstNonEmptyBlock(blocks: readonly Block[], start: number): Block | undefined {
    for (let i = start; i < blocks.length; i += 1) {
      const block = blocks[i];
      if (block !== undefined && block.pairs.length > 0) {
        return block;
      }
    }
    return undefined;
  }

  private minPairInBlock(block: Block | undefined, current: DPair | undefined): DPair | undefined {
    if (block === undefined) {
      return current;
    }
    let best = current;
    for (const pair of block.pairs) {
      if (best === undefined || this.less(pair, best)) {
        best = pair;
      }
    }
    return best;
  }

  /** Key-id sort for deterministic Pull output; not a billed value comparison. */
  private sortedKeysFromPairs(pairs: readonly DPair[]): number[] {
    const keys = pairs.map((pair) => pair.key);
    keys.sort((a, b) => a - b);
    return keys;
  }

  private cleanupEmptyBlocks(): void {
    this.d0 = this.d0.filter((block) => block.pairs.length > 0);
    this.d1 = this.d1.filter((block) => block.pairs.length > 0);
    if (this.d1.length === 0) {
      this.d1.push({ pairs: [], upperBound: this.B });
    }
  }
}
