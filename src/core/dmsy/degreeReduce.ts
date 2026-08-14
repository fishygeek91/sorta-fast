/**
 * DMSY degree reduction — Frederickson-style split (issue #23); design.md §2.3.
 *
 * arXiv 2602.07868 §2.1 replaces high-degree vertices with zero-weight directed
 * cycles and routes original arcs through cycle representatives. Shortest-path
 * lengths are preserved; max degree is bounded by δ when reduction runs.
 */

import { type CsrEdge, type EdgeId, type Graph, packCsr, type VertexId } from "../graph.ts";
import { type TraceEvent } from "../trace.ts";

/** Marker in {@link DegreeReduceResult.edgeMap} for zero-weight cycle connectors. */
export const VIRTUAL_EDGE = -1;

/**
 * Result of {@link degreeReduce}: reduced CSR graph plus bidirectional maps for
 * source selection, distance projection, and trace un-mapping at the boundary.
 */
export type DegreeReduceResult = {
  readonly graph: Graph;
  readonly delta: number | null;
  readonly identity: boolean;
  /** Reduced vertex id → original vertex id. */
  readonly vertexMap: Int32Array;
  /** Reduced edge id → original edge id, or {@link VIRTUAL_EDGE} for cycle arcs. */
  readonly edgeMap: Int32Array;
};

/** One directed arc while building the reduced graph, before CSR packing. */
type AnnotatedEdge = {
  readonly from: number;
  readonly to: number;
  readonly weight: number;
  readonly mapValue: number;
};

/**
 * Validate a non-negative integer edge id from {@link edgeMap}.
 *
 * @param value - Mapped original edge index.
 * @param context - Error-message prefix.
 */
function toEdgeId(value: number, context: string): EdgeId {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${context}: invalid edge id ${String(value)}`);
  }
  return value;
}

/**
 * Clamp `value` to the inclusive integer interval `[lo, hi]`.
 *
 * @param value - Value to clamp.
 * @param lo - Lower bound (inclusive).
 * @param hi - Upper bound (inclusive).
 */
function clampInt(value: number, lo: number, hi: number): number {
  if (value < lo) {
    return lo;
  }
  if (value > hi) {
    return hi;
  }
  return value;
}

/**
 * Sort annotated edges by `(from, to)` — same order as {@link packCsr}.
 *
 * @param edges - Mutable edge list to sort in place.
 */
function sortAnnotatedEdges(edges: AnnotatedEdge[]): void {
  edges.sort((a, b) => {
    if (a.from !== b.from) {
      return a.from - b.from;
    }
    return a.to - b.to;
  });
}

/**
 * Collect unique incident neighbors per vertex: |N_in(v) ∪ N_out(v)|.
 *
 * Neighbor lists are sorted by ascending vertex id for deterministic slotting.
 *
 * @param graph - Original CSR digraph.
 * @returns `neighbors[v]` lists every distinct vertex adjacent to `v`.
 */
function collectIncidentNeighbors(graph: Graph): number[][] {
  const n = graph.n;
  const sets: Set<number>[] = [];
  for (let v = 0; v < n; v += 1) {
    sets.push(new Set<number>());
  }

  for (let u = 0; u < n; u += 1) {
    const start = graph.offsets[u];
    const end = graph.offsets[u + 1];
    if (start === undefined || end === undefined) {
      throw new Error(`degreeReduce: missing offsets for vertex ${u}`);
    }
    for (let e = start; e < end; e += 1) {
      const v = graph.targets[e];
      if (v === undefined) {
        throw new Error(`degreeReduce: missing target at edge ${e}`);
      }
      const outSet = sets[u];
      const inSet = sets[v];
      if (outSet === undefined || inSet === undefined) {
        throw new Error(`degreeReduce: neighbor set missing for ${u} or ${v}`);
      }
      outSet.add(v);
      inSet.add(u);
    }
  }

  const neighbors: number[][] = [];
  for (let v = 0; v < n; v += 1) {
    const set = sets[v];
    if (set === undefined) {
      throw new Error(`degreeReduce: neighbor set missing for vertex ${v}`);
    }
    const list = Array.from(set);
    list.sort((a, b) => a - b);
    neighbors.push(list);
  }
  return neighbors;
}

/**
 * Identity reduction maps: `vertexMap[v] = v`, `edgeMap[e] = e`.
 *
 * @param graph - Graph left unchanged by reference.
 */
function identityMaps(graph: Graph): Pick<DegreeReduceResult, "vertexMap" | "edgeMap"> {
  const vertexMap = new Int32Array(graph.n);
  const edgeMap = new Int32Array(graph.m);
  for (let v = 0; v < graph.n; v += 1) {
    vertexMap[v] = v;
  }
  for (let e = 0; e < graph.m; e += 1) {
    edgeMap[e] = e;
  }
  return { vertexMap, edgeMap };
}

/**
 * Paper degree bound δ for reduction, or `null` when the identity gate applies.
 *
 * Returns `null` when `n < 2` or `m < 3n` (integer form of `m/n < 3`). Otherwise
 * `δ = clamp(⌊(1/4) · log₂ log₂ n⌋, 3, ⌊m/n⌋)` per Lemma 3.9 / paper-notes §1.2.
 *
 * @param n - Vertex count; must be an integer ≥ 1.
 * @param m - Arc count; must be an integer ≥ 0.
 * @returns Chosen δ, or `null` when reduction should be skipped.
 */
export function degreeBoundDelta(n: number, m: number): number | null {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(n)}`);
  }
  if (!Number.isInteger(m) || m < 0) {
    throw new Error(`m must be an integer >= 0, got ${String(m)}`);
  }

  if (n < 2 || m < 3 * n) {
    return null;
  }

  const log2n = Math.log2(n);
  const log2log2n = Math.log2(log2n);
  // arXiv 2602.07868 Lemma 3.9; paper-notes §1.2
  const raw = Math.floor(0.25 * log2log2n);
  const maxDelta = Math.floor(m / n);
  return clampInt(raw, 3, maxDelta);
}

