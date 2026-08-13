/**
 * BMSSP bounded multi-source shortest paths (issues #11, #52); design.md §2.2.
 *
 * arXiv 2504.17033 Algorithm 3: recursive BMSSP with FindPivots, data structure D,
 * base-case mini-Dijkstra, and bounded relaxation. Emits {@link TraceEvent}s only;
 * distances and predecessors are returned after the top-level run completes.
 */

import { type Graph, type VertexId } from "../graph.ts";
import { OP_COST, SENTINEL, type TraceEvent } from "../trace.ts";
import { BlockListD, type DPair } from "./dstructure.ts";
import { findPivots } from "./findPivots.ts";
import { bmsspParams, type BmsspParams } from "./params.ts";

/** Initial heap capacity before doubling growth (matches Dijkstra lane). */
const INITIAL_HEAP_CAPACITY = 16;

/** Per-event relax/settle costs come from {@link OP_COST}; literals satisfy the trace union. */
const RELAX_EVENT_COST = OP_COST.relax satisfies 1;
const SETTLE_EVENT_COST = OP_COST.settle satisfies 1;

/**
 * Shortest-path distances and predecessor tree from a BMSSP run.
 *
 * `distances[v]` is `Infinity` when `v` is unreachable from the source.
 * `predecessors[v]` is {@link SENTINEL} for the source and for unreachable vertices.
 */
export type BmsspResult = {
  distances: Float64Array;
  predecessors: Int32Array;
};

/** Global settle order and per-vertex settled flag shared across recursion. */
type SettleState = {
  order: number;
  settled: Uint8Array;
};

/** Result of an internal {@link bmssp} call (arXiv 2504.17033 Algorithm 3). */
type BmsspCallResult = {
  Bprime: number;
  BprimeKey: number;
  U: VertexId[];
};

type PopMinResult = {
  v: number;
  key: number;
  cmps: number;
};

/**
 * Binary min-heap on distance keys (structure-of-arrays).
 *
 * Lazy deletion: each `push` appends a snapshot; no in-place decrease-key.
 * Private copy of the Dijkstra lane heap — extracting a shared module is a later task.
 */
class MinHeap {
  private vertices: Int32Array;
  private keys: Float64Array;
  private capacity: number;
  size: number;

  constructor() {
    this.capacity = INITIAL_HEAP_CAPACITY;
    this.vertices = new Int32Array(this.capacity);
    this.keys = new Float64Array(this.capacity);
    this.size = 0;
  }

  /** Double backing arrays when full. */
  private grow(): void {
    const newCapacity = this.capacity * 2;
    const newVertices = new Int32Array(newCapacity);
    const newKeys = new Float64Array(newCapacity);
    newVertices.set(this.vertices.subarray(0, this.size));
    newKeys.set(this.keys.subarray(0, this.size));
    this.vertices = newVertices;
    this.keys = newKeys;
    this.capacity = newCapacity;
  }

  private swap(i: number, j: number): void {
    const vi = this.vertices[i];
    const ki = this.keys[i];
    const vj = this.vertices[j];
    const kj = this.keys[j];
    if (vi === undefined || ki === undefined || vj === undefined || kj === undefined) {
      throw new Error(`heap swap: missing slot at ${i} or ${j}`);
    }
    this.vertices[i] = vj;
    this.keys[i] = kj;
    this.vertices[j] = vi;
    this.keys[j] = ki;
  }

  /** Sift `i` toward the root; return parent key comparisons performed. */
  private siftUp(i: number): number {
    let cmps = 0;
    let cur = i;
    while (cur > 0) {
      const p = (cur - 1) >> 1;
      const keyCur = this.keys[cur];
      const keyP = this.keys[p];
      if (keyCur === undefined || keyP === undefined) {
        throw new Error(`heap siftUp: missing key at ${cur} or ${p}`);
      }
      cmps += 1;
      if (keyCur >= keyP) {
        break;
      }
      this.swap(cur, p);
      cur = p;
    }
    return cmps;
  }

