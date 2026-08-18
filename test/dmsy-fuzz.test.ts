import { describe, expect, it } from "vitest";

import { bellmanFord } from "../src/core/bellmanFord.ts";
import { generateGraph, GRAPH_KINDS, packCsr, type CsrEdge } from "../src/core/graph.ts";
import { mulberry32 } from "../src/core/prng.ts";
import { drainBmsspRun } from "./bmssp-helpers.ts";
import { drainRun } from "./dijkstra-helpers.ts";
import {
  auditDmsyLengthsFromTrace,
  assertDmsyBoundedSettle,
  assertDmsyLexTieBreak,
  assertDmsySettleFinality,
  drainDmsyRun,
} from "./dmsy-helpers.ts";

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

function formatGraph(seed: number, kind: string, n: number, source: number): string {
  return `seed=${seed} kind=${kind} n=${n} source=${source}`;
}

/** Dense simple digraph with integer weights in {1, 2} for lex-predecessor tie fuzzing. */
function buildDenseIntegerWeightGraph(seed: number): {
  graph: ReturnType<typeof packCsr>;
  source: number;
  n: number;
} {
  const n = 4 + (seed % 9);
  const rng = mulberry32(seed);
  const edges: CsrEdge[] = [];
  for (let u = 0; u < n; u += 1) {
    for (let v = 0; v < n; v += 1) {
      if (u === v) {
        continue;
      }
      if (rng.next() < 0.4) {
        const weight = rng.next() < 0.5 ? 1 : 2;
        edges.push({ from: u, to: v, weight });
      }
    }
  }
  const coords = Array.from({ length: n }, (_, i) => i);
  const graph = packCsr(n, edges, coords, coords);
  const source = seed % n;
  return { graph, source, n };
}

