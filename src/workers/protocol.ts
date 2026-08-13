/**
 * Worker ↔ main thread message types for streamed Dijkstra traces (issue #8).
 */

import { type GraphKind } from "../core/graph.ts";
import { type TraceChunk } from "../core/trace.ts";

/** Main → worker: start a graph generation + Dijkstra trace run. */
export type TraceRunRequest = {
  type: "run";
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
