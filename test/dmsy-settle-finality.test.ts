/**
 * issue #92 harness unit tests — post-settle improve witness classification.
 */

import { describe, expect, it } from "vitest";

import { type DistanceLabel, compareLabels } from "../src/core/dmsy/forest.ts";
import {
  packCsr,
  type CsrEdge,
  type Graph,
  generateGraph,
  GRAPH_KINDS,
} from "../src/core/graph.ts";
import { type TraceEvent } from "../src/core/trace.ts";
import {
  assertDmsySettleFinality,
  drainDmsyInstrumented,
  type DmsySettleImproveFinding,
  type DmsySettleImproveRegion,
} from "./dmsy-helpers.ts";

/** Default layout coordinates for tiny test graphs. */
const COORDS_3: number[] = [0, 1, 2];

/**
 * Resolve a CSR edge index by tail, head, and weight.
 *
 * @throws When offsets are missing or no matching arc exists.
 */
function edgeId(graph: Graph, from: number, to: number, weight: number): number {
  const start = graph.offsets[from];
  const end = graph.offsets[from + 1];
  if (start === undefined || end === undefined) {
    throw new Error("offsets missing");
  }
  for (let e = start; e < end; e += 1) {
    if (graph.targets[e] === to && graph.weights[e] === weight) {
      return e;
    }
  }
  throw new Error(`missing edge ${from}->${to} w=${weight}`);
}

/**
 * Build the 3-vertex chain graph used for clean-trace and region cases.
 *
 * Arcs: 0→1 (w=1), 1→2 (w=1), 0→2 (w=3).
 */
function chainGraphWithBypass(): Graph {
  const edges: CsrEdge[] = [
    { from: 0, to: 1, weight: 1 },
    { from: 1, to: 2, weight: 1 },
    { from: 0, to: 2, weight: 3 },
  ];
  return packCsr(3, edges, COORDS_3, COORDS_3);
}

/** True when two distance labels are lexicographically equal. */
function labelsEqual(a: DistanceLabel, b: DistanceLabel): boolean {
  return compareLabels(a, b) === "=";
}

/** Assert a single finding matches the expected vertex, class, and region. */
function expectFindingShape(
  finding: DmsySettleImproveFinding,
  expected: {
    vertex: number;
    klass: DmsySettleImproveFinding["klass"];
    region: DmsySettleImproveRegion;
    settleOrder: number;
  },
): void {
  expect(finding.vertex).toBe(expected.vertex);
  expect(finding.klass).toBe(expected.klass);
  expect(finding.region).toBe(expected.region);
  expect(finding.settleOrder).toBe(expected.settleOrder);
}

describe("assertDmsySettleFinality clean trace", () => {
  it("reports no findings on a monotone settle-then-relax chain", () => {
    const graph = chainGraphWithBypass();
    const e01 = edgeId(graph, 0, 1, 1);

    const events: TraceEvent[] = [
      { k: "recurse", dir: "in", level: 0, bound: Number.POSITIVE_INFINITY },
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "recurse", dir: "out", level: 0, bound: Number.POSITIVE_INFINITY },
    ];

    const report = assertDmsySettleFinality(graph, events, 0);
    expect(report.findings).toEqual([]);
    expect(report.messages).toEqual([]);
  });
});

describe("assertDmsySettleFinality equal-label after settle", () => {
  it("classifies a duplicate improving relax as equal-label", () => {
    const graph = chainGraphWithBypass();
    const e01 = edgeId(graph, 0, 1, 1);

    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
    ];

    const report = assertDmsySettleFinality(graph, events, 0);
    expect(report.findings).toHaveLength(1);
    expectFindingShape(report.findings[0], {
      vertex: 1,
      klass: "equal-label",
      region: "in-level",
      settleOrder: 1,
    });

    const settleLabel: DistanceLabel = { length: 1, nEdges: 1, curr: 1, pred: 0 };
    expect(report.findings[0].settleLabel).toEqual(settleLabel);
    expect(report.findings[0].candidateLabel).toEqual(settleLabel);
    expect(labelsEqual(report.findings[0].settleLabel, report.findings[0].candidateLabel)).toBe(
      true,
    );
    expect(report.messages).toHaveLength(1);
  });
});

