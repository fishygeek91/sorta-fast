import { describe, expect, it } from "vitest";

import {
  generateGraph,
  GRAPH_KINDS,
  SIZE_PRESETS,
  type Graph,
  type GraphKind,
} from "../src/core/graph.ts";

const S_SEEDS = [0, 1, 42, 1729, 0xffffffff];
const M_KINDS: GraphKind[] = ["maze", "clusters", "sparse"];

describe("SIZE_PRESETS", () => {
  it("matches design.md S/M/L/XL node counts", () => {
    expect(SIZE_PRESETS.S).toBe(500);
    expect(SIZE_PRESETS.M).toBe(5000);
    expect(SIZE_PRESETS.L).toBe(25000);
    expect(SIZE_PRESETS.XL).toBe(100000);
  });
});

describe("generateGraph presets", () => {
  it("produces n = 500 at preset S for every kind", () => {
    for (const kind of GRAPH_KINDS) {
      const graph = generateGraph(kind, SIZE_PRESETS.S, 42);
      expect(graph.n).toBe(500);
    }
  });
});

describe("generateGraph determinism", () => {
  it("is byte-identical across two runs at S for every kind and seed", () => {
    for (const kind of GRAPH_KINDS) {
      for (const seed of S_SEEDS) {
        const a = generateGraph(kind, SIZE_PRESETS.S, seed);
        const b = generateGraph(kind, SIZE_PRESETS.S, seed);
        expectSameGraph(a, b);
      }
    }
  });

  it("is byte-identical at M for maze, clusters, and sparse", () => {
    for (const kind of M_KINDS) {
      const a = generateGraph(kind, SIZE_PRESETS.M, 1729);
      const b = generateGraph(kind, SIZE_PRESETS.M, 1729);
      expectSameGraph(a, b);
    }
  });

  it("is byte-identical for city at M on one seed", () => {
    const a = generateGraph("city", SIZE_PRESETS.M, 42);
    const b = generateGraph("city", SIZE_PRESETS.M, 42);
    expectSameGraph(a, b);
  });
});

describe("generateGraph CSR properties", () => {
  it("emits valid CSR at S for every kind and seed", () => {
    for (const kind of GRAPH_KINDS) {
      for (const seed of S_SEEDS) {
        const graph = generateGraph(kind, SIZE_PRESETS.S, seed);
        assertValidCsr(graph);
        assertEdgeRegime(kind, graph);
      }
    }
  });

  it("emits valid CSR at M for maze, clusters, and sparse", () => {
    for (const kind of M_KINDS) {
      const graph = generateGraph(kind, SIZE_PRESETS.M, 7);
      assertValidCsr(graph);
      assertEdgeRegime(kind, graph);
    }
  });

  it("emits valid CSR for city at M", () => {
    const graph = generateGraph("city", SIZE_PRESETS.M, 7);
    assertValidCsr(graph);
    assertEdgeRegime("city", graph);
  });
});

describe("generateGraph validation", () => {
  it("rejects non-positive n", () => {
    expect(() => generateGraph("sparse", 0, 1)).toThrow(/n must be an integer >= 1/);
  });
});

function expectSameGraph(a: Graph, b: Graph): void {
  expect(a.n).toBe(b.n);
  expect(a.m).toBe(b.m);
  expect(a.offsets).toEqual(b.offsets);
  expect(a.targets).toEqual(b.targets);
  expect(a.weights).toEqual(b.weights);
  expect(a.x).toEqual(b.x);
  expect(a.y).toEqual(b.y);
}

function assertValidCsr(graph: Graph): void {
  expect(graph.offsets).toBeInstanceOf(Uint32Array);
  expect(graph.targets).toBeInstanceOf(Uint32Array);
  expect(graph.weights).toBeInstanceOf(Float64Array);
  expect(graph.x).toBeInstanceOf(Float64Array);
  expect(graph.y).toBeInstanceOf(Float64Array);
  expect(graph.offsets.length).toBe(graph.n + 1);
  expect(graph.targets.length).toBe(graph.m);
  expect(graph.weights.length).toBe(graph.m);
  expect(graph.x.length).toBe(graph.n);
  expect(graph.y.length).toBe(graph.n);
  expect(graph.offsets[graph.n]).toBe(graph.m);

  for (let v = 0; v < graph.n; v += 1) {
    const start = graph.offsets[v];
    const end = graph.offsets[v + 1];
    if (start === undefined || end === undefined) {
      throw new Error(`missing offsets at vertex ${v}`);
    }
    expect(start).toBeLessThanOrEqual(end);
    let prevTarget = -1;
    for (let e = start; e < end; e += 1) {
      const to = graph.targets[e];
      const weight = graph.weights[e];
      if (to === undefined || weight === undefined) {
        throw new Error(`missing edge fields at ${e}`);
      }
      expect(to).toBeGreaterThanOrEqual(0);
      expect(to).toBeLessThan(graph.n);
      expect(to).not.toBe(v);
      expect(to).toBeGreaterThanOrEqual(prevTarget);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(weight)).toBe(true);
      prevTarget = to;
    }
    expect(Number.isFinite(graph.x[v])).toBe(true);
    expect(Number.isFinite(graph.y[v])).toBe(true);
  }
}

function assertEdgeRegime(kind: GraphKind, graph: Graph): void {
  const { n, m } = graph;
  if (kind === "sparse") {
    expect(m).toBe(2 * n);
    return;
  }
  if (kind === "maze") {
    expect(m).toBe(2 * (n - 1));
    return;
  }
  if (kind === "city") {
    expect(m).toBeGreaterThanOrEqual(2 * n);
    expect(m).toBeLessThanOrEqual(12 * n);
    return;
  }
  expect(m).toBeGreaterThan(2 * n);
  expect(m).toBeLessThan(n * 20);
}