describe("dmsy differential fuzz", () => {
  /**
   * Public-lane settle-finality (`drainDmsyRun` events) was already clean
   * before #92. Instrumented regression lives in `test/dmsy-settle-finality.test.ts`
   * (city-seed-0 golden + 80-seed gallery) and in {@link assertDmsyLexTieBreak}.
   */
  it("matches Dijkstra, BMSSP, and Bellman-Ford on 10000 seeded graphs with trace audit and invariants", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 10000; seed += 1) {
      const kind = GRAPH_KINDS[seed % GRAPH_KINDS.length];
      if (kind === undefined) {
        throw new Error(`unexpected graph kind index for seed ${String(seed)}`);
      }
      const n = 8 + (Math.floor(seed / GRAPH_KINDS.length) % 40);
      const source = seed % n;
      const graph = generateGraph(kind, n, seed);
      const ctx = formatGraph(seed, kind, n, source);

      const { events, result } = drainDmsyRun(graph, source);
      const dijkstra = drainRun(graph, source);
      const bmssp = drainBmsspRun(graph, source);
      const ref = bellmanFord(graph, source);

      if (!float64ArraysEqual(result.distances, dijkstra.result.distances)) {
        violations.push(`${ctx}: distances differ from Dijkstra`);
      }

      if (!float64ArraysEqual(result.distances, bmssp.result.distances)) {
        violations.push(`${ctx}: distances differ from BMSSP`);
      }

      if (!float64ArraysEqual(result.distances, ref)) {
        violations.push(`${ctx}: distances differ from Bellman-Ford`);
      }

      const audited = auditDmsyLengthsFromTrace(graph, events, source);
      if (!float64ArraysEqual(audited, result.distances)) {
        violations.push(`${ctx}: trace audit distances differ from algorithm output`);
      }

      for (const msg of assertDmsyBoundedSettle(events, result.distances)) {
        violations.push(`${ctx}: ${msg}`);
      }

      // Public-lane check; instrumented cover is the #92 golden + lex-tie-break.
      for (const msg of assertDmsySettleFinality(graph, events, source).messages) {
        violations.push(`${ctx}: ${msg}`);
      }

      if (seed % 20 === 0 || kind === "maze") {
        for (const msg of assertDmsyLexTieBreak(graph, source)) {
          violations.push(`${ctx}: ${msg}`);
        }
      }

      if (events.some((event) => event.k === "dstruct" && event.op === "batchPrepend")) {
        violations.push(`${ctx}: trace contains forbidden dstruct batchPrepend`);
      }
    }

    expect(violations).toEqual([]);
  }, 240_000);

  it("matches references on larger n and integer-weight ties", () => {
    const violations: string[] = [];

    /** Eight-vertex digraph with parallel routes and weights in {1, 2}. */
    const tieEdges: CsrEdge[] = [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 3, weight: 1 },
      { from: 2, to: 3, weight: 1 },
      { from: 0, to: 4, weight: 2 },
      { from: 4, to: 5, weight: 1 },
      { from: 5, to: 6, weight: 1 },
      { from: 6, to: 7, weight: 1 },
      { from: 3, to: 7, weight: 2 },
      { from: 1, to: 5, weight: 2 },
      { from: 2, to: 6, weight: 2 },
      { from: 1, to: 4, weight: 1 },
      { from: 2, to: 4, weight: 1 },
      { from: 3, to: 6, weight: 2 },
      { from: 2, to: 5, weight: 1 },
    ];
    const tieGraph = packCsr(8, tieEdges, [0, 1, 2, 3, 4, 5, 6, 7], [0, 0, 0, 0, 0, 0, 0, 0]);

    const cases: Array<{ graph: ReturnType<typeof generateGraph>; source: number; label: string }> =
      [
        { graph: generateGraph("maze", 80, 1), source: 0, label: "maze n=80 seed=1" },
        { graph: generateGraph("sparse", 120, 2), source: 1, label: "sparse n=120 seed=2" },
        { graph: generateGraph("city", 200, 3), source: 0, label: "city n=200 seed=3" },
        { graph: generateGraph("adversarial", 80, 4), source: 0, label: "adversarial n=80 seed=4" },
        { graph: generateGraph("clusters", 500, 5), source: 0, label: "clusters n=500 seed=5" },
        { graph: tieGraph, source: 0, label: "integer-weight ties n=8" },
      ];

    for (const { graph, source, label } of cases) {
      const ctx = label;

      const { events, result } = drainDmsyRun(graph, source);
      const dijkstra = drainRun(graph, source);
      const bmssp = drainBmsspRun(graph, source);
      const ref = bellmanFord(graph, source);

      if (!float64ArraysEqual(result.distances, dijkstra.result.distances)) {
        violations.push(`${ctx}: distances differ from Dijkstra`);
      }

      if (!float64ArraysEqual(result.distances, bmssp.result.distances)) {
        violations.push(`${ctx}: distances differ from BMSSP`);
      }

      if (!float64ArraysEqual(result.distances, ref)) {
        violations.push(`${ctx}: distances differ from Bellman-Ford`);
      }

      const audited = auditDmsyLengthsFromTrace(graph, events, source);
      if (!float64ArraysEqual(audited, result.distances)) {
        violations.push(`${ctx}: trace audit distances differ from algorithm output`);
      }

      for (const msg of assertDmsyBoundedSettle(events, result.distances)) {
        violations.push(`${ctx}: ${msg}`);
      }

      // Public-lane check; instrumented cover is the #92 golden + lex-tie-break.
      for (const msg of assertDmsySettleFinality(graph, events, source).messages) {
        violations.push(`${ctx}: ${msg}`);
      }

      for (const msg of assertDmsyLexTieBreak(graph, source)) {
        violations.push(`${ctx}: ${msg}`);
      }

      if (events.some((event) => event.k === "dstruct" && event.op === "batchPrepend")) {
        violations.push(`${ctx}: trace contains forbidden dstruct batchPrepend`);
      }
    }

    expect(violations).toEqual([]);
  }, 120_000);

  it("matches references on dense integer-weight digraphs (lex-pred load-bearing)", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 400; seed += 1) {
      const { graph, source, n } = buildDenseIntegerWeightGraph(seed);
      const ctx = `dense int seed=${seed} n=${n} source=${source}`;

      const { events, result } = drainDmsyRun(graph, source);
      const dijkstra = drainRun(graph, source);
      const bmssp = drainBmsspRun(graph, source);
      const ref = bellmanFord(graph, source);

      if (!float64ArraysEqual(result.distances, dijkstra.result.distances)) {
        violations.push(`${ctx}: distances differ from Dijkstra`);
      }

      if (!float64ArraysEqual(result.distances, bmssp.result.distances)) {
        violations.push(`${ctx}: distances differ from BMSSP`);
      }

      if (!float64ArraysEqual(result.distances, ref)) {
        violations.push(`${ctx}: distances differ from Bellman-Ford`);
      }

      const audited = auditDmsyLengthsFromTrace(graph, events, source);
      if (!float64ArraysEqual(audited, result.distances)) {
        violations.push(`${ctx}: trace audit distances differ from algorithm output`);
      }

      for (const msg of assertDmsyBoundedSettle(events, result.distances)) {
        violations.push(`${ctx}: ${msg}`);
      }

      // Public-lane check; instrumented cover is the #92 golden + lex-tie-break.
      for (const msg of assertDmsySettleFinality(graph, events, source).messages) {
        violations.push(`${ctx}: ${msg}`);
      }

      for (const msg of assertDmsyLexTieBreak(graph, source)) {
        violations.push(`${ctx}: ${msg}`);
      }

      if (events.some((event) => event.k === "dstruct" && event.op === "batchPrepend")) {
        violations.push(`${ctx}: trace contains forbidden dstruct batchPrepend`);
      }
    }

    expect(violations).toEqual([]);
  }, 60_000);

  it("produces identical events on repeated drains", () => {
    const seed = 42;
    const kind = "city";
    const n = 20;
    const source = seed % n;
    const graph = generateGraph(kind, n, seed);

    const run1 = drainDmsyRun(graph, source);
    const run2 = drainDmsyRun(graph, source);

    expect(run1.events).toEqual(run2.events);
  }, 30_000);
});
