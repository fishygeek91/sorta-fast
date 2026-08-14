import { describe, expect, it } from "vitest";

import {
  VIRTUAL_EDGE,
  degreeBoundDelta,
  degreeReduce,
  reducedSource,
  mapBackDistances,
  createTraceUnmapper,
  type DegreeReduceResult,
} from "../src/core/dmsy/degreeReduce.ts";
import {
  packCsr,
  generateGraph,
  type CsrEdge,
  type Graph,
  SIZE_PRESETS,
} from "../src/core/graph.ts";
import { type TraceEvent } from "../src/core/trace.ts";
import { auditDistancesFromTrace, drainRun } from "./dijkstra-helpers.ts";

function expectDistancesEqual(a: Float64Array, b: Float64Array): void {
  expect(Array.from(a)).toEqual(Array.from(b));
}

/** Bidirected complete digraph on vertices `0 .. n-1`. */
function bidirectedComplete(n: number, weight = 1): Graph {
  const edges: CsrEdge[] = [];
  for (let u = 0; u < n; u += 1) {
    for (let v = 0; v < n; v += 1) {
      if (u !== v) {
        edges.push({ from: u, to: v, weight });
      }
    }
  }
  const coords = Array.from({ length: n }, (_, i) => i);
  return packCsr(n, edges, coords, coords);
}

/** Bidirected K on `0..coreN-1` inside a larger vertex set. */
function bidirectedKn(coreN: number, totalN: number): Graph {
  const edges: CsrEdge[] = [];
  for (let u = 0; u < coreN; u += 1) {
    for (let v = 0; v < coreN; v += 1) {
      if (u !== v) {
        edges.push({ from: u, to: v, weight: 1 });
      }
    }
  }
  const coords = Array.from({ length: totalN }, (_, i) => i);
  return packCsr(totalN, edges, coords, coords);
}

function findEdge(graph: Graph, from: number, to: number): number {
  const start = graph.offsets[from];
  const end = graph.offsets[from + 1];
  if (start === undefined || end === undefined) {
    throw new Error(`offsets missing for vertex ${from}`);
  }
  for (let e = start; e < end; e += 1) {
    if (graph.targets[e] === to) {
      return e;
    }
  }
  throw new Error(`edge ${from}→${to} not found`);
}

