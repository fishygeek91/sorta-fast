import { describe, expect, it } from "vitest";

import { allocateChunk } from "../src/core/trace.ts";
import {
  graphFromTraceMessage,
  isTraceChunk,
  parseWorkerToMain,
  type TraceGraphMessage,
} from "../src/workers/protocol.ts";

/** Minimal valid CSR graph message for parser tests. */
function sampleGraphMessage(): TraceGraphMessage {
  return {
    type: "graph",
    n: 2,
    m: 1,
    offsets: new Uint32Array([0, 1, 1]),
    targets: new Uint32Array([1]),
    weights: new Float64Array([3.5]),
    x: new Float64Array([0, 1]),
    y: new Float64Array([0, 0]),
  };
}

describe("parseWorkerToMain", () => {
  it("accepts valid graph, chunk, done, and error messages", () => {
    const graphMessage = sampleGraphMessage();
    expect(parseWorkerToMain(graphMessage)).toEqual(graphMessage);

    const chunk = allocateChunk(4);
    expect(parseWorkerToMain({ type: "chunk", chunk })).toEqual({
      type: "chunk",
      chunk,
    });

    expect(parseWorkerToMain({ type: "done" })).toEqual({ type: "done" });
    expect(parseWorkerToMain({ type: "error", message: "boom" })).toEqual({
      type: "error",
      message: "boom",
    });
    expect(parseWorkerToMain({ type: "progress", phase: "generate", ratio: 0.5 })).toEqual({
      type: "progress",
      phase: "generate",
      ratio: 0.5,
    });
  });

  it("rejects invalid progress messages", () => {
    expect(parseWorkerToMain({ type: "progress", phase: "generate" })).toBeNull();
    expect(parseWorkerToMain({ type: "progress", phase: "trace", ratio: 0.5 })).toBeNull();
    expect(
      parseWorkerToMain({ type: "progress", phase: "generate", ratio: Number.NaN }),
    ).toBeNull();
    expect(parseWorkerToMain({ type: "progress", phase: "generate", ratio: 1.5 })).toBeNull();
  });

  it("returns null for garbage payloads", () => {
    expect(parseWorkerToMain(null)).toBeNull();
    expect(parseWorkerToMain("graph")).toBeNull();
    expect(parseWorkerToMain({ type: "graph", n: 1 })).toBeNull();
    expect(parseWorkerToMain({ type: "chunk", chunk: { count: 0 } })).toBeNull();
    expect(parseWorkerToMain({ type: "error" })).toBeNull();
    expect(parseWorkerToMain({ type: "unknown" })).toBeNull();
  });

  it("accepts graph with optional BMSSP k and t", () => {
    const graphMessage = { ...sampleGraphMessage(), k: 4, t: 2 };
    expect(parseWorkerToMain(graphMessage)).toEqual(graphMessage);
  });

  it("accepts graph without k or t", () => {
    const graphMessage = sampleGraphMessage();
    const parsed = parseWorkerToMain(graphMessage);
    expect(parsed).toEqual(graphMessage);
    if (parsed?.type === "graph") {
      expect("k" in parsed).toBe(false);
      expect("t" in parsed).toBe(false);
    }
  });

  it("rejects invalid k on graph messages", () => {
    const base = sampleGraphMessage();
    expect(parseWorkerToMain({ ...base, k: 0 })).toBeNull();
    expect(parseWorkerToMain({ ...base, k: 1.5 })).toBeNull();
    expect(parseWorkerToMain({ ...base, k: "4" })).toBeNull();
  });

  it("rejects invalid t on graph messages", () => {
    const base = sampleGraphMessage();
    expect(parseWorkerToMain({ ...base, t: 0 })).toBeNull();
    expect(parseWorkerToMain({ ...base, t: 2.5 })).toBeNull();
    expect(parseWorkerToMain({ ...base, t: "3" })).toBeNull();
  });

  it("rejects a half pair of k and t", () => {
    const base = sampleGraphMessage();
    expect(parseWorkerToMain({ ...base, k: 4 })).toBeNull();
    expect(parseWorkerToMain({ ...base, t: 2 })).toBeNull();
  });
});

describe("graphFromTraceMessage", () => {
  it("copies typed-array fields through by reference", () => {
    const message = sampleGraphMessage();
    const graph = graphFromTraceMessage(message);

    expect(graph.n).toBe(message.n);
    expect(graph.m).toBe(message.m);
    expect(graph.offsets).toBe(message.offsets);
    expect(graph.targets).toBe(message.targets);
    expect(graph.weights).toBe(message.weights);
    expect(graph.x).toBe(message.x);
    expect(graph.y).toBe(message.y);
  });

  it("omits BMSSP k and t from the Graph view", () => {
    const message = { ...sampleGraphMessage(), k: 3, t: 2 };
    const graph = graphFromTraceMessage(message);

    expect(graph).toEqual({
      n: message.n,
      m: message.m,
      offsets: message.offsets,
      targets: message.targets,
      weights: message.weights,
      x: message.x,
      y: message.y,
    });
    expect("k" in graph).toBe(false);
    expect("t" in graph).toBe(false);
  });
});

describe("isTraceChunk", () => {
  it("narrows a valid trace slab", () => {
    const chunk = allocateChunk(2);
    expect(isTraceChunk(chunk)).toBe(true);
  });

  it("rejects invalid chunk shapes", () => {
    expect(isTraceChunk(null)).toBe(false);
    expect(isTraceChunk({ count: 0 })).toBe(false);
  });
});
