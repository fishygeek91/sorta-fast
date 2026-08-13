/**
 * BMSSP bounded multi-source shortest paths (issue #11); design.md §2.2.
 *
 * arXiv 2504.17033 Algorithm 3: recursive BMSSP with FindPivots, data structure D,
 * base-case mini-Dijkstra, and bounded relaxation. Emits {@link TraceEvent}s only;
 * distances and predecessors are returned after the top-level run completes.
 */

import { type Graph, type VertexId } from "../graph.ts";
import { OP_COST, SENTINEL, type TraceEvent } from "../trace.ts";
import { BlockListD, type DPair } from "./dstructure.ts";
import { findPivots } from "./findPivots.ts";
import { bmsspParams } from "./params.ts";

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
 * Private copy of the Dijkstra lane heap (not exported from `dijkstra.ts`).
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

/**
 * Block capacity M = 2^t for data structure D (Lemma 3.3).
 */
function blockCapacity(t: number): number {
  if (t < 31) {
    return 1 << t;
  }
  return Math.pow(2, t);
}

/**
 * Settle vertex `v` once globally; throws if `dist[v] >= B` (debug invariant).
 */
function* emitSettle(
  v: VertexId,
  B: number,
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
  if (distV >= B) {
    throw new Error(
      `BMSSP invariant: cannot settle vertex ${v} with dist ${String(distV)} >= bound ${String(B)}`,
    );
  }

  settleState.settled[v] = 1;
  yield { k: "settle", v, order: settleState.order, cost: SETTLE_EVENT_COST };
  settleState.order += 1;
}

/**
 * arXiv 2504.17033 Algorithm 3 base case (`l = 0`): mini-Dijkstra from S,
 * settling at most k+1 vertices with edge relaxations only when `nd < B`.
 */
function* baseMiniDijkstra(
  graph: Graph,
  B: number,
  S: readonly VertexId[],
  k: number,
  dist: Float64Array,
  pred: Int32Array,
  settleState: SettleState,
): Generator<TraceEvent, BmsspCallResult, undefined> {
  const heap = new MinHeap();
  const { offsets, targets, weights } = graph;

  // arXiv 2504.17033 Algorithm 3 base case: start from a single x ∈ S
  // (choose the minimum current distance when |S| > 1).
  let start: VertexId | undefined;
  let startDist = Number.POSITIVE_INFINITY;
  for (const x of S) {
    const dx = dist[x];
    if (dx === undefined) {
      throw new Error(`dist[${x}] missing`);
    }
    if (Number.isFinite(dx) && dx < B && dx < startDist) {
      start = x;
      startDist = dx;
    }
  }

  if (start === undefined) {
    return { Bprime: B, U: [] };
  }

  const initialPushCmps = heap.push(start, startDist);
  yield { k: "heap", op: "push", cmps: initialPushCmps };

  const popped: VertexId[] = [];

  while (heap.size > 0 && popped.length < k + 1) {
    const { v, key, cmps: popCmps } = heap.popmin();
    yield { k: "heap", op: "popmin", cmps: popCmps };

    const distV = dist[v];
    if (distV === undefined) {
      throw new Error(`dist[${v}] missing`);
    }

    if (key !== distV) {
      continue;
    }
    if (settleState.settled[v] === 1) {
      continue;
    }

    yield* emitSettle(v, B, dist, settleState);
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
      if (!(cand < B)) {
        continue;
      }

      const distTo = dist[to];
      if (distTo === undefined) {
        throw new Error(`dist[${to}] missing`);
      }

      const improved = cand < distTo;
      yield { k: "relax", e, improved, cost: RELAX_EVENT_COST };

      if (improved) {
        dist[to] = cand;
        pred[to] = v;
        const pushCmps = heap.push(to, cand);
        yield { k: "heap", op: "push", cmps: pushCmps };
      }
    }
  }

  if (popped.length <= k) {
    return { Bprime: B, U: popped };
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

  return { Bprime, U };
}

/**
 * Bounded multi-source Dijkstra from `sources` with relaxations only when `nd < B`.
 * Settles vertices not already marked in `settleState`.
 */