describe("assertDmsySettleFinality strict-length after settle", () => {
  it("classifies a shorter post-settle path as strict-length", () => {
    const graph = packCsr(
      3,
      [
        { from: 0, to: 2, weight: 5 },
        { from: 1, to: 2, weight: 1 },
        { from: 0, to: 1, weight: 1 },
      ],
      COORDS_3,
      COORDS_3,
    );
    const e02 = edgeId(graph, 0, 2, 5);
    const e01 = edgeId(graph, 0, 1, 1);
    const e12 = edgeId(graph, 1, 2, 1);

    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: e02, improved: true, cost: 1 },
      { k: "settle", v: 2, order: 1, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 2, cost: 1 },
      { k: "relax", e: e12, improved: true, cost: 1 },
    ];

    const report = assertDmsySettleFinality(graph, events, 0);
    expect(report.findings).toHaveLength(1);
    expectFindingShape(report.findings[0], {
      vertex: 2,
      klass: "strict-length",
      region: "in-level",
      settleOrder: 1,
    });
    expect(report.findings[0].settleLabel).toEqual({
      length: 5,
      nEdges: 1,
      curr: 2,
      pred: 0,
    });
    expect(report.findings[0].candidateLabel).toEqual({
      length: 2,
      nEdges: 2,
      curr: 2,
      pred: 1,
    });
    expect(report.findings[0].candidateLabel.length).toBeLessThan(
      report.findings[0].settleLabel.length,
    );
    expect(report.messages).toHaveLength(1);
  });
});

describe("assertDmsySettleFinality lex-only after settle", () => {
  it("classifies same-length fewer-edge improve as lex-only", () => {
    const graph = packCsr(
      3,
      [
        { from: 0, to: 2, weight: 2 },
        { from: 0, to: 1, weight: 1 },
        { from: 1, to: 2, weight: 1 },
      ],
      COORDS_3,
      COORDS_3,
    );
    const e01 = edgeId(graph, 0, 1, 1);
    const e12 = edgeId(graph, 1, 2, 1);
    const e02 = edgeId(graph, 0, 2, 2);

    const events: TraceEvent[] = [
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "relax", e: e12, improved: true, cost: 1 },
      { k: "settle", v: 2, order: 2, cost: 1 },
      { k: "relax", e: e02, improved: true, cost: 1 },
    ];

    const report = assertDmsySettleFinality(graph, events, 0);
    expect(report.findings).toHaveLength(1);
    expectFindingShape(report.findings[0], {
      vertex: 2,
      klass: "lex-only",
      region: "in-level",
      settleOrder: 2,
    });
    expect(report.findings[0].settleLabel.length).toBe(2);
    expect(report.findings[0].settleLabel.nEdges).toBe(2);
    expect(report.findings[0].candidateLabel.length).toBe(2);
    expect(report.findings[0].candidateLabel.nEdges).toBe(1);
    expect(compareLabels(report.findings[0].candidateLabel, report.findings[0].settleLabel)).toBe(
      "<",
    );
    expect(report.messages).toHaveLength(1);
  });
});

