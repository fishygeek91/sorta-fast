import { describe, expect, it } from "vitest";

import { bellmanFord } from "../src/core/bellmanFord.ts";
import { generateGraph, GRAPH_KINDS } from "../src/core/graph.ts";
import { drainBmsspRun } from "./bmssp-helpers.ts";
import { drainRun } from "./dijkstra-helpers.ts";
import {
  auditDmsyLengthsFromTrace,
  assertDmsyBoundedSettle,
  assertDmsyLexTieBreak,
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

describe("dmsy differential fuzz", () => {
  it("matches Dijkstra, BMSSP, and Bellman-Ford on 10000 seeded graphs with trace audit and invariants", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 10000; seed += 1) {
      const kind = GRAPH_KINDS[seed % GRAPH_KINDS.length];
      if (kind === undefined) {
        throw new Error(`unexpected graph kind index for seed ${String(seed)}`);
      }
      const n = 8 + (seed % 40);
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