function hasSelfLoop(graph: Graph): boolean {
  for (let v = 0; v < graph.n; v += 1) {
    const start = graph.offsets[v];
    const end = graph.offsets[v + 1];
    if (start === undefined || end === undefined) {
      continue;
    }
    for (let e = start; e < end; e += 1) {
      if (graph.targets[e] === v) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Every original vertex appears in `vertexMap`; every original edge id appears
 * exactly once among non-virtual `edgeMap` entries.
 */
function assertMapsTotal(original: Graph, result: DegreeReduceResult): void {
  const vertexHits = new Int32Array(original.n);
  for (let r = 0; r < result.vertexMap.length; r += 1) {
    const v = result.vertexMap[r];
    if (v === undefined || v < 0 || v >= original.n) {
      throw new Error(`vertexMap[${r}] out of range`);
    }
    vertexHits[v] += 1;
  }
  for (let v = 0; v < original.n; v += 1) {
    expect(vertexHits[v]).toBeGreaterThanOrEqual(1);
  }
  const edgeHits = new Int32Array(original.m);
  for (let e = 0; e < result.edgeMap.length; e += 1) {
    const oe = result.edgeMap[e];
    if (oe === VIRTUAL_EDGE) {
      continue;
    }
    if (oe === undefined || oe < 0 || oe >= original.m) {
      throw new Error(`edgeMap[${e}] out of range`);
    }
    edgeHits[oe] += 1;
  }
  for (let e = 0; e < original.m; e += 1) {
    expect(edgeHits[e]).toBe(1);
  }
}

function expectIdentityReduction(graph: Graph, result: DegreeReduceResult): void {
  expect(result.identity).toBe(true);
  expect(result.delta).toBe(null);
  expect(result.graph).toBe(graph);
  for (let v = 0; v < graph.n; v += 1) {
    expect(result.vertexMap[v]).toBe(v);
  }
  for (let e = 0; e < graph.m; e += 1) {
    expect(result.edgeMap[e]).toBe(e);
  }
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

const k4 = bidirectedComplete(4, 1);

describe("degreeBoundDelta", () => {
  it("throws on invalid n and m", () => {
    expect(() => degreeBoundDelta(0, 0)).toThrow(/n must be an integer/);
    expect(() => degreeBoundDelta(1.5, 0)).toThrow(/n must be an integer/);
    expect(() => degreeBoundDelta(2, -1)).toThrow(/m must be an integer/);
  });

  it("returns null for n=1, m=0", () => {
    expect(degreeBoundDelta(1, 0)).toBe(null);
  });

  it("returns null when m < 3n (n=2, m=5)", () => {
    expect(degreeBoundDelta(2, 5)).toBe(null);
  });

  it("returns null for gallery n=500, m=1000", () => {
    expect(degreeBoundDelta(500, 1000)).toBe(null);
  });

  it("returns δ=3 for gallery sizes with m=3n", () => {
    for (const n of [SIZE_PRESETS.S, SIZE_PRESETS.M, SIZE_PRESETS.L, SIZE_PRESETS.XL]) {
      expect(degreeBoundDelta(n, 3 * n)).toBe(3);
    }
  });

  it("returns δ=3 for n=8, m=24", () => {
    expect(degreeBoundDelta(8, 24)).toBe(3);
  });
});

describe("degreeReduce identity gate", () => {
  for (const kind of ["sparse", "maze", "adversarial"] as const) {
    it(`returns identity for generateGraph(${kind}, n=16, seed=1)`, () => {
      const graph = generateGraph(kind, 16, 1);
      expectIdentityReduction(graph, degreeReduce(graph));
      expect(degreeBoundDelta(graph.n, graph.m)).toBe(null);
    });
  }

  it("returns identity for a path graph n=3, m=2", () => {
    const graph = packCsr(
      3,
      [
        { from: 0, to: 1, weight: 1 },
        { from: 1, to: 2, weight: 1 },
      ],
      [0, 1, 2],
      [0, 0, 0],
    );
    expectIdentityReduction(graph, degreeReduce(graph));
  });

  it("ignores explicit delta=3 when the identity gate applies", () => {
    const graph = packCsr(3, [{ from: 0, to: 1, weight: 1 }], [0, 1, 2], [0, 0, 0]);
    expectIdentityReduction(graph, degreeReduce(graph, 3));
  });
});

describe("degreeReduce isolated vertex", () => {
  it("keeps one zero-degree copy for an isolated vertex with no self-loop", () => {
    const full = bidirectedKn(5, 6);
    const result = degreeReduce(full);
    expect(result.identity).toBe(false);
    expect(hasSelfLoop(result.graph)).toBe(false);

    let copiesOf5 = 0;
    let rid5 = -1;
    for (let r = 0; r < result.vertexMap.length; r += 1) {
      if (result.vertexMap[r] === 5) {
        copiesOf5 += 1;
        rid5 = r;
      }
    }
    expect(copiesOf5).toBe(1);
    const start = result.graph.offsets[rid5];
    const end = result.graph.offsets[rid5 + 1];
    if (start === undefined || end === undefined) {
      throw new Error("offsets for isolated copy missing");
    }
    expect(end - start).toBe(0);
  });
});

describe("degreeReduce bidirected K_4 (δ=3)", () => {
  const result = degreeReduce(k4, 3);

  it("builds twelve cycle copies with virtual connectors and total maps", () => {
    expect(result.identity).toBe(false);
    expect(result.delta).toBe(3);
    expect(result.graph.n).toBe(12);
    expect(hasSelfLoop(result.graph)).toBe(false);
    assertMapsTotal(k4, result);

    let virtualCount = 0;
    for (let e = 0; e < result.edgeMap.length; e += 1) {
      if (result.edgeMap[e] === VIRTUAL_EDGE) {
        expect(result.graph.weights[e]).toBe(0);
        virtualCount += 1;
      }
    }
    expect(virtualCount).toBe(12);
  });

  it("routes neighbors through ascending cycle slots and maps source back", () => {
    const origE = findEdge(k4, 0, 1);
    const reducedE = findEdge(result.graph, 0, 3);
    expect(result.graph.weights[reducedE]).toBe(1);
    expect(result.edgeMap[reducedE]).toBe(origE);
    expect(findEdge(result.graph, 1, 6)).toBeGreaterThanOrEqual(0);
    expect(findEdge(result.graph, 2, 9)).toBeGreaterThanOrEqual(0);
    expect(reducedSource(result.vertexMap, 0)).toBe(0);
    expect(
      mapBackDistances(
        new Float64Array([0, 5, 6, 7, 1, 2, 3, 4, 8, 9, 10, 11]),
        result.vertexMap,
        k4.n,
      )[0],
    ).toBe(0);
  });
});

describe("createTraceUnmapper on K_4", () => {
  const reduced = degreeReduce(k4, 3);
  const unmap = createTraceUnmapper(reduced);

  it("maps first settle/pivot per vertex and drops virtual relax/forest", () => {
    expect(unmap({ k: "settle", v: 0, order: 0, cost: 1 })).toEqual({
      k: "settle",
      v: 0,
      order: 0,
      cost: 1,
    });
    expect(unmap({ k: "settle", v: 1, order: 1, cost: 1 })).toBe(null);
    expect(unmap({ k: "pivot", v: 3, level: 1 })).toEqual({ k: "pivot", v: 1, level: 1 });
    expect(unmap({ k: "settle", v: 4, order: 2, cost: 1 })).toEqual({
      k: "settle",
      v: 1,
      order: 2,
      cost: 1,
    });

    let virtualE = -1;
    let mappedE = -1;
    let mappedOrig = -1;
    for (let e = 0; e < reduced.edgeMap.length; e += 1) {
      const oe = reduced.edgeMap[e];
      if (oe === VIRTUAL_EDGE) {
        virtualE = e;
      } else if (mappedE < 0 && oe !== undefined) {
        mappedE = e;
        mappedOrig = oe;
      }
    }
    if (virtualE < 0 || mappedE < 0) {
      throw new Error("missing virtual or mapped reduced edge");
    }
    expect(unmap({ k: "relax", e: virtualE, improved: false, cost: 1 })).toBe(null);
    expect(unmap({ k: "forest", op: "grow", e: virtualE, tree: 0 })).toBe(null);
    expect(unmap({ k: "relax", e: mappedE, improved: true, cost: 1 })).toEqual({
      k: "relax",
      e: mappedOrig,
      improved: true,
      cost: 1,
    });
    expect(unmap({ k: "forest", op: "cut", e: mappedE, tree: 2 })).toEqual({
      k: "forest",
      op: "cut",
      e: mappedOrig,
      tree: 2,
    });
  });

  it("passes passthrough events and throws on out-of-range ids", () => {
    const heap: TraceEvent = { k: "heap", op: "push", cmps: 0 };
    const batch: TraceEvent = { k: "batch", phase: "start", level: 1, size: 4 };
    const recurse: TraceEvent = { k: "recurse", dir: "in", level: 2, bound: 10 };
    const dstruct: TraceEvent = { k: "dstruct", op: "pull", n: 3, cmps: 7 };
    expect(unmap(heap)).toBe(heap);
    expect(unmap(batch)).toEqual(batch);
    expect(unmap(recurse)).toEqual(recurse);
    expect(unmap(dstruct)).toEqual(dstruct);
    expect(() => unmap({ k: "settle", v: reduced.vertexMap.length, order: 0, cost: 1 })).toThrow(
      /out of range/,
    );
    expect(() => unmap({ k: "relax", e: reduced.edgeMap.length, improved: true, cost: 1 })).toThrow(
      /out of range/,
    );
  });
});

describe("degreeReduce trace un-map audit", () => {
  it("re-derives original distances from un-mapped Dijkstra on G′", () => {
    const original = k4;
    const reduced = degreeReduce(original, 3);
    const src = reducedSource(reduced.vertexMap, 0);
    const { events, result } = drainRun(reduced.graph, src);
    const unmap = createTraceUnmapper(reduced);
    const projected: TraceEvent[] = [];
    for (const event of events) {
      const mapped = unmap(event);
      if (mapped !== null) {
        projected.push(mapped);
      }
    }
    const { result: origRun } = drainRun(original, 0);
    const auditEvents = rewriteRelaxImprovedForOriginal(original, projected, 0);
    expectDistancesEqual(auditDistancesFromTrace(original, auditEvents, 0), origRun.distances);
    expectDistancesEqual(
      mapBackDistances(result.distances, reduced.vertexMap, original.n),
      origRun.distances,
    );
    for (const event of projected) {
      if (event.k === "settle" || event.k === "pivot") {
        expect(event.v).toBeLessThan(original.n);
      }
      if (event.k === "relax" || event.k === "forest") {
        expect(event.e).toBeLessThan(original.m);
      }
    }
  });
});

describe("degreeReduce API shape and invalid delta", () => {
  it("returns a plain result object, not a generator", () => {
    const result = degreeReduce(k4);
    expect(typeof degreeReduce).toBe("function");
    expect(Object.prototype.toString.call(result)).not.toBe("[object Generator]");
    expect(Symbol.iterator in result).toBe(false);
    expect(typeof result.identity).toBe("boolean");
    expect(result.graph).toBeDefined();
    expect(result.vertexMap).toBeInstanceOf(Int32Array);
    expect(result.edgeMap).toBeInstanceOf(Int32Array);
  });

  it("rejects delta below 3, above floor(m/n), and non-integer values on K_4", () => {
    expect(() => degreeReduce(k4, 2)).toThrow(/delta must be an integer in \[3, 3\]/);
    expect(() => degreeReduce(k4, 4)).toThrow(/delta must be an integer in \[3, 3\]/);
    expect(() => degreeReduce(k4, 3.5)).toThrow(/delta must be an integer/);
  });
});
