import { describe, expect, it } from "vitest";

import { degreeReduce } from "../src/core/dmsy/degreeReduce.ts";
import { dmsyParams, paperDmsyParams, run, type DmsyParams } from "../src/core/dmsy/dmsy.ts";
import { type Graph } from "../src/core/graph.ts";
import { scanCosts, type TraceChunk, tally } from "../src/core/trace.ts";
import { Playback } from "../src/harness/playback.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";
import {
  resolveDmsyTraceParams,
  runDmsyTraceJob,
  type DmsyTraceSpec,
} from "../src/workers/dmsyTraceJob.ts";

/** Collected output from one {@link runDmsyTraceJob} invocation. */
type JobResult = {
  graph: Graph;
  params: DmsyParams;
  chunks: TraceChunk[];
  onGraphCalls: number;
  onChunkCalls: number;
};

/** Small maze spec accepted by {@link generateGraph} with enough events for streaming tests. */
const SMALL_MAZE_SPEC: DmsyTraceSpec = {
  kind: "maze",
  n: 40,
  seed: 42,
  source: 0,
};

/**
 * Drain {@link run} to the final distance array for comparison with trace playback.
 *
 * @param graph - CSR graph.
 * @param source - SSSP source.
 * @param params - Resolved DMSY parameters.
 */
function drainDmsyDistances(graph: Graph, source: number, params: DmsyParams): Float64Array {
  const gen = run(graph, source, params);
  let step = gen.next();
  while (!step.done) {
    step = gen.next();
  }
  return step.value.distances;
}

/**
 * Run the job and record sink callbacks plus emitted chunks.
 *
 * @param spec - DMSY trace job parameters.
 * @returns Graph, resolved DMSY params, chunks, and callback invocation counts.
 * @throws When `onGraph` was never called.
 */
function runJob(spec: DmsyTraceSpec): JobResult {
  let graph: Graph | undefined;
  let params: DmsyParams | undefined;
  const chunks: TraceChunk[] = [];
  let onGraphCalls = 0;
  let onChunkCalls = 0;

  runDmsyTraceJob(spec, {
    onGraph: (received, receivedParams) => {
      onGraphCalls += 1;
      graph = received;
      params = receivedParams;
    },
    onChunk: (chunk) => {
      onChunkCalls += 1;
      chunks.push(chunk);
    },
  });

  if (graph === undefined || params === undefined) {
    throw new Error("onGraph was not called");
  }

  return { graph, params, chunks, onGraphCalls, onChunkCalls };
}

/**
 * Sum headline counters across all chunks via {@link tally}.
 *
 * @param chunks - Completed trace slabs from the job.
 */
function sumChunkTallies(chunks: readonly TraceChunk[]): {
  work: number;
  relaxations: number;
  heapOps: number;
  recurses: number;
} {
  let work = 0;
  let relaxations = 0;
  let heapOps = 0;
  let recurses = 0;
  for (const chunk of chunks) {
    const row = tally(chunk);
    work += row.work;
    relaxations += row.relaxations;
    heapOps += row.heapOps;
    recurses += row.recurses;
  }
  return { work, relaxations, heapOps, recurses };
}

describe("runDmsyTraceJob small maze", () => {
  it("calls onGraph once, onChunk at least once, and emits recurse events", () => {
    const { graph, params, chunks, onGraphCalls, onChunkCalls } = runJob(SMALL_MAZE_SPEC);

    expect(onGraphCalls).toBe(1);
    expect(onChunkCalls).toBeGreaterThanOrEqual(1);

    const totals = sumChunkTallies(chunks);
    expect(totals.recurses).toBeGreaterThan(0);

    const buffer = new TraceBuffer(graph, chunks);
    buffer.seekWork(buffer.totalWork);
    expect(buffer.totalWork).toBeGreaterThan(0);
    expect(buffer.state.work).toBeGreaterThan(0);

    const playback = new Playback(graph, chunks);
    playback.seek(playback.totalWork);
    expect(playback.totalWork).toBeGreaterThan(0);
    expect(playback.state.work).toBeGreaterThan(0);

    const expectedDistances = drainDmsyDistances(graph, SMALL_MAZE_SPEC.source, params);
    expect(playback.state.dist).toEqual(expectedDistances);
  });
});

describe("runDmsyTraceJob streaming chunks", () => {
  it("drainCompleted emits multiple onChunk calls before the job returns", () => {
    let onChunkCalls = 0;
    const spec: DmsyTraceSpec = { ...SMALL_MAZE_SPEC, chunkCapacity: 8 };

    runDmsyTraceJob(spec, {
      onGraph: () => {},
      onChunk: () => {
        onChunkCalls += 1;
      },
    });

    expect(onChunkCalls).toBeGreaterThan(1);
  });
});

describe("runDmsyTraceJob validation", () => {
  it("throws when source is out of range", () => {
    expect(() =>
      runDmsyTraceJob(
        { kind: "maze", n: 40, seed: 42, source: 40 },
        { onGraph: () => {}, onChunk: () => {} },
      ),
    ).toThrow(/source must be an integer in \[0, n\)/);
  });
});

describe("runDmsyTraceJob resolved params echo", () => {
  it("default spec echoes demo dmsyParams(graph.n, { mode: demo, delta }) and preserves n", () => {
    const { graph, params } = runJob(SMALL_MAZE_SPEC);
    const delta = degreeReduce(graph).delta ?? 3;

    expect(graph.n).toBe(SMALL_MAZE_SPEC.n);
    expect(params).toEqual(dmsyParams(graph.n, { mode: "demo", delta }));
    expect(params).toEqual(resolveDmsyTraceParams(graph));
  });

  it("paper mode echoes paperDmsyParams(graph.n, delta) with degreeReduce delta", () => {
    const { graph, params } = runJob({ ...SMALL_MAZE_SPEC, mode: "paper" });
    const delta = degreeReduce(graph).delta ?? 3;

    expect(params).toEqual(paperDmsyParams(graph.n, delta));
    expect(params).toEqual(resolveDmsyTraceParams(graph, undefined, undefined, "paper"));
  });

  it("k/t overrides echo resolveDmsyTraceParams(graph, k, t) on demo defaults", () => {
    const { graph, params } = runJob({ ...SMALL_MAZE_SPEC, k: 8, t: 3 });

    expect(params).toEqual(resolveDmsyTraceParams(graph, 8, 3));
  });
});

describe("runDmsyTraceJob demo vs paper mode", () => {
  it("paper mode bills different work than demo defaults on the same maze", () => {
    const demo = runJob(SMALL_MAZE_SPEC);
    const paper = runJob({ ...SMALL_MAZE_SPEC, mode: "paper" });

    expect(demo.params.k).toBe(6);
    expect(paper.params.k).toBe(2);
    expect(demo.params.k).not.toBe(paper.params.k);

    const demoWork = sumChunkTallies(demo.chunks).work;
    const paperWork = sumChunkTallies(paper.chunks).work;
    if (demo.params.k !== paper.params.k) {
      expect(demoWork).not.toBe(paperWork);
    }

    let scanDemoWork = 0;
    let scanPaperWork = 0;
    for (const chunk of demo.chunks) {
      scanDemoWork += scanCosts(chunk).work;
    }
    for (const chunk of paper.chunks) {
      scanPaperWork += scanCosts(chunk).work;
    }
    if (demo.params.k !== paper.params.k) {
      expect(scanDemoWork).not.toBe(scanPaperWork);
    }
  });
});