  /** Sift `i` toward the leaves; return child key comparisons performed. */
  private siftDown(i: number): number {
    let cmps = 0;
    let cur = i;
    for (;;) {
      const l = 2 * cur + 1;
      const r = 2 * cur + 2;
      let smallest = cur;

      if (l < this.size) {
        const keyL = this.keys[l];
        const keySmallest = this.keys[smallest];
        if (keyL === undefined || keySmallest === undefined) {
          throw new Error(`heap siftDown: missing key at ${l} or ${smallest}`);
        }
        cmps += 1;
        if (keyL < keySmallest) {
          smallest = l;
        }
      }

      if (r < this.size) {
        const keyR = this.keys[r];
        const keySmallest = this.keys[smallest];
        if (keyR === undefined || keySmallest === undefined) {
          throw new Error(`heap siftDown: missing key at ${r} or ${smallest}`);
        }
        cmps += 1;
        if (keyR < keySmallest) {
          smallest = r;
        }
      }

      if (smallest === cur) {
        break;
      }
      this.swap(cur, smallest);
      cur = smallest;
    }
    return cmps;
  }

  /** Append `(v, key)` and sift up; return sift-up comparison count. */
  push(v: number, key: number): number {
    if (this.size === this.capacity) {
      this.grow();
    }
    const idx = this.size;
    this.vertices[idx] = v;
    this.keys[idx] = key;
    this.size += 1;
    return this.siftUp(idx);
  }

  /** Remove and return the minimum entry plus sift-down comparison count. */
  popmin(): PopMinResult {
    if (this.size === 0) {
      throw new Error("heap popmin: empty heap");
    }

    const v = this.vertices[0];
    const key = this.keys[0];
    if (v === undefined || key === undefined) {
      throw new Error("heap popmin: missing root");
    }

    if (this.size === 1) {
      this.size = 0;
      return { v, key, cmps: 0 };
    }

    const last = this.size - 1;
    const lastV = this.vertices[last];
    const lastKey = this.keys[last];
    if (lastV === undefined || lastKey === undefined) {
      throw new Error(`heap popmin: missing last slot at ${last}`);
    }
    this.vertices[0] = lastV;
    this.keys[0] = lastKey;
    this.size = last;
    const cmps = this.siftDown(0);
    return { v, key, cmps };
  }
}

/**
 * Deduplicate source vertices preserving first-occurrence order.
 */
function dedupeSources(S: readonly VertexId[], n: number): VertexId[] {
  const seen = new Uint8Array(n);
  const sources: VertexId[] = [];
  for (const s of S) {
    if (seen[s] === 0) {
      seen[s] = 1;
      sources.push(s);
    }
  }
  return sources;
}

/** 2^exp with overflow guard. exp must be an integer >= 0. */
function pow2(exp: number): number {
  if (!Number.isInteger(exp) || exp < 0) {
    throw new Error(`pow2 exp must be an integer >= 0, got ${String(exp)}`);
  }
  if (exp === 0) {
    return 1;
  }
  if (exp < 31) {
    return 1 << exp;
  }
  if (exp < 53) {
    return 2 ** exp;
  }
  return Number.POSITIVE_INFINITY;
}

/** Algorithm 3: M = 2^{(l-1)·t} for D at level l >= 1. */
function blockCapacity(level: number, t: number): number {
  return pow2((level - 1) * t);
}

/** Algorithm 3 workload cap: k · 2^{l·t} */
function workloadCap(k: number, level: number, t: number): number {
  const p = pow2(level * t);
  if (!Number.isFinite(p)) {
    return Number.POSITIVE_INFINITY;
  }
  return k * p;
}

/**
 * Sentinel bound-key for a scalar-strict `value < bound` test (Assumption 2.1
 * unique lengths). Finite bound-keys encode D's (value, key) total order so
 * tied distances still satisfy Lemma 3.3 `max(S') < x ≤ min(D)` as pairs.
 */
const BOUND_KEY_STRICT = Number.NEGATIVE_INFINITY;

/**
 * Whether `(value, key)` is strictly below the pair bound `(bound, boundKey)`.
 *
 * D already orders pairs by value then key. Pull's scalar `bound` can equal a
 * pulled distance when several vertices share that distance; the pair test
 * keeps those pulled sources inside the child call.
 */
function lessPair(value: number, key: number, bound: number, boundKey: number): boolean {
  if (value < bound) {
    return true;
  }
  if (value > bound) {
    return false;
  }
  return key < boundKey;
}

