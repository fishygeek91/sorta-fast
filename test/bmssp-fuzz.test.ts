import { describe, expect, it } from "vitest";

import { bellmanFord } from "../src/core/bellmanFord.ts";
import { generateGraph, GRAPH_KINDS } from "../src/core/graph.ts";
import {
  auditBmsspDistancesFromTrace,
  assertBoundedSettleInvariant,
  drainBmsspRun,
} from "./bmssp-helpers.ts";
import { drainRun } from "./dijkstra-helpers.ts";

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

describe("bmssp differential fuzz", () => {
  it("matches Dijkstra and Bellman-Ford on 5000 seeded graphs with trace audit and bounded-settle invariant", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 5000; seed += 1) {
      const kind = GRAPH_KINDS[seed % 4];
      const n = 8 + (seed % 40);
      const source = seed % n;
      const graph = generateGraph(kind, n, seed);
      const ctx = formatGraph(seed, kind, n, source);

      const { events, result } = drainBmsspRun(graph, source);
      const dijkstra = drainRun(graph, source);
      const ref = bellmanFord(graph, source);

      if (!float64ArraysEqual(result.distances, dijkstra.result.distances)) {
        violations.push(`${ctx}: distances differ from Dijkstra`);
      }

      if (!float64ArraysEqual(result.distances, ref)) {
        violations.push(`${ctx}: distances differ from Bellman-Ford`);
      }

      const audited = auditBmsspDistancesFromTrace(graph, events, source);
      if (!float64ArraysEqual(audited, result.distances)) {
        violations.push(`${ctx}: trace audit distances differ from algorithm output`);
      }

      const settleViolations = assertBoundedSettleInvariant(events, result.distances);
      for (const msg of settleViolations) {
        violations.push(`${ctx}: ${msg}`);
      }
    }

    expect(violations).toEqual([]);
  }, 120_000);
});
