/**
 * Dijkstra 1959 control lane; binary heap + lazy deletion; issue #5; design.md §2.1.
 *
 * Textbook SSSP with instrumented trace emission. The heap stores (vertex, key)
 * snapshots; stale entries are skipped at pop time rather than decrease-key.
 */

import { type Graph, type VertexId } from "./graph.ts";
import { SENTINEL, type TraceEvent } from "./trace.ts";

/** Initial heap capacity before doubling growth. */
const INITIAL_HEAP_CAPACITY = 16;

/**
 * Shortest-path distances and predecessor tree from a Dijkstra run.
 *
 * `distances[v]` is `Infinity` when `v` is unreachable from the source.
 * `predecessors[v]` is {@link SENTINEL} for the source and for unreachable vertices.
 */
export type DijkstraResult = {
  distances: Float64Array;
  predecessors: Int32Array;
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
 * Comparison counts follow the sift-up / sift-down rules frozen by golden traces.
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
 * Instrumented Dijkstra shortest-path generator.
 *
 * Yields {@link TraceEvent} objects for heap ops, vertex settlements, and edge
 * relaxations, then returns distance and predecessor arrays. Unreachable vertices
 * remain at `Infinity` / {@link SENTINEL}.
 *
 * @param graph - CSR directed graph with non-negative weights.
 * @param source - Source vertex in `0 .. graph.n - 1`.
 */
export function* run(
  graph: Graph,
  source: VertexId,
): Generator<TraceEvent, DijkstraResult, undefined> {
  if (!Number.isInteger(source) || source < 0 || source >= graph.n) {
    throw new Error(`source must be an integer in [0, ${graph.n}), got ${String(source)}`);
  }

  const n = graph.n;
  const distances = new Float64Array(n);
  distances.fill(Number.POSITIVE_INFINITY);
  distances[source] = 0;

  const predecessors = new Int32Array(n);
  predecessors.fill(SENTINEL);

  const heap = new MinHeap();
  const initialPushCmps = heap.push(source, 0);
  yield { k: "heap", op: "push", cmps: initialPushCmps };

  let settleOrder = 0;
  const { offsets, targets, weights } = graph;

  while (heap.size > 0) {
    const { v, key, cmps: popCmps } = heap.popmin();
    yield { k: "heap", op: "popmin", cmps: popCmps };

    const distV = distances[v];
    if (distV === undefined) {
      throw new Error(`distances[${v}] missing`);
    }

    // Lazy deletion: skip heap snapshots superseded by a later improvement.
    if (key !== distV) {
      continue;
    }

    yield { k: "settle", v, order: settleOrder, cost: 1 };
    settleOrder += 1;

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
      const distTo = distances[to];
      if (distTo === undefined) {
        throw new Error(`distances[${to}] missing`);
      }

      const improved = cand < distTo;
      yield { k: "relax", e, improved, cost: 1 };

      if (improved) {
        distances[to] = cand;
        predecessors[to] = v;
        const pushCmps = heap.push(to, cand);
        yield { k: "heap", op: "push", cmps: pushCmps };
      }
    }
  }

  return { distances, predecessors };
}