/**
 * Lemma 3.3 separator key after Pull: if any pulled source sits at `Bi`, the
 * next vertex id after the max such key is the pair-order cut. Otherwise the
 * scalar bound is already strict (`max(S') < Bi`).
 */
function pullSeparatorKey(Si: readonly VertexId[], Bi: number, dist: Float64Array): number {
  let maxKeyAtBi = Number.NEGATIVE_INFINITY;
  let anyAtBi = false;
  for (const s of Si) {
    const ds = dist[s];
    if (ds === Bi) {
      anyAtBi = true;
      if (s > maxKeyAtBi) {
        maxKeyAtBi = s;
      }
    }
  }
  if (anyAtBi) {
    return maxKeyAtBi + 1;
  }
  return BOUND_KEY_STRICT;
}

/**
 * Lemma 3.3 BatchPrepend requires every value to be strictly smaller than
 * every value still in D. Remaining keys after Pull have pair-order ≥ (Bi, BiKey),
 * so scalar ties at Bi must go through Insert instead of BatchPrepend.
 */
function* ingestFrontBand(
  D: BlockListD,
  pairs: readonly DPair[],
  Bi: number,
  dstructB: number,
): Generator<TraceEvent, void, undefined> {
  if (pairs.length === 0) {
    return;
  }

  let allStrictlyBelowBi = true;
  for (const pair of pairs) {
    if (!(pair.value < Bi)) {
      allStrictlyBelowBi = false;
      break;
    }
  }

  if (allStrictlyBelowBi) {
    const prependResult = D.batchPrepend(pairs);
    yield {
      k: "dstruct",
      op: "batchPrepend",
      n: prependResult.n,
      cmps: prependResult.cmps,
    };
    return;
  }

  for (const pair of pairs) {
    if (!(Number.isFinite(pair.value) && pair.value < dstructB)) {
      continue;
    }
    const insertResult = D.insert(pair.key, pair.value);
    yield {
      k: "dstruct",
      op: "insert",
      n: insertResult.n,
      cmps: insertResult.cmps,
    };
  }
}

/**
 * Settle vertex `v` once globally; throws if `(dist[v], v)` is not below `(B, Bkey)`.
 */
function* emitSettle(
  v: VertexId,
  B: number,
  Bkey: number,
  dist: Float64Array,
  settleState: SettleState,
): Generator<TraceEvent, void, undefined> {
  if (settleState.settled[v] === 1) {
    return;
  }

  const distV = dist[v];
  if (distV === undefined) {
    throw new Error(`dist[${v}] missing`);
  }
  if (!lessPair(distV, v, B, Bkey)) {
    throw new Error(
      `BMSSP invariant: cannot settle vertex ${v} with dist ${String(distV)} >= bound ${String(B)}`,
    );
  }

  settleState.settled[v] = 1;
  yield { k: "settle", v, order: settleState.order, cost: SETTLE_EVENT_COST };
  settleState.order += 1;
}

/**
 * arXiv 2504.17033 Algorithm 2 base case: mini-Dijkstra from singleton S,
 * settling at most k+1 vertices (Remark 3.4 relaxation rule).
 */
