/**
 * Reference Bellman-Ford SSSP for differential tests (issue #5).
 * Not a race lane — no trace emission, no work-clock billing.
 */

import { type Graph, type VertexId } from "./graph.ts";

/**
 * Reference single-source distances (Bellman-Ford, n-1 rounds).
 * No trace emission. Graphs are non-negative (packCsr rejects negatives).
 * Unreachable vertices stay Infinity.
 *
 * @param graph - CSR directed graph.
 * @param source - Source vertex in `0 .. n-1`.
 * @returns Per-vertex shortest-path distances; unreachable entries remain Infinity.
 */
export function bellmanFord(graph: Graph, source: VertexId): Float64Array {
  const { n, offsets, targets, weights } = graph;

  if (!Number.isInteger(source) || source < 0 || source >= n) {
    throw new Error(`source must be an integer in [0, ${n}), got ${String(source)}`);
  }

  const distances = new Float64Array(n);
  distances.fill(Infinity);
  distances[source] = 0;

  if (n <= 1) {
    return distances;
  }

  for (let round = 0; round < n - 1; round += 1) {
    for (let u = 0; u < n; u += 1) {
      const du = distances[u];
      if (du === undefined || du === Infinity) {
        continue;
      }

      const start = offsets[u];
      const end = offsets[u + 1];
      if (start === undefined || end === undefined) {
        throw new Error(`bellmanFord: missing CSR offsets for vertex ${u}`);
      }

      for (let e = start; e < end; e += 1) {
        const weight = weights[e];
        const target = targets[e];
        if (weight === undefined || target === undefined) {
          throw new Error(`bellmanFord: missing CSR edge at index ${e}`);
        }

        const cand = du + weight;
        const dv = distances[target];
        if (dv === undefined) {
          throw new Error(`bellmanFord: missing distance slot for vertex ${target}`);
        }

        if (cand < dv) {
          distances[target] = cand;
        }
      }
    }
  }

  return distances;
}
