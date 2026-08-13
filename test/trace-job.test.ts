import { describe, expect, it } from "vitest";

import { type Graph } from "../src/core/graph.ts";
import { runTraceJob, type TraceJobSpec } from "../src/workers/traceJob.ts";

/** Shared maze spec — both algorithms use the same {@link generateGraph} inputs. */
const SHARED_SPEC: TraceJobSpec = {
  kind: "maze",
  n: 40,
  seed: 42,
  source: 0,
};

/**
 * Run the dispatcher and capture the emitted graph.
 *
 * @param algo - Lane algorithm selector.
 * @param spec - Trace job parameters.
 * @returns CSR graph from `onGraph`.
 * @throws When `onGraph` was never called.
 */
function captureGraph(algo: "dijkstra" | "bmssp", spec: TraceJobSpec): Graph {
  let graph: Graph | undefined;

  runTraceJob(algo, spec, {
    onGraph: (received) => {
      graph = received;
    },
    onChunk: () => {},
  });

  if (graph === undefined) {
    throw new Error("onGraph was not called");
  }

  return graph;
}

describe("runTraceJob graph identity", () => {
  it("dijkstra and bmssp emit the same n, m, offsets, and targets for identical spec", () => {
    const dijkstraGraph = captureGraph("dijkstra", SHARED_SPEC);
    const bmsspGraph = captureGraph("bmssp", SHARED_SPEC);

    expect(dijkstraGraph.n).toBe(bmsspGraph.n);
    expect(dijkstraGraph.m).toBe(bmsspGraph.m);
    expect(dijkstraGraph.offsets).toEqual(bmsspGraph.offsets);
    expect(dijkstraGraph.targets).toEqual(bmsspGraph.targets);
  });
});