/**
 * Build the reduced graph and bidirectional maps (arXiv 2602.07868 §2.1).
 *
 * **Identity gate.** When `n < 2` or `m < 3n`, returns the same {@link Graph}
 * reference with identity maps, `identity: true`, and `delta: null` — even when
 * the caller supplies `delta`.
 *
 * **Reduction.** Each original vertex `v` becomes a directed zero-weight cycle
 * `C_v` of `max(1, ⌈Δ_v / (δ − 2)⌉)` vertices (`Δ_v` = unique incident neighbors).
 * Original arc `(u, v, w)` becomes `x_uv → x_vu` with weight `w`, where `x_uv`
 * is the cycle copy of `u` representing neighbor `v`. Cycle connectors map to
 * {@link VIRTUAL_EDGE}; each original arc appears exactly once in {@link edgeMap}.
 *
 * @param graph - Original CSR digraph.
 * @param delta - Optional degree bound; when omitted, uses {@link degreeBoundDelta}.
 */
export function degreeReduce(graph: Graph, delta?: number): DegreeReduceResult {
  const n = graph.n;
  const m = graph.m;

  if (n < 2 || m < 3 * n) {
    const maps = identityMaps(graph);
    return {
      graph,
      delta: null,
      identity: true,
      vertexMap: maps.vertexMap,
      edgeMap: maps.edgeMap,
    };
  }

  let chosenDelta: number;
  if (delta === undefined) {
    const bound = degreeBoundDelta(n, m);
    if (bound === null) {
      throw new Error("degreeReduce: degreeBoundDelta returned null past identity gate");
    }
    chosenDelta = bound;
  } else {
    if (!Number.isInteger(delta)) {
      throw new Error(`delta must be an integer, got ${String(delta)}`);
    }
    const maxDelta = Math.floor(m / n);
    if (delta < 3 || delta > maxDelta) {
      throw new Error(`delta must be an integer in [3, ${maxDelta}], got ${String(delta)}`);
    }
    chosenDelta = delta;
  }

  const slotsPerCycle = chosenDelta - 2;
  if (slotsPerCycle < 1) {
    throw new Error(`degreeReduce: delta ${chosenDelta} yields non-positive slot capacity`);
  }

  const neighbors = collectIncidentNeighbors(graph);
  const cycleSize = new Int32Array(n);
  const reducedBase = new Int32Array(n);
  let reducedN = 0;

  for (let v = 0; v < n; v += 1) {
    const nbrs = neighbors[v];
    if (nbrs === undefined) {
      throw new Error(`degreeReduce: missing neighbor list for vertex ${v}`);
    }
    const deltaV = nbrs.length;
    reducedBase[v] = reducedN;
    const copies = Math.max(1, Math.ceil(deltaV / slotsPerCycle));
    cycleSize[v] = copies;
    reducedN += copies;
  }

  const vertexMap = new Int32Array(reducedN);
  const rx = new Float64Array(reducedN);
  const ry = new Float64Array(reducedN);

  for (let v = 0; v < n; v += 1) {
    const base = reducedBase[v];
    const copies = cycleSize[v];
    const ox = graph.x[v];
    const oy = graph.y[v];
    if (ox === undefined || oy === undefined || !Number.isFinite(ox) || !Number.isFinite(oy)) {
      throw new Error(`degreeReduce: non-finite coordinates at vertex ${v}`);
    }
    for (let c = 0; c < copies; c += 1) {
      const rid = base + c;
      vertexMap[rid] = v;
      rx[rid] = ox;
      ry[rid] = oy;
    }
  }

  /** `neighborCycleVertex[v].get(u)` → reduced id for `u` as a neighbor of `v`. */
  const neighborCycleVertex: Map<number, number>[] = [];
  for (let v = 0; v < n; v += 1) {
    const base = reducedBase[v];
    const nbrs = neighbors[v];
    if (nbrs === undefined) {
      throw new Error(`degreeReduce: missing neighbor list for vertex ${v}`);
    }
    const lookup = new Map<number, number>();
    for (let k = 0; k < nbrs.length; k += 1) {
      const u = nbrs[k];
      if (u === undefined) {
        throw new Error(`degreeReduce: sparse neighbor entry at vertex ${v}, slot ${k}`);
      }
      const cycleIdx = Math.floor(k / slotsPerCycle);
      lookup.set(u, base + cycleIdx);
    }
    neighborCycleVertex.push(lookup);
  }

  const annotated: AnnotatedEdge[] = [];

  for (let v = 0; v < n; v += 1) {
    const copies = cycleSize[v];
    if (copies < 2) {
      continue;
    }
    const base = reducedBase[v];
    for (let c = 0; c < copies; c += 1) {
      const from = base + c;
      const to = base + ((c + 1) % copies);
      annotated.push({
        from,
        to,
        weight: 0,
        mapValue: VIRTUAL_EDGE,
      });
    }
  }

  for (let u = 0; u < n; u += 1) {
    const start = graph.offsets[u];
    const end = graph.offsets[u + 1];
    if (start === undefined || end === undefined) {
      throw new Error(`degreeReduce: missing offsets for vertex ${u}`);
    }
    const uLookup = neighborCycleVertex[u];
    if (uLookup === undefined) {
      throw new Error(`degreeReduce: missing neighbor lookup for vertex ${u}`);
    }
    for (let e = start; e < end; e += 1) {
      const v = graph.targets[e];
      const w = graph.weights[e];
      if (v === undefined || w === undefined) {
        throw new Error(`degreeReduce: missing CSR data at edge ${e}`);
      }
      if (!Number.isFinite(w) || w < 0) {
        throw new Error(`degreeReduce: invalid weight ${w} on edge ${e}`);
      }
      const from = uLookup.get(v);
      if (from === undefined) {
        throw new Error(`degreeReduce: no cycle slot for neighbor ${v} of vertex ${u}`);
      }
      const vLookup = neighborCycleVertex[v];
      if (vLookup === undefined) {
        throw new Error(`degreeReduce: missing neighbor lookup for vertex ${v}`);
      }
      const to = vLookup.get(u);
      if (to === undefined) {
        throw new Error(`degreeReduce: no cycle slot for neighbor ${u} of vertex ${v}`);
      }
      annotated.push({
        from,
        to,
        weight: w,
        mapValue: e,
      });
    }
  }

  sortAnnotatedEdges(annotated);

  const csrEdges: CsrEdge[] = [];
  const edgeMap = new Int32Array(annotated.length);
  for (let i = 0; i < annotated.length; i += 1) {
    const edge = annotated[i];
    if (edge === undefined) {
      throw new Error(`degreeReduce: sparse annotated edge at index ${i}`);
    }
    csrEdges.push({ from: edge.from, to: edge.to, weight: edge.weight });
    edgeMap[i] = edge.mapValue;
  }

  const reducedGraph = packCsr(reducedN, csrEdges, rx, ry);

  return {
    graph: reducedGraph,
    delta: chosenDelta,
    identity: false,
    vertexMap,
    edgeMap,
  };
}

