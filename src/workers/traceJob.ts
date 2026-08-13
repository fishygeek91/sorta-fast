/**
 * Headless trace job dispatcher: route by algorithm to Dijkstra or BMSSP (issue #13).
 *
 * Node-safe — no Worker, DOM, Math.random, or Date.now.
 */

import { runBmsspTraceJob } from "./bmsspTraceJob.ts";
import { runDijkstraTraceJob, type JobSink } from "./dijkstraTraceJob.ts";
import { type TraceAlgo } from "./protocol.ts";
import { type GraphKind } from "../core/graph.ts";

/** Parameters shared by Dijkstra and BMSSP trace runs. */
export type TraceJobSpec = {
  kind: GraphKind;
  n: number;
  seed: number;
  source: number;
  /** Optional TraceWriter slab capacity (tests may use a small value). */
  chunkCapacity?: number;
};

export type { JobSink };

/**
 * Run a trace job for the requested algorithm.
 *
 * @param algo - `"dijkstra"` or `"bmssp"`.
 * @param spec - Graph kind, size, seed, source, and optional writer capacity.
 * @param sink - Receives the CSR graph once, then each trace chunk in order.
 * @throws When `algo` is not a supported {@link TraceAlgo}.
 */
export function runTraceJob(algo: TraceAlgo, spec: TraceJobSpec, sink: JobSink): void {
  switch (algo) {
    case "dijkstra":
      runDijkstraTraceJob(spec, sink);
      return;
    case "bmssp":
      runBmsspTraceJob(spec, sink);
      return;
    default: {
      const unexpected: never = algo;
      throw new Error(`unsupported trace algorithm: ${String(unexpected)}`);
    }
  }
}
