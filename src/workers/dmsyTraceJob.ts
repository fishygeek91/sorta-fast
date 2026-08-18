/**
 * Pure DMSY trace job: generate graph, stream trace chunks.
 *
 * Node-safe — no Worker, DOM, Math.random, or Date.now.
 */

import { degreeReduce } from "../core/dmsy/degreeReduce.ts";
import { dmsyParams, run, type DmsyParamMode, type DmsyParams } from "../core/dmsy/dmsy.ts";
import { generateGraph, type Graph, type GraphKind } from "../core/graph.ts";
import { TraceWriter, type TraceChunk } from "../core/trace.ts";

/** Parameters for a single DMSY trace run. */
export type DmsyTraceSpec = {
  kind: GraphKind;
  n: number;
  seed: number;
  source: number;
  /** Optional `"demo"` or `"paper"`; omitted → demo {@link dmsyParams}(n). */
  mode?: DmsyParamMode;
  /** Optional level parameter k; omitted → mode default. */
  k?: number;
  /** Optional block parameter t; omitted → mode default. */
  t?: number;
  /** Optional TraceWriter slab capacity (tests may use a small value). */
  chunkCapacity?: number;
};

/**
 * Callbacks invoked as graph and trace chunks become available.
 *
 * `onGraph` receives the resolved {@link DmsyParams} (k/t) used for the subsequent run.
 */
export type JobSink = {
  onGraph: (graph: Graph, params: DmsyParams) => void;
  onChunk: (chunk: TraceChunk) => void;
  /** Optional graph-generation progress ratio in [0, 1] (issue #20). */
  onProgress?: (ratio: number) => void;
};

/**
 * Resolve DMSY k/t for the gallery graph (matches {@link run} defaults).
 *
 * @param graph - CSR graph about to be traced.
 * @param k - Optional level override.
 * @param t - Optional block override.
 * @param mode - Optional `"demo"` or `"paper"`; omitted → demo.
 */
export function resolveDmsyTraceParams(
  graph: Graph,
  k?: number,
  t?: number,
  mode?: DmsyParamMode,
): DmsyParams {
  const reduced = degreeReduce(graph);
  const delta = reduced.delta ?? 3;
  return dmsyParams(graph.n, {
    mode: mode ?? "demo",
    k,
    t,
    delta,
  });
}

/**
 * Validate {@link DmsyTraceSpec} before graph generation.
 *
 * @throws When `n`, `seed`, `source`, `mode`, `k`, or `t` are out of range; `kind` is checked by {@link generateGraph}.
 */
function validateSpec(spec: DmsyTraceSpec): void {
  if (!Number.isInteger(spec.n) || spec.n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(spec.n)}`);
  }
  if (!Number.isInteger(spec.seed) || !Number.isFinite(spec.seed)) {
    throw new Error(`seed must be a finite integer, got ${String(spec.seed)}`);
  }
  if (!Number.isInteger(spec.source) || spec.source < 0 || spec.source >= spec.n) {
    throw new Error(`source must be an integer in [0, n), got ${String(spec.source)}`);
  }
  if (spec.mode !== undefined && spec.mode !== "demo" && spec.mode !== "paper") {
    throw new Error(`mode must be "demo" or "paper", got ${String(spec.mode)}`);
  }
  if (spec.k !== undefined) {
    if (!Number.isInteger(spec.k) || spec.k < 1) {
      throw new Error(`k must be an integer >= 1, got ${String(spec.k)}`);
    }
  }
  if (spec.t !== undefined) {
    if (!Number.isInteger(spec.t) || spec.t < 1) {
      throw new Error(`t must be an integer >= 1, got ${String(spec.t)}`);
    }
  }
  if (spec.chunkCapacity !== undefined) {
    if (!Number.isInteger(spec.chunkCapacity) || spec.chunkCapacity < 1) {
      throw new Error(`chunkCapacity must be an integer >= 1, got ${String(spec.chunkCapacity)}`);
    }
  }
}

/**
 * Generate graph, run DMSY, stream completed slabs via drainCompleted,
 * then takeChunks remainder. Calls onGraph once (with resolved k/t), onChunk zero or more times.
 *
 * @param spec - Graph kind, size, seed, source, optional mode/k/t overrides, and optional writer capacity.
 * @param sink - Receives the CSR graph and resolved DMSY params once, then each trace chunk in order.
 */
export function runDmsyTraceJob(spec: DmsyTraceSpec, sink: JobSink): void {
  validateSpec(spec);

  const graph = generateGraph(spec.kind, spec.n, spec.seed, sink.onProgress);
  const params = resolveDmsyTraceParams(graph, spec.k, spec.t, spec.mode);
  sink.onGraph(graph, params);

  const writer = new TraceWriter(spec.chunkCapacity);

  for (const event of run(graph, spec.source, params)) {
    writer.append(event);
    for (const chunk of writer.drainCompleted()) {
      sink.onChunk(chunk);
    }
  }

  for (const chunk of writer.takeChunks()) {
    sink.onChunk(chunk);
  }
}
