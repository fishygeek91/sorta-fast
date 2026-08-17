/**
 * Shared helpers for DMSY forest FindPivots unit, golden-trace, and audit tests.
 *
 * `drainFindPivotsForest` collects every yielded {@link TraceEvent} and the
 * generator's final {@link ForestFindPivotsResult}. `auditForestTrace` checks
 * forest-specific event shapes, cut-edge partition disjointness, and pivot order.
 */

import {
  createDistanceStore,
  findPivotsForest,
  type DistanceLabel,
  type DistanceStore,
  type ForestFindPivotsResult,
} from "../src/core/dmsy/forest.ts";
import { type EdgeId, type Graph, type VertexId } from "../src/core/graph.ts";
import { SENTINEL, type TraceEvent } from "../src/core/trace.ts";
import { expect } from "vitest";

/**
 * Initialize a {@link DistanceStore} with sources at a uniform label.
 *
 * Non-source vertices keep the defaults from {@link createDistanceStore}.
 *
 * @throws If any source is out of range for `n`.
 */
export function makeLabels(
  n: number,
  sources: readonly VertexId[],
  sourceLength = 0,
): DistanceStore {
  const dist = createDistanceStore(n);

  for (const s of sources) {
    if (!Number.isInteger(s) || s < 0 || s >= n) {
      throw new Error(`source must be an integer in [0, ${n}), got ${String(s)}`);
    }
    dist.length[s] = sourceLength;
    dist.nEdges[s] = 0;
    dist.curr[s] = s;
    dist.pred[s] = SENTINEL;
  }

  return dist;
}

/**
 * Write all four distance-label fields for vertex `v`.
 *
 * @throws If `v` is out of range for `dist`.
 */
export function setLabel(dist: DistanceStore, v: VertexId, label: DistanceLabel): void {
  const n = dist.length.length;
  if (!Number.isInteger(v) || v < 0 || v >= n) {
    throw new Error(`vertex must be an integer in [0, ${n}), got ${String(v)}`);
  }

  dist.length[v] = label.length;
  dist.nEdges[v] = label.nEdges;
  dist.curr[v] = label.curr;
  dist.pred[v] = label.pred;
}

/**
 * Run {@link findPivotsForest} to completion, collecting trace events and the final result.
 *
 * @throws If the generator finishes without returning a result object.
 */
export function drainFindPivotsForest(
  graph: Graph,
  B: DistanceLabel,
  S: readonly VertexId[],
  k: number,
  dist: DistanceStore,
  level: number,
): { events: TraceEvent[]; result: ForestFindPivotsResult } {
  const events: TraceEvent[] = [];
  const gen = findPivotsForest(graph, B, S, k, dist, level);

  for (;;) {
    const step = gen.next();
    if (step.done) {
      if (step.value === undefined) {
        throw new Error("findPivotsForest finished without returning a result");
      }
      return { events, result: step.value };
    }
    events.push(step.value);
  }
}

/**
 * Trace audit for {@link findPivotsForest}: valid relax/forest edge ids, pivot
 * vertices and levels, nonnegative tree ids, pairwise-disjoint cut partitions,
 * and pivot emission order matching {@link ForestFindPivotsResult.P}.
 *
 * Forest traces must not emit batch, settle, recurse, or dstruct events.
 */
export function auditForestTrace(
  graph: Graph,
  events: readonly TraceEvent[],
  result: ForestFindPivotsResult,
): void {
  const pivots: VertexId[] = [];
  const cutByTree = new Map<number, EdgeId[]>();

  for (const event of events) {
    switch (event.k) {
      case "relax":
        expect(event.e).toBeGreaterThanOrEqual(0);
        expect(event.e).toBeLessThan(graph.m);
        break;
      case "forest":
        expect(event.tree).toBeGreaterThanOrEqual(0);
        expect(event.e).toBeGreaterThanOrEqual(0);
        expect(event.e).toBeLessThan(graph.m);
        if (event.op === "cut") {
          const group = cutByTree.get(event.tree);
          if (group === undefined) {
            cutByTree.set(event.tree, [event.e]);
          } else {
            group.push(event.e);
          }
        }
        break;
      case "pivot":
        expect(event.v).toBeGreaterThanOrEqual(0);
        expect(event.v).toBeLessThan(graph.n);
        expect(event.level).toBeGreaterThanOrEqual(0);
        pivots.push(event.v);
        break;
      case "batch":
      case "settle":
      case "recurse":
      case "dstruct":
        expect.fail(`forbidden ${event.k} event in forest trace`);
        break;
      default:
        break;
    }
  }

  const seenCutEdges = new Set<EdgeId>();
  for (const edges of cutByTree.values()) {
    for (const e of edges) {
      expect(seenCutEdges.has(e)).toBe(false);
      seenCutEdges.add(e);
    }
  }

  expect(pivots).toEqual(result.P);
}