function* boundedMultiSourceDijkstra(
  graph: Graph,
  B: number,
  sources: readonly VertexId[],
  dist: Float64Array,
  pred: Int32Array,
  settleState: SettleState,
): Generator<TraceEvent, void, undefined> {
  const heap = new MinHeap();
  const { offsets, targets, weights } = graph;

  for (const x of sources) {
    const dx = dist[x];
    if (dx === undefined) {
      throw new Error(`dist[${x}] missing`);
    }
    if (Number.isFinite(dx) && dx < B) {
      const pushCmps = heap.push(x, dx);
      yield { k: "heap", op: "push", cmps: pushCmps };
    }
  }

  while (heap.size > 0) {
    const { v, key, cmps: popCmps } = heap.popmin();
    yield { k: "heap", op: "popmin", cmps: popCmps };

    const distV = dist[v];
    if (distV === undefined) {
      throw new Error(`dist[${v}] missing`);
    }

    if (key !== distV) {
      continue;
    }
    if (settleState.settled[v] === 1) {
      continue;
    }

    yield* emitSettle(v, B, dist, settleState);

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
      if (!(cand < B)) {
        continue;
      }

      const distTo = dist[to];
      if (distTo === undefined) {
        throw new Error(`dist[${to}] missing`);
      }

      const improved = cand < distTo;
      yield { k: "relax", e, improved, cost: RELAX_EVENT_COST };

      if (improved) {
        dist[to] = cand;
        pred[to] = v;
        const pushCmps = heap.push(to, cand);
        yield { k: "heap", op: "push", cmps: pushCmps };
      }
    }
  }
}

/**
 * Internal BMSSP recursion (arXiv 2504.17033 Algorithm 3).
 *
 * @param l - Recursion level (0 = base mini-Dijkstra).
 * @param B - Distance upper bound for this call.
 * @param S - Multi-source frontier.
 */
function* bmssp(
  graph: Graph,
  l: number,
  B: number,
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
    result = yield* baseMiniDijkstra(graph, B, S, k, dist, pred, settleState);
  } else {
    // arXiv 2504.17033 Algorithm 3 (recursive case)
    const pivotGen = findPivots(graph, B, S, k, dist, l);
    let pivotStep = pivotGen.next();
    while (!pivotStep.done) {
      yield pivotStep.value;
      pivotStep = pivotGen.next();
    }
    const pivotResult = pivotStep.value;
    let P = pivotResult.P;
    const W = pivotResult.W;

    if (P.length === 0) {
      P = dedupeSources(S, graph.n);
    }

    const M = blockCapacity(t);
    const D = new BlockListD(M, B);
    const { offsets, targets, weights } = graph;

    for (const x of P) {
      const dx = dist[x];
      if (dx !== undefined && Number.isFinite(dx) && dx < B) {
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

    while (D.size > 0) {
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
      const Bi = pullResult.bound;

      const child = yield* bmssp(graph, l - 1, Bi, Si, k, t, dist, pred, settleState);
      const Bpi = child.Bprime;
      const Ui = child.U;
      Uall.push(...Ui);

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

            if (Bi <= cand && cand < B && Number.isFinite(cand)) {
              const insertResult = D.insert(to, cand);
              yield {
                k: "dstruct",
                op: "insert",
                n: insertResult.n,
                cmps: insertResult.cmps,
              };
            } else if (Bpi <= cand && cand < Bi) {
              K.push({ key: to, value: cand });
            }
          }
        }
      }

      if (K.length > 0) {
        const prependResult = D.batchPrepend(K);
        yield {
          k: "dstruct",
          op: "batchPrepend",
          n: prependResult.n,
          cmps: prependResult.cmps,
        };
      }

      const siPairs: DPair[] = [];
      for (const x of Si) {
        const dx = dist[x];
        if (dx !== undefined && Number.isFinite(dx) && Bpi <= dx && dx < Bi) {
          siPairs.push({ key: x, value: dx });
        }
      }
      if (siPairs.length > 0) {
        const siPrepend = D.batchPrepend(siPairs);
        yield {
          k: "dstruct",
          op: "batchPrepend",
          n: siPrepend.n,
          cmps: siPrepend.cmps,
        };
      }
    }

    const BprimeOut = B;

    const extraW: VertexId[] = [];
    for (const x of W) {
      const dx = dist[x];
      if (dx !== undefined && dx < BprimeOut) {
        extraW.push(x);
      }
    }

    if (extraW.length > 0) {
      yield* boundedMultiSourceDijkstra(graph, B, extraW, dist, pred, settleState);
    }

    const U = Uall.concat(extraW);
    result = { Bprime: BprimeOut, U };
  }

  yield { k: "recurse", dir: "out", level: l, bound: B };
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
 */
export function* run(
  graph: Graph,
  source: VertexId,
): Generator<TraceEvent, BmsspResult, undefined> {
  if (!Number.isInteger(source) || source < 0 || source >= graph.n) {
    throw new Error(`source must be an integer in [0, ${graph.n}), got ${String(source)}`);
  }

  const n = graph.n;
  const { k, t } = bmsspParams(n);
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

  yield* bmssp(graph, L, Number.POSITIVE_INFINITY, [source], k, t, dist, pred, settleState);

  return { distances: dist, predecessors: pred };
}
