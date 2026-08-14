import { describe, expect, it } from "vitest";

import {
  VIRTUAL_EDGE,
  degreeReduce,
  reducedSource,
  mapBackDistances,
  createTraceUnmapper,
  type DegreeReduceResult,
} from "../src/core/dmsy/degreeReduce.ts";
import {
  generateGraph,
  GRAPH_KINDS,
  packCsr,
  type CsrEdge,
  type Graph,
} from "../src/core/graph.ts";
import { mulberry32 } from "../src/core/prng.ts";
import { type TraceEvent } from "../src/core/trace.ts";
import { auditDistancesFromTrace, drainRun } from "./dijkstra-helpers.ts";

/** Element-wise equality for distance arrays. */
function float64ArraysEqual(a: Float64Array, b: Float64Array): boolean {
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

/** Maximum out-degree over CSR offsets. */
function maxOutDegree(graph: Graph): number {
  let max = 0;
  for (let v = 0; v < graph.n; v += 1) {
    const start = graph.offsets[v];
    const end = graph.offsets[v + 1];
    if (start === undefined || end === undefined) {
      throw new Error(`maxOutDegree: missing offsets for vertex ${v}`);
    }
    max = Math.max(max, end - start);
  }
  return max;
}

/** Maximum in-degree by scanning CSR targets. */
function maxInDegree(graph: Graph): number {
  const inDeg = new Int32Array(graph.n);
  for (let e = 0; e < graph.m; e += 1) {
    const t = graph.targets[e];
    if (t === undefined) {
      throw new Error(`maxInDegree: missing target at edge ${e}`);
    }
    inDeg[t] += 1;
  }
  let max = 0;
  for (let v = 0; v < graph.n; v += 1) {
    const deg = inDeg[v];
    if (deg !== undefined) {
      max = Math.max(max, deg);
    }
  }
  return max;
}

/** Compact label for fuzz violation messages. */
function formatGraph(seed: number, kind: string, n: number, source: number): string {
  return `seed=${seed} kind=${kind} n=${n} source=${source}`;
}

/**
 * G′ relaxes dropped at un-map can keep `improved` after a shorter original path
 * exists; rewrite flags before blind replay on G.
 */
function rewriteRelaxImprovedForOriginal(
  graph: Graph,
  events: readonly TraceEvent[],
  source: number,
): TraceEvent[] {
  const { n, m, offsets, targets, weights } = graph;
  const distances = new Float64Array(n);
  distances.fill(Number.POSITIVE_INFINITY);
  distances[source] = 0;
  const tails = new Uint32Array(m);
  for (let v = 0; v < n; v += 1) {
    const start = offsets[v];
    const end = offsets[v + 1];
    if (start === undefined || end === undefined) {
      throw new Error(`offsets for vertex ${v} missing`);
    }
    for (let e = start; e < end; e += 1) {
      tails[e] = v;
    }
  }
  const out: TraceEvent[] = [];
  for (const event of events) {
    if (event.k !== "relax") {
      out.push(event);
      continue;
    }
    const from = tails[event.e];
    const to = targets[event.e];
    const weight = weights[event.e];
    if (to === undefined || weight === undefined) {
      throw new Error(`CSR arc ${event.e} missing`);
    }
    const distFrom = distances[from];
    const current = distances[to];
    if (distFrom === undefined || current === undefined) {
      throw new Error(`distance slot missing for relax ${event.e}`);
    }
    const candidate = distFrom + weight;
    const improved = candidate < current;
    if (improved) {
      distances[to] = candidate;
    }
    out.push({ k: "relax", e: event.e, improved, cost: 1 });
  }
  return out;
}

/** Regular digraph with out-degree 3: v → (v+1)%n, (v+2)%n, (v+3)%n. */
function buildDenseGraph(seed: number, n: number): Graph {
  const rng = mulberry32(seed);
  const useTies = seed % 2 === 0;
  const edges: CsrEdge[] = [];
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let v = 0; v < n; v += 1) {
    x[v] = v;
    y[v] = 0;
    for (let k = 1; k <= 3; k += 1) {
      const to = (v + k) % n;
      const weight = useTies ? 1 : 1 + Math.floor(rng.next() * 5);
      edges.push({ from: v, to, weight });
    }
  }
  return packCsr(n, edges, x, y);
}

