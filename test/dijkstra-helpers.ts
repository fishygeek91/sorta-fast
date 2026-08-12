/**
 * Shared helpers for Dijkstra unit, golden-trace, and audit tests.
 *
 * `drainRun` collects every yielded {@link TraceEvent} and the generator's
 * final {@link DijkstraResult}. `auditDistancesFromTrace` replays improving
 * relax events alone to re-derive distances for trace-audit checks. That
 * replay assumes the emitter relaxes only from settled/final vertices
 * (Dijkstra-specific) — BMSSP/DMSY must not import this helper.
 */

import { run, type DijkstraResult } from "../src/core/dijkstra.ts";
import { type Graph, type VertexId } from "../src/core/graph.ts";
import { type TraceEvent } from "../src/core/trace.ts";

/**
 * Run Dijkstra to completion, collecting all trace events and the final result.
 *
 * @throws If the generator finishes without returning a result object.
 */
export function drainRun(
  graph: Graph,
  source: VertexId,
): {
  events: TraceEvent[];
  result: DijkstraResult;
} {
  const events: TraceEvent[] = [];
  const gen = run(graph, source);

  for (;;) {
    const step = gen.next();
    if (step.done) {
      if (step.value === undefined) {
        throw new Error("dijkstra run finished without returning a result");
      }
      return { events, result: step.value };
    }
    events.push(step.value);
  }
}

/**
 * Re-derive shortest-path distances by replaying improving relax events only.
 *
 * Ignores heap and settle events. For each relax with `improved === true`,
 * sets `dist[to] = dist[from] + weight` using CSR edge tails.
 *
 * Assumes the emitter relaxes only from settled/final vertices — Dijkstra-specific.
 * BMSSP/DMSY can improve a vertex after some of its out-edges were already
 * relaxed; a naive reuse of this audit would produce wrong distances.
 *
 * @throws If `source` is out of range or CSR slots are missing.
 */
export function auditDistancesFromTrace(
  graph: Graph,
  events: readonly TraceEvent[],
  source: VertexId,
): Float64Array {
  const { n, m, offsets, targets, weights } = graph;

  if (!Number.isInteger(source) || source < 0 || source >= n) {
    throw new Error(`source must be an integer in [0, ${n}), got ${String(source)}`);
  }

  const distances = new Float64Array(n);
  distances.fill(Number.POSITIVE_INFINITY);
  distances[source] = 0;

  const tails = new Uint32Array(m);
  for (let v = 0; v < n; v += 1) {
    const arcStart = offsets[v];
    const arcEnd = offsets[v + 1];
    if (arcStart === undefined || arcEnd === undefined) {
      throw new Error(`offsets for vertex ${v} missing`);
    }
    for (let e = arcStart; e < arcEnd; e += 1) {
      tails[e] = v;
    }
  }

  for (const event of events) {
    if (event.k !== "relax" || !event.improved) {
      continue;
    }

    const e = event.e;
    const from = tails[e];
    const to = targets[e];
    const weight = weights[e];
    if (from === undefined || to === undefined || weight === undefined) {
      throw new Error(`CSR arc ${e} missing`);
    }

    const distFrom = distances[from];
    if (distFrom === undefined) {
      throw new Error(`distances[${from}] missing`);
    }

    distances[to] = distFrom + weight;
  }

  return distances;
}
