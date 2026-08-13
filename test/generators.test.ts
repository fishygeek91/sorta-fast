import { describe, expect, it } from "vitest";

import {
  CITY_MAX_N,
  generateGraph,
  GRAPH_KINDS,
  isBfsReachable,
  pickFinishVertex,
  SIZE_PRESETS,
  type Graph,
  type GraphKind,
} from "../src/core/graph.ts";

const S_SEEDS = [0, 1, 42, 1729, 0xffffffff];
const M_KINDS: GraphKind[] = ["maze", "clusters", "sparse", "adversarial"];

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

  it("is byte-identical at M for maze, clusters, sparse, and adversarial", () => {
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

  it("emits valid CSR at M for maze, clusters, sparse, and adversarial", () => {
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

  it("rejects sparse graphs too small to place m = 2n arcs", () => {
    expect(() => generateGraph("sparse", 2, 1)).toThrow(/n >= 3/);
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

  const violations: string[] = [];

  for (let v = 0; v < graph.n; v += 1) {
    const start = graph.offsets[v];
    const end = graph.offsets[v + 1];
    if (start === undefined || end === undefined) {
      violations.push(`vertex ${v}: missing offsets`);
      continue;
    }
    if (start > end) {
      violations.push(`vertex ${v}: offsets not nondecreasing (${start} > ${end})`);
    }
    let prevTarget = -1;
    for (let e = start; e < end; e += 1) {
      const to = graph.targets[e];
      const weight = graph.weights[e];
      if (to === undefined || weight === undefined) {
        violations.push(`edge ${e}: missing fields`);
        continue;
      }
      if (to < 0) {
        violations.push(`edge ${e}: target ${to} out of range (< 0)`);
      } else if (to >= graph.n) {
        violations.push(`edge ${e}: target ${to} out of range (>= n=${graph.n})`);
      }
      if (to === v) {
        violations.push(`edge ${e}: self-loop at vertex ${v}`);
      }
      if (to < prevTarget) {
        violations.push(`vertex ${v} edge ${e}: targets not sorted (${to} < ${prevTarget})`);
      }
      if (to === prevTarget) {
        violations.push(`vertex ${v} edge ${e}: duplicate arc ${v} -> ${to}`);
      }
      if (weight < 0) {
        violations.push(`edge ${e}: weight ${weight} < 0`);
      }
      if (!Number.isFinite(weight)) {
        violations.push(`edge ${e}: weight ${weight} not finite`);
      }
      prevTarget = to;
    }
    if (!Number.isFinite(graph.x[v])) {
      violations.push(`vertex ${v}: x not finite`);
    }
    if (!Number.isFinite(graph.y[v])) {
      violations.push(`vertex ${v}: y not finite`);
    }
  }

  expect(violations).toEqual([]);
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
  if (kind === "adversarial") {
    if (n < 2) {
      expect(m).toBe(0);
      return;
    }
    expect(m).toBe(2 * (n - 1));
    return;
  }
  expect(m).toBeGreaterThan(2 * n);
  expect(m).toBeLessThan(n * 20);
}

function maxOutDegree(graph: Graph): number {
  let max = 0;
  for (let v = 0; v < graph.n; v += 1) {
    const start = graph.offsets[v];
    const end = graph.offsets[v + 1];
    if (start === undefined || end === undefined) {
      continue;
    }
    const degree = end - start;
    if (degree > max) {
      max = degree;
    }
  }
  return max;
}

function adversarialChainLen(n: number): number {
  return Math.max(2, Math.floor(Math.sqrt(n)));
}

describe("generateGraph adversarial", () => {
  it("produces a single isolated vertex at n = 1", () => {
    const graph = generateGraph("adversarial", 1, 42);
    expect(graph.n).toBe(1);
    expect(graph.m).toBe(0);
    expect(graph.x[0]).toBe(0);
    expect(graph.y[0]).toBe(0.5);
  });

  it("has m = 2(n - 1) and is fully reachable from source 0 when n >= 2", () => {
    for (const n of [2, 3, 8, 42, 500]) {
      const graph = generateGraph("adversarial", n, 1729);
      expect(graph.m).toBe(2 * (n - 1));
      for (let v = 0; v < n; v += 1) {
        expect(isBfsReachable(graph, 0, v)).toBe(true);
      }
    }
  });

  it("forms a wide fan at preset S with seed 42", () => {
    const n = SIZE_PRESETS.S;
    const chainLen = adversarialChainLen(n);
    const graph = generateGraph("adversarial", n, 42);
    const minFanDegree = Math.floor((n - chainLen) / Math.max(chainLen - 1, 1));
    expect(maxOutDegree(graph)).toBeGreaterThanOrEqual(minFanDegree);
  });

  it("picks the rightmost chain vertex as finish from source 0", () => {
    for (const n of [8, 42, SIZE_PRESETS.S]) {
      const chainLen = adversarialChainLen(n);
      const graph = generateGraph("adversarial", n, 42);
      expect(pickFinishVertex(graph, 0)).toBe(chainLen - 1);
    }
  });

  it("does not change bytes when onProgress collects ratios including 0 and 1", () => {
    const ratios: number[] = [];
    const withProgress = generateGraph("adversarial", SIZE_PRESETS.S, 42, (ratio) => {
      ratios.push(ratio);
    });
    const withoutProgress = generateGraph("adversarial", SIZE_PRESETS.S, 42);
    expectSameGraph(withProgress, withoutProgress);
    expect(ratios.length).toBeGreaterThan(0);
    expect(ratios[0]).toBe(0);
    expect(ratios[ratios.length - 1]).toBe(1);
  });

  it("is byte-identical with and without onProgress at preset S", () => {
    const a = generateGraph("adversarial", SIZE_PRESETS.S, 1729);
    const b = generateGraph("adversarial", SIZE_PRESETS.S, 1729, () => {
      // no-op
    });
    expectSameGraph(a, b);
  });
});

describe("city cap", () => {
  it("defines CITY_MAX_N as the L preset (25000)", () => {
    expect(CITY_MAX_N).toBe(SIZE_PRESETS.L);
    expect(CITY_MAX_N).toBe(25000);
  });

  it("rejects city graphs above CITY_MAX_N", () => {
    expect(() => generateGraph("city", CITY_MAX_N + 1, 1)).toThrow(/issue #32|capped at L/);
    expect(() => generateGraph("city", SIZE_PRESETS.XL, 1)).toThrow(/issue #32|capped at L/);
  });

  it("reports progress at preset S with first ~0, last 1, and length <= 102", () => {
    const ratios: number[] = [];
    generateGraph("city", SIZE_PRESETS.S, 42, (ratio) => {
      ratios.push(ratio);
    });
    expect(ratios.length).toBeGreaterThan(0);
    expect(ratios.length).toBeLessThanOrEqual(102);
    expect(ratios[0]).toBe(0);
    expect(ratios[ratios.length - 1]).toBe(1);
  });
});