function* baseMiniDijkstra(
  graph: Graph,
  B: number,
  Bkey: number,
  S: readonly VertexId[],
  k: number,
  dist: Float64Array,
  pred: Int32Array,
  settleState: SettleState,
): Generator<TraceEvent, BmsspCallResult, undefined> {
  const sources = dedupeSources(S, graph.n);
  if (sources.length !== 1) {
    throw new Error(`BaseCase requires singleton S, got ${String(sources.length)}`);
  }

  const x = sources[0];
  if (x === undefined) {
    throw new Error("BaseCase requires singleton S, got 0");
  }

  const startDist = dist[x];
  if (startDist === undefined) {
    throw new Error(`dist[${x}] missing`);
  }
  if (!Number.isFinite(startDist) || !lessPair(startDist, x, B, Bkey)) {
    return { Bprime: B, BprimeKey: Bkey, U: [] };
  }

  const heap = new MinHeap();
  const { offsets, targets, weights } = graph;

  const initialPushCmps = heap.push(x, startDist);
  yield { k: "heap", op: "push", cmps: initialPushCmps };

  const popped: VertexId[] = [];
  const inPopped = new Uint8Array(graph.n);

  while (heap.size > 0 && popped.length < k + 1) {
    const { v, key, cmps: popCmps } = heap.popmin();
    yield { k: "heap", op: "popmin", cmps: popCmps };

    const distV = dist[v];
    if (distV === undefined) {
      throw new Error(`dist[${v}] missing`);
    }

    // Stale-key skip only (arXiv 2504.17033 Algorithm 2); do not skip settled vertices —
    // a partial child may BatchPrepend a complete vertex back into D to be pulled again.
    if (key !== distV) {
      continue;
    }
    if (inPopped[v] === 1) {
      continue;
    }
    if (!lessPair(distV, v, B, Bkey)) {
      continue;
    }

    yield* emitSettle(v, B, Bkey, dist, settleState);
    inPopped[v] = 1;
    popped.push(v);

    const arcStart = offsets[v];
    const arcEnd = offsets[v + 1];
    if (arcStart === undefined || arcEnd === undefined) {
      throw new Error(`offsets for vertex ${v} missing`);
    }

    for (let e = arcStart; e < arcEnd; e += 1) {
      const to = targets[e];
      const w = weights[e];
      if (to === undefined || w === undefined) {
        throw new Error(`CSR arc ${e} missing`);
      }

      const cand = distV + w;
      if (!lessPair(cand, to, B, Bkey)) {
        continue;
      }

      const distTo = dist[to];
      if (distTo === undefined) {
        throw new Error(`dist[${to}] missing`);
      }

      // arXiv 2504.17033 Remark 3.4 / Algorithm 2: on cand <= dist, update and
      // ensure `to` is in the heap even when FindPivots already wrote the same
      // label — otherwise U0 never grows past the source and B' stays B.
      const improved = cand < distTo;
      yield { k: "relax", e, improved, cost: RELAX_EVENT_COST };

      if (cand <= distTo) {
        if (improved) {
          dist[to] = cand;
          pred[to] = v;
        }
        const pushCmps = heap.push(to, cand);
        yield { k: "heap", op: "push", cmps: pushCmps };
      }
    }
  }

  if (popped.length <= k) {
    return { Bprime: B, BprimeKey: Bkey, U: popped };
  }

  let Bprime = Number.NEGATIVE_INFINITY;
  for (const v of popped) {
    const dv = dist[v];
    if (dv === undefined) {
      throw new Error(`dist[${v}] missing`);
    }
    if (dv > Bprime) {
      Bprime = dv;
    }
  }

  const U: VertexId[] = [];
  for (const v of popped) {
    const dv = dist[v];
    if (dv === undefined) {
      throw new Error(`dist[${v}] missing`);
    }
    if (dv < Bprime) {
      U.push(v);
    }
  }

  return { Bprime, BprimeKey: BOUND_KEY_STRICT, U };
}

/**
 * Internal BMSSP recursion (arXiv 2504.17033 Algorithm 3).
 *
 * @param l - Recursion level (0 = base mini-Dijkstra).
 * @param B - Distance upper bound for this call (pair-ordered with `Bkey`).
 * @param Bkey - Vertex-id cut at `B`; {@link BOUND_KEY_STRICT} means scalar `value < B`.
 * @param S - Multi-source frontier.
 */