/**
 * Lowest reduced vertex id whose {@link DegreeReduceResult.vertexMap} entry equals
 * the original source.
 *
 * @param vertexMap - Reduced → original vertex map from {@link degreeReduce}.
 * @param source - Original source vertex id.
 * @returns Reduced source id (cycle copy 0 when identity).
 */
export function reducedSource(vertexMap: Int32Array, source: VertexId): VertexId {
  if (!Number.isInteger(source) || source < 0) {
    throw new Error(`source must be a non-negative integer, got ${String(source)}`);
  }

  for (let r = 0; r < vertexMap.length; r += 1) {
    const original = vertexMap[r];
    if (original === undefined) {
      throw new Error(`vertexMap[${r}] is undefined`);
    }
    if (original === source) {
      return r;
    }
  }

  throw new Error(`no reduced copy exists for source vertex ${source}`);
}

/**
 * Project reduced-graph distances onto original vertex ids.
 *
 * For each original `v`, returns the minimum distance among all reduced copies
 * that map back to `v`.
 *
 * @param reduced - Distance array on the reduced graph (length = `vertexMap.length`).
 * @param vertexMap - Reduced → original map from {@link degreeReduce}.
 * @param n - Original vertex count.
 */
export function mapBackDistances(
  reduced: Float64Array,
  vertexMap: Int32Array,
  n: number,
): Float64Array {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`n must be a non-negative integer, got ${String(n)}`);
  }
  if (reduced.length !== vertexMap.length) {
    throw new Error(
      `reduced length ${reduced.length} must match vertexMap length ${vertexMap.length}`,
    );
  }

  const out = new Float64Array(n);
  for (let v = 0; v < n; v += 1) {
    out[v] = Infinity;
  }

  for (let r = 0; r < vertexMap.length; r += 1) {
    const v = vertexMap[r];
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      throw new Error(`vertexMap[${r}] = ${String(v)} is out of range for n = ${n}`);
    }
    const dist = reduced[r];
    if (dist === undefined || (!Number.isFinite(dist) && dist !== Infinity)) {
      throw new Error(`reduced[${r}] is not a finite distance or Infinity`);
    }
    const current = out[v];
    if (current === undefined) {
      throw new Error(`mapBackDistances: missing slot for original vertex ${v}`);
    }
    if (dist < current) {
      out[v] = dist;
    }
  }

  return out;
}

