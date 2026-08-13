import { describe, expect, it } from "vitest";

import { bellmanFord } from "../src/core/bellmanFord.ts";
import { generateGraph, GRAPH_KINDS } from "../src/core/graph.ts";
import { auditDistancesFromTrace, drainRun } from "./dijkstra-helpers.ts";

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

describe("dijkstra differential fuzz", () => {
  it("matches Bellman-Ford on 1000 seeded graphs with trace audit and settle-order invariant", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 1000; seed += 1) {
      const kind = GRAPH_KINDS[seed % GRAPH_KINDS.length];
      if (kind === undefined) {
        throw new Error(`unexpected graph kind index for seed ${String(seed)}`);
      }
      const n = 8 + (seed % 40);
      const source = seed % n;
      const graph = generateGraph(kind, n, seed);
      const ctx = formatGraph(seed, kind, n, source);

      const { events, result } = drainRun(graph, source);
      const ref = bellmanFord(graph, source);

      if (!float64ArraysEqual(result.distances, ref)) {
        violations.push(`${ctx}: distances differ from Bellman-Ford`);
      }

      const audited = auditDistancesFromTrace(graph, events, source);
      if (!float64ArraysEqual(audited, result.distances)) {
        violations.push(`${ctx}: trace audit distances differ from algorithm output`);
      }

      let prevSettleDist = -Infinity;
      for (const event of events) {
        if (event.k === "heap" && event.op === "sift") {
          violations.push(`${ctx}: unexpected heap sift event`);
        }

        if (event.k === "settle") {
          const dist = result.distances[event.v];
          if (dist === undefined) {
            violations.push(`${ctx}: settle vertex ${event.v} missing distance`);
            continue;
          }
          if (dist < prevSettleDist) {
            violations.push(
              `${ctx}: settle-order violation at v=${event.v} dist=${dist} < prev=${prevSettleDist}`,
            );
          }
          prevSettleDist = dist;
        }
      }
    }

    expect(violations).toEqual([]);
  }, 30_000);
});