function* bmssp(
  graph: Graph,
  l: number,
  B: number,
  Bkey: number,
  S: readonly VertexId[],
  k: number,
  t: number,
  dist: Float64Array,
  pred: Int32Array,
  settleState: SettleState,
): Generator<TraceEvent, BmsspCallResult, undefined> {
  yield { k: "recurse", dir: "in", level: l, bound: B };

  let result: BmsspCallResult;

  if (l === 0) {
    result = yield* baseMiniDijkstra(graph, B, Bkey, S, k, dist, pred, settleState);
  } else {
    // arXiv 2504.17033 Algorithm 3 (recursive case)
    const pivotGen = findPivots(graph, B, S, k, dist, l);
    let pivotStep = pivotGen.next();
    while (!pivotStep.done) {
      yield pivotStep.value;
      pivotStep = pivotGen.next();
    }
    const pivotResult = pivotStep.value;
    const P = pivotResult.P;
    const W = pivotResult.W;

    // Algorithm 3: M = 2^{(l-1)·t}. When the call bound is a pair cut at B,
    // D's scalar cap is +∞ so sources with dist === B can be inserted; inserts
    // are still gated by lessPair(..., B, Bkey). Empty P leaves D empty.
    const M = blockCapacity(l, t);
    const dstructB = Bkey === BOUND_KEY_STRICT ? B : Number.POSITIVE_INFINITY;
    const D = new BlockListD(M, dstructB);
    const { offsets, targets, weights } = graph;

    for (const x of P) {
      const dx = dist[x];
      if (dx !== undefined && Number.isFinite(dx) && lessPair(dx, x, B, Bkey)) {
        const insertResult = D.insert(x, dx);
        yield {
          k: "dstruct",
          op: "insert",
          n: insertResult.n,
          cmps: insertResult.cmps,
        };
      }
    }

    const Uall: VertexId[] = [];
    const inUall = new Uint8Array(graph.n);
    let uCount = 0;
    const cap = workloadCap(k, l, t);
    let Bprime = B;
    let BprimeKey = Bkey;

    while (uCount < cap && D.size > 0) {
      const pullResult = D.pull();
      yield {
        k: "dstruct",
        op: "pull",
        n: pullResult.n,
        cmps: pullResult.cmps,
      };

      if (pullResult.keys.length === 0) {
        break;
      }

      const Si = pullResult.keys;
      let Bi = pullResult.bound;
      let BiKey = pullSeparatorKey(Si, Bi, dist);
      // Draining D returns the structure cap; keep this call's pair bound so a
      // pair-cut level does not recurse with +∞.
      if (D.size === 0) {
        Bi = B;
        BiKey = Bkey;
      }

      const child = yield* bmssp(graph, l - 1, Bi, BiKey, Si, k, t, dist, pred, settleState);
      const Bpi = child.Bprime;
      const BpiKey = child.BprimeKey;
      const Ui = child.U;

      for (const v of Ui) {
        if (inUall[v] === 0) {
          inUall[v] = 1;
          Uall.push(v);
          uCount += 1;
        }
      }

      const K: DPair[] = [];

      for (const u of Ui) {
        const du = dist[u];
        if (du === undefined || !Number.isFinite(du)) {
          continue;
        }

        const arcStart = offsets[u];
        const arcEnd = offsets[u + 1];
        if (arcStart === undefined || arcEnd === undefined) {
          throw new Error(`offsets for vertex ${u} missing`);
        }

        for (let e = arcStart; e < arcEnd; e += 1) {
          const to = targets[e];
          const w = weights[e];
          if (to === undefined || w === undefined) {
            throw new Error(`CSR arc ${e} missing`);
          }

          const cand = du + w;
          const distTo = dist[to];
          if (distTo === undefined) {
            throw new Error(`dist[${to}] missing`);
          }

          const improved = cand < distTo;
          yield { k: "relax", e, improved, cost: RELAX_EVENT_COST };

          if (cand <= distTo) {
            if (cand < distTo) {
              dist[to] = cand;
              pred[to] = u;
            }

            const inInsertBand =
              Number.isFinite(cand) &&
              !lessPair(cand, to, Bi, BiKey) &&
              lessPair(cand, to, B, Bkey);
            const inPrependBand =
              Number.isFinite(cand) &&
              !lessPair(cand, to, Bpi, BpiKey) &&
              lessPair(cand, to, Bi, BiKey);

            if (inInsertBand) {
              const insertResult = D.insert(to, cand);
              yield {
                k: "dstruct",
                op: "insert",
                n: insertResult.n,
                cmps: insertResult.cmps,
              };
            } else if (inPrependBand) {
              K.push({ key: to, value: cand });
            } else if (
              Number.isFinite(cand) &&
              settleState.settled[to] === 0 &&
              lessPair(cand, to, B, Bkey)
            ) {
              // Assumption 2.1 unique lengths makes cand < B'i already complete.
              // With ties, FindPivots may already have written the same label;
              // an unsettled vertex must still enter D or it never relaxes out.
              K.push({ key: to, value: cand });
            }
          }
        }
      }

      const siPairs: DPair[] = [];
      for (const x of Si) {
        const dx = dist[x];
        if (
          dx !== undefined &&
          Number.isFinite(dx) &&
          !lessPair(dx, x, Bpi, BpiKey) &&
          lessPair(dx, x, Bi, BiKey)
        ) {
          siPairs.push({ key: x, value: dx });
        }
      }
      // Algorithm 3 line 21: one BatchPrepend of K ∪ Si-in-window. Two prepends
      // would put Si in front of K and can hide smaller K keys from Pull's D0 prefix.
      yield* ingestFrontBand(D, K.concat(siPairs), Bi, dstructB);

      // Algorithm 3 prose step 5: D empty → successful execution, B' = B.
      if (D.size === 0) {
        Bprime = B;
        BprimeKey = Bkey;
        break;
      }

      // Algorithm 3 prose step 6 / Lemma 3.9: |U| >= k·2^{l·t} → partial, B' = B'_i.
      if (uCount >= cap) {
        Bprime = Bpi;
        BprimeKey = BpiKey;
        break;
      }
    }

    // Algorithm 3 final: U ← U ∪ {x ∈ W : d[x] < B'} in pair order.
    const U: VertexId[] = [];
    const inU = new Uint8Array(graph.n);

    for (const v of Uall) {
      const dv = dist[v];
      if (dv !== undefined && lessPair(dv, v, Bprime, BprimeKey)) {
        U.push(v);
        inU[v] = 1;
      }
    }

    for (const x of W) {
      const dx = dist[x];
      if (dx !== undefined && lessPair(dx, x, Bprime, BprimeKey)) {
        yield* emitSettle(x, B, Bkey, dist, settleState);
        if (inU[x] === 0) {
          inU[x] = 1;
          U.push(x);
        }
      }
    }

    result = { Bprime, BprimeKey, U };
  }

  yield { k: "recurse", dir: "out", level: l, bound: result.Bprime };
  return result;
}

