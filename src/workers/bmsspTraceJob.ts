/**
 * Pure BMSSP trace job: generate graph, stream trace chunks (issue #12).
 *
 * Node-safe — no Worker, DOM, Math.random, or Date.now.
 */

import { run } from "../core/bmssp/bmssp.ts";
import { bmsspParams, type BmsspParamMode } from "../core/bmssp/params.ts";
import { generateGraph, type Graph, type GraphKind } from "../core/graph.ts";
import { TraceWriter, type TraceChunk } from "../core/trace.ts";

/** Parameters for a single BMSSP trace run. */
export type BmsspTraceSpec = {
  kind: GraphKind;
  n: number;
  seed: number;
  source: number;
  /** Optional `"demo"` or `"paper"`; omitted → demo {@link bmsspParams}(n). */
  mode?: BmsspParamMode;
  /** Optional BMSSP level parameter k; omitted → mode default. */
  k?: number;
  /** Optional BMSSP block parameter t; omitted → mode default. */
  t?: number;
  /** Optional TraceWriter slab capacity (tests may use a small value). */
  chunkCapacity?: number;
};

/** Callbacks invoked as graph and trace chunks become available. */
export type JobSink = {
  onGraph: (graph: Graph) => void;
  onChunk: (chunk: TraceChunk) => void;
};

/**
 * Validate {@link BmsspTraceSpec} before graph generation.
 *
 * @throws When `n`, `seed`, `source`, `mode`, `k`, or `t` are out of range; `kind` is checked by {@link generateGraph}.
 */
function validateSpec(spec: BmsspTraceSpec): void {
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
 * Generate graph, run BMSSP, stream completed slabs via drainCompleted,
 * then takeChunks remainder. Calls onGraph once, onChunk zero or more times.
 *
 * @param spec - Graph kind, size, seed, source, optional k/t overrides, and optional writer capacity.
 * @param sink - Receives the CSR graph once, then each trace chunk in order.
 */
export function runBmsspTraceJob(spec: BmsspTraceSpec, sink: JobSink): void {
  validateSpec(spec);

  const graph = generateGraph(spec.kind, spec.n, spec.seed);
  sink.onGraph(graph);

  const writer = new TraceWriter(spec.chunkCapacity);

  const events = run(
    graph,
    spec.source,
    bmsspParams(graph.n, { mode: spec.mode, k: spec.k, t: spec.t }),
  );

  for (const event of events) {
    writer.append(event);
    for (const chunk of writer.drainCompleted()) {
      sink.onChunk(chunk);
    }
  }

  for (const chunk of writer.takeChunks()) {
    sink.onChunk(chunk);
  }
}
