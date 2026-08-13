/**
 * Worker ↔ main thread message types for streamed trace runs (issue #8, #12).
 *
 * Dijkstra and BMSSP workers share the same request shape; optional `algo`
 * defaults to `"dijkstra"` for backward compatibility on the Dijkstra worker.
 */

import { type GraphKind } from "../core/graph.ts";
import { type TraceChunk } from "../core/trace.ts";

/** Lane algorithm selector for trace worker requests. */
export type TraceAlgo = "dijkstra" | "bmssp";

/** Main → worker: start a graph generation + algorithm trace run. */
export type TraceRunRequest = {
  type: "run";
  /** Defaults to `"dijkstra"` when omitted (Dijkstra worker). BMSSP worker ignores or expects `"bmssp"`. */
  algo?: TraceAlgo;
  kind: GraphKind;
  n: number;
  seed: number;
  source: number;
};

/** Worker → main: CSR graph layout and topology for the requested run. */
export type TraceGraphMessage = {
  type: "graph";
  n: number;
  m: number;
  offsets: Uint32Array;
  targets: Uint32Array;
  weights: Float64Array;
  x: Float64Array;
  y: Float64Array;
};

/** Worker → main: one completed or flushed trace slab. */
export type TraceChunkMessage = {
  type: "chunk";
  chunk: TraceChunk;
};

/** Worker → main: trace stream finished without error. */
export type TraceDoneMessage = { type: "done" };

/** Worker → main: run failed; `message` is safe to surface in UI. */
export type TraceErrorMessage = { type: "error"; message: string };

/** Union of all worker → main payloads. */
export type WorkerToMain =
  TraceGraphMessage | TraceChunkMessage | TraceDoneMessage | TraceErrorMessage;