/**
 * Instrumented BMSSP shortest-path generator (arXiv 2504.17033 Algorithm 3).
 *
 * Yields {@link TraceEvent} objects for recursion, pivots, data-structure ops,
 * heap operations, settlements, and relaxations, then returns distance and
 * predecessor arrays. Unreachable vertices remain at `Infinity` / {@link SENTINEL}.
 *
 * @param graph - CSR directed graph with non-negative weights.
 * @param source - Source vertex in `0 .. graph.n - 1`.
 * @param params - Optional BMSSP level/block parameters; defaults to {@link bmsspParams}(n).
 */
export function* run(
  graph: Graph,
  source: VertexId,
  params?: BmsspParams,
): Generator<TraceEvent, BmsspResult, undefined> {
  if (!Number.isInteger(source) || source < 0 || source >= graph.n) {
    throw new Error(`source must be an integer in [0, ${graph.n}), got ${String(source)}`);
  }

  const n = graph.n;

  let k: number;
  let t: number;
  if (params === undefined) {
    ({ k, t } = bmsspParams(n));
  } else {
    if (!Number.isInteger(params.k) || params.k < 1) {
      throw new Error(`k must be an integer >= 1, got ${String(params.k)}`);
    }
    if (!Number.isInteger(params.t) || params.t < 1) {
      throw new Error(`t must be an integer >= 1, got ${String(params.t)}`);
    }
    k = params.k;
    t = params.t;
  }

  const L = Math.max(1, Math.ceil(Math.log2(Math.max(2, n)) / t));

  const dist = new Float64Array(n);
  dist.fill(Number.POSITIVE_INFINITY);
  dist[source] = 0;

  const pred = new Int32Array(n);
  pred.fill(SENTINEL);

  const settleState: SettleState = {
    order: 0,
    settled: new Uint8Array(n),
  };

  yield* bmssp(
    graph,
    L,
    Number.POSITIVE_INFINITY,
    BOUND_KEY_STRICT,
    [source],
    k,
    t,
    dist,
    pred,
    settleState,
  );

  return { distances: dist, predecessors: pred };
}