describe("assertDmsySettleFinality region tagging", () => {
  const graph = chainGraphWithBypass();

  it("tags a post-settle improve at recurse level 0 as level-0", () => {
    const e01 = edgeId(graph, 0, 1, 1);

    const events: TraceEvent[] = [
      { k: "recurse", dir: "in", level: 1, bound: 10 },
      { k: "recurse", dir: "in", level: 0, bound: Number.POSITIVE_INFINITY },
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
    ];

    const report = assertDmsySettleFinality(graph, events, 0);
    expect(report.findings).toHaveLength(1);
    expectFindingShape(report.findings[0], {
      vertex: 1,
      klass: "equal-label",
      region: "level-0",
      settleOrder: 1,
    });
    expect(report.findings[0].activeLevel).toBe(0);
  });

  it("tags a post-settle improve after child recurse out as after-child", () => {
    const e01 = edgeId(graph, 0, 1, 1);

    const events: TraceEvent[] = [
      { k: "recurse", dir: "in", level: 1, bound: 10 },
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "recurse", dir: "in", level: 0, bound: 5 },
      { k: "recurse", dir: "out", level: 0, bound: 5 },
      { k: "relax", e: e01, improved: true, cost: 1 },
    ];

    const report = assertDmsySettleFinality(graph, events, 0);
    expect(report.findings).toHaveLength(1);
    expectFindingShape(report.findings[0], {
      vertex: 1,
      klass: "equal-label",
      region: "after-child",
      settleOrder: 1,
    });
    expect(report.findings[0].activeLevel).toBe(1);
    expect(report.findings[0].recurseDepth).toBe(1);
  });

  it("tags a post-settle improve before any child recurse out as in-level", () => {
    const e01 = edgeId(graph, 0, 1, 1);

    const events: TraceEvent[] = [
      { k: "recurse", dir: "in", level: 1, bound: 10 },
      { k: "settle", v: 0, order: 0, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
      { k: "settle", v: 1, order: 1, cost: 1 },
      { k: "relax", e: e01, improved: true, cost: 1 },
    ];

    const report = assertDmsySettleFinality(graph, events, 0);
    expect(report.findings).toHaveLength(1);
    expectFindingShape(report.findings[0], {
      vertex: 1,
      klass: "equal-label",
      region: "in-level",
      settleOrder: 1,
    });
    expect(report.findings[0].activeLevel).toBe(1);
    expect(report.findings[0].recurseDepth).toBe(1);
  });
});

describe("assertDmsySettleFinality source validation", () => {
  it("throws when source is out of range", () => {
    const graph = chainGraphWithBypass();

    expect(() => assertDmsySettleFinality(graph, [], -1)).toThrow(
      /source must be an integer in \[0, 3\)/,
    );
    expect(() => assertDmsySettleFinality(graph, [], 3)).toThrow(
      /source must be an integer in \[0, 3\)/,
    );
  });

  it("accepts source 0 on an empty trace", () => {
    const graph = chainGraphWithBypass();
    const report = assertDmsySettleFinality(graph, [], 0);
    expect(report.findings).toEqual([]);
    expect(report.messages).toEqual([]);
  });
});

/**
 * Golden witnesses from issue #92 settle-finality hunt — forced {k:2,t:2} instrumented runs.
 */
describe("issue #92 golden witness", () => {
  it("city seed 0 n=8 source 0 forced {k:2,t:2} instrumented has no post-settle improves", () => {
    const graph = generateGraph("city", 8, 0);
    const { events } = drainDmsyInstrumented(graph, 0, { k: 2, t: 2 });
    expect(assertDmsySettleFinality(graph, events, 0).findings).toEqual([]);
    expect(assertDmsySettleFinality(graph, events, 0).messages).toEqual([]);
  });

  it("80-seed gallery forced {2,2} instrumented has no post-settle improves", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 80; seed += 1) {
      const kind = GRAPH_KINDS[seed % GRAPH_KINDS.length];
      if (kind === undefined) {
        throw new Error(`unexpected graph kind index for seed ${String(seed)}`);
      }
      const n = 8 + (Math.floor(seed / GRAPH_KINDS.length) % 40);
      const source = seed % n;
      const graph = generateGraph(kind, n, seed);
      const { events } = drainDmsyInstrumented(graph, source, { k: 2, t: 2 });
      const ctx = `seed=${seed} kind=${kind} n=${n} source=${source}`;

      for (const msg of assertDmsySettleFinality(graph, events, source).messages) {
        violations.push(`${ctx}: ${msg}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
