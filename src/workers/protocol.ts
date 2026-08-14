/**
 * Worker ↔ main thread message types for streamed trace runs (issue #8, #12).
 *
 * Dijkstra and BMSSP workers share the same request shape; optional `algo`
 * defaults to `"dijkstra"` for backward compatibility on the Dijkstra worker.
 */

import { type BmsspParamMode } from "../core/bmssp/params.ts";
import { type Graph, type GraphKind } from "../core/graph.ts";
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
  /** BMSSP only: `"demo"` or `"paper"`; omitted → demo {@link bmsspParams}(n). Dijkstra ignores. */
  mode?: BmsspParamMode;
  /** BMSSP only: optional level parameter k; omitted → mode default. Dijkstra ignores. */
  k?: number;
  /** BMSSP only: optional block parameter t; omitted → mode default. Dijkstra ignores. */
  t?: number;
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
  /** BMSSP only: resolved FindPivots/level k. Must arrive with `t`; Dijkstra omits both. */
  k?: number;
  /** BMSSP only: resolved block parameter t. Must arrive with `k`; Dijkstra omits both. */
  t?: number;
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

/** Worker → main: graph generation progress ratio in [0, 1] (issue #20). */
export type TraceProgressMessage = {
  type: "progress";
  phase: "generate";
  ratio: number;
};

/** Union of all worker → main payloads. */
export type WorkerToMain =
  | TraceGraphMessage
  | TraceChunkMessage
  | TraceDoneMessage
  | TraceErrorMessage
  | TraceProgressMessage;

/**
 * Narrow a raw `MessageEvent.data` payload to a {@link WorkerToMain} message.
 *
 * @param data - Untrusted worker postMessage payload.
 * @returns A validated worker message, or `null` when unrecognized.
 */
export function parseWorkerToMain(data: unknown): WorkerToMain | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const record: Record<string, unknown> = Object(data);

  switch (record["type"]) {
    case "graph": {
      const n = record["n"];
      const m = record["m"];
      const offsets = record["offsets"];
      const targets = record["targets"];
      const weights = record["weights"];
      const x = record["x"];
      const y = record["y"];
      if (
        typeof n !== "number" ||
        typeof m !== "number" ||
        !(offsets instanceof Uint32Array) ||
        !(targets instanceof Uint32Array) ||
        !(weights instanceof Float64Array) ||
        !(x instanceof Float64Array) ||
        !(y instanceof Float64Array)
      ) {
        return null;
      }
      const k = parseOptionalBmsspInt(record["k"]);
      if (k === null) {
        return null;
      }
      const t = parseOptionalBmsspInt(record["t"]);
      if (t === null) {
        return null;
      }
      // BMSSP always sends both; Dijkstra omits both. A half pair is malformed.
      if ((k === undefined) !== (t === undefined)) {
        return null;
      }
      const message: TraceGraphMessage = {
        type: "graph",
        n,
        m,
        offsets,
        targets,
        weights,
        x,
        y,
      };
      if (k !== undefined) {
        message.k = k;
      }
      if (t !== undefined) {
        message.t = t;
      }
      return message;
    }
    case "chunk": {
      const chunk = record["chunk"];
      if (!isTraceChunk(chunk)) {
        return null;
      }
      return { type: "chunk", chunk };
    }
    case "progress": {
      const phase = record["phase"];
      const ratio = record["ratio"];
      if (
        phase !== "generate" ||
        typeof ratio !== "number" ||
        !Number.isFinite(ratio) ||
        ratio < 0 ||
        ratio > 1
      ) {
        return null;
      }
      return { type: "progress", phase: "generate", ratio };
    }
    case "done":
      return { type: "done" };
    case "error": {
      const message = record["message"];
      if (typeof message !== "string") {
        return null;
      }
      return { type: "error", message };
    }
    default:
      return null;
  }
}

/**
 * Validate an optional BMSSP integer parameter on a worker graph message.
 *
 * @param value - Raw field from the payload.
 * @returns The validated integer, `undefined` when omitted, or `null` when invalid.
 */
function parseOptionalBmsspInt(value: unknown): number | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    return null;
  }
  return value;
}

/**
 * Build a CSR {@link Graph} from a validated worker graph message.
 *
 * @param message - Worker graph payload with typed-array topology.
 * @returns Graph view referencing the same array buffers as `message`.
 */
export function graphFromTraceMessage(message: TraceGraphMessage): Graph {
  return {
    n: message.n,
    m: message.m,
    offsets: message.offsets,
    targets: message.targets,
    weights: message.weights,
    x: message.x,
    y: message.y,
  };
}

/**
 * Type guard for a trace slab embedded in a worker chunk message.
 *
 * @param value - Candidate chunk column bundle from `MessageEvent.data`.
 */
export function isTraceChunk(value: unknown): value is TraceChunk {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record: Record<string, unknown> = Object(value);
  const count = record["count"];
  const kind = record["kind"];
  const vertex = record["vertex"];
  const edge = record["edge"];
  const aux0 = record["aux0"];
  const aux1 = record["aux1"];
  const aux2 = record["aux2"];
  const auxF = record["auxF"];
  const cost = record["cost"];
  return (
    typeof count === "number" &&
    kind instanceof Uint8Array &&
    vertex instanceof Int32Array &&
    edge instanceof Int32Array &&
    aux0 instanceof Int32Array &&
    aux1 instanceof Int32Array &&
    aux2 instanceof Int32Array &&
    auxF instanceof Float64Array &&
    cost instanceof Uint32Array
  );
}