/** AC2 distances, AC3 degree bound, and bidirectional map invariants. */
function checkDegreeReduce(
  graph: Graph,
  source: number,
  result: DegreeReduceResult,
  ctx: string,
  violations: string[],
): void {
  const { n, m } = graph;
  if (result.identity) {
    if (result.graph !== graph) {
      violations.push(`${ctx}: identity graph ref differs`);
    }
    if (result.delta !== null) {
      violations.push(`${ctx}: identity delta non-null`);
    }
    for (let v = 0; v < n; v += 1) {
      if (result.vertexMap[v] !== v) {
        violations.push(`${ctx}: identity vertexMap[${v}]`);
      }
    }
    for (let e = 0; e < m; e += 1) {
      if (result.edgeMap[e] !== e) {
        violations.push(`${ctx}: identity edgeMap[${e}]`);
      }
    }
  } else if (result.delta === null) {
    violations.push(`${ctx}: reduced but delta null`);
  } else {
    const maxOut = maxOutDegree(result.graph);
    const maxIn = maxInDegree(result.graph);
    if (maxOut > result.delta) {
      violations.push(`${ctx}: maxOut=${maxOut} > delta=${result.delta}`);
    }
    if (maxIn > result.delta) {
      violations.push(`${ctx}: maxIn=${maxIn} > delta=${result.delta}`);
    }
  }

  if (result.vertexMap.length !== result.graph.n) {
    violations.push(`${ctx}: vertexMap length mismatch`);
  }
  if (result.edgeMap.length !== result.graph.m) {
    violations.push(`${ctx}: edgeMap length mismatch`);
  }

  const vtxCount = new Int32Array(n);
  for (let r = 0; r < result.vertexMap.length; r += 1) {
    const v = result.vertexMap[r];
    if (v !== undefined && v >= 0 && v < n) {
      vtxCount[v] += 1;
    }
  }
  for (let v = 0; v < n; v += 1) {
    if (vtxCount[v] === 0) {
      violations.push(`${ctx}: vertex ${v} missing from vertexMap`);
    }
  }

  const edgeCount = new Int32Array(m);
  for (let re = 0; re < result.edgeMap.length; re += 1) {
    const orig = result.edgeMap[re];
    if (orig === VIRTUAL_EDGE) {
      continue;
    }
    if (orig === undefined || orig < 0 || orig >= m) {
      violations.push(`${ctx}: edgeMap[${re}] invalid`);
      continue;
    }
    edgeCount[orig] += 1;
  }
  for (let e = 0; e < m; e += 1) {
    if (edgeCount[e] !== 1) {
      violations.push(`${ctx}: edge ${e} count=${edgeCount[e]}`);
    }
  }

  const origDist = drainRun(graph, source).result.distances;
  const redDist = drainRun(result.graph, reducedSource(result.vertexMap, source)).result.distances;
  if (!float64ArraysEqual(origDist, mapBackDistances(redDist, result.vertexMap, n))) {
    violations.push(`${ctx}: mapBackDistances disagrees with Dijkstra`);
  }
}

describe("degreeReduce differential fuzz", () => {
  it("preserves distances, degree bound, and maps on 1000 gallery seeds", () => {
    const violations: string[] = [];
    for (let seed = 0; seed < 1000; seed += 1) {
      const kind = GRAPH_KINDS[seed % GRAPH_KINDS.length];
      if (kind === undefined) {
        throw new Error(`bad kind for seed ${String(seed)}`);
      }
      const n = 8 + (seed % 40);
      const source = seed % n;
      const graph = generateGraph(kind, n, seed);
      checkDegreeReduce(
        graph,
        source,
        degreeReduce(graph),
        formatGraph(seed, kind, n, source),
        violations,
      );
    }
    expect(violations).toEqual([]);
  }, 60_000);

  it("always reduces dense packCsr graphs and preserves distances on 200 seeds", () => {
    const violations: string[] = [];
    for (let seed = 0; seed < 200; seed += 1) {
      const n = 6 + (seed % 12);
      const source = seed % n;
      const graph = buildDenseGraph(seed, n);
      const ctx = `seed=${seed} dense n=${n} source=${source}`;
      const result = degreeReduce(graph);
      if (result.identity) {
        violations.push(`${ctx}: expected reduction on m=3n graph`);
      }
      checkDegreeReduce(graph, source, result, ctx, violations);
    }
    expect(violations).toEqual([]);
  }, 30_000);

  it("un-maps reduced Dijkstra traces onto original ids on 40 dense seeds", () => {
    const violations: string[] = [];
    const n = 8;
    const m = 3 * n;
    for (let seed = 0; seed < 40; seed += 1) {
      const source = seed % n;
      const graph = buildDenseGraph(seed, n);
      const ctx = `seed=${seed} unmap n=${n} source=${source}`;
      const result = degreeReduce(graph);
      const unmap = createTraceUnmapper(result);
      const projected: TraceEvent[] = [];
      for (const event of drainRun(result.graph, reducedSource(result.vertexMap, source)).events) {
        const mapped = unmap(event);
        if (mapped !== null) {
          projected.push(mapped);
        }
      }
      for (const event of projected) {
        if ((event.k === "settle" || event.k === "pivot") && (event.v < 0 || event.v >= n)) {
          violations.push(`${ctx}: ${event.k}.v=${event.v} out of range`);
        }
        if ((event.k === "relax" || event.k === "forest") && (event.e < 0 || event.e >= m)) {
          violations.push(`${ctx}: ${event.k}.e=${event.e} out of range`);
        }
      }
      const origDist = drainRun(graph, source).result.distances;
      const auditEvents = rewriteRelaxImprovedForOriginal(graph, projected, source);
      const audited = auditDistancesFromTrace(graph, auditEvents, source);
      if (!float64ArraysEqual(audited, origDist)) {
        violations.push(`${ctx}: trace audit disagrees with Dijkstra`);
      }
    }
    expect(violations).toEqual([]);
  }, 15_000);
});