/**
 * Build a stateful trace un-mapper for reduced-graph algorithm output.
 *
 * `settle` / `pivot`: map reduced vertex ids to originals. The first settle
 * (resp. first pivot) per original vertex is kept; later cycle copies return
 * `null`. The two kinds use separate seen-sets so a pivot cannot swallow a
 * settle. `relax` / `forest`: map reduced edge ids to originals;
 * {@link VIRTUAL_EDGE} → `null`. `heap` / `batch` / `recurse` / `dstruct`
 * pass through unchanged.
 *
 * @param maps - `vertexMap` and `edgeMap` from {@link degreeReduce}.
 */
export function createTraceUnmapper(
  maps: Pick<DegreeReduceResult, "vertexMap" | "edgeMap">,
): (event: TraceEvent) => TraceEvent | null {
  const { vertexMap, edgeMap } = maps;
  const seenSettles = new Set<number>();
  const seenPivots = new Set<number>();

  const mapReducedVertex = (rv: number): number => {
    if (!Number.isInteger(rv) || rv < 0 || rv >= vertexMap.length) {
      throw new Error(
        `reduced vertex ${String(rv)} is out of range for vertexMap length ${vertexMap.length}`,
      );
    }
    const ov = vertexMap[rv];
    if (ov === undefined) {
      throw new Error(`vertexMap[${rv}] is undefined`);
    }
    return ov;
  };

  const mapVertexEvent = (
    event: Extract<TraceEvent, { k: "settle" }> | Extract<TraceEvent, { k: "pivot" }>,
  ): TraceEvent | null => {
    const ov = mapReducedVertex(event.v);
    if (event.k === "settle") {
      if (seenSettles.has(ov)) {
        return null;
      }
      seenSettles.add(ov);
      return { k: "settle", v: ov, order: event.order, cost: 1 };
    }
    if (seenPivots.has(ov)) {
      return null;
    }
    seenPivots.add(ov);
    return { k: "pivot", v: ov, level: event.level };
  };

  const mapEdgeEvent = (
    event: Extract<TraceEvent, { k: "relax" }> | Extract<TraceEvent, { k: "forest" }>,
  ): TraceEvent | null => {
    const re = event.e;
    if (!Number.isInteger(re) || re < 0 || re >= edgeMap.length) {
      throw new Error(
        `reduced edge ${String(re)} is out of range for edgeMap length ${edgeMap.length}`,
      );
    }
    const oe = edgeMap[re];
    if (oe === undefined) {
      throw new Error(`edgeMap[${re}] is undefined`);
    }
    if (oe === VIRTUAL_EDGE) {
      return null;
    }
    const originalEdge = toEdgeId(oe, `edgeMap[${re}]`);
    if (event.k === "relax") {
      return { k: "relax", e: originalEdge, improved: event.improved, cost: 1 };
    }
    return { k: "forest", op: event.op, e: originalEdge, tree: event.tree };
  };

  return (event: TraceEvent): TraceEvent | null => {
    switch (event.k) {
      case "settle":
      case "pivot":
        return mapVertexEvent(event);
      case "relax":
      case "forest":
        return mapEdgeEvent(event);
      case "heap":
      case "batch":
      case "recurse":
      case "dstruct":
        return event;
    }
  };
}
