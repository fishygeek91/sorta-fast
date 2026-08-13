import { describe, expect, it } from "vitest";

import { paperBmsspParams } from "../src/core/bmssp/params.ts";
import { type Graph } from "../src/core/graph.ts";
import { type TraceChunk, tally } from "../src/core/trace.ts";
import { Playback } from "../src/harness/playback.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";
import { runBmsspTraceJob, type BmsspTraceSpec } from "../src/workers/bmsspTraceJob.ts";

/** Collected output from one {@link runBmsspTraceJob} invocation. */
type JobResult = {
  graph: Graph;
  chunks: TraceChunk[];
  onGraphCalls: number;
  onChunkCalls: number;
};

/** Small maze spec accepted by {@link generateGraph} with enough events for streaming tests. */
const SMALL_MAZE_SPEC: BmsspTraceSpec = {
  kind: "maze",
  n: 40,
  seed: 42,
  source: 0,
};

/**
 * Run the job and record sink callbacks plus emitted chunks.
 *
 * @param spec - BMSSP trace job parameters.
 * @returns Graph, chunks, and callback invocation counts.
 * @throws When `onGraph` was never called.
 */
function runJob(spec: BmsspTraceSpec): JobResult {
  let graph: Graph | undefined;
  const chunks: TraceChunk[] = [];
  let onGraphCalls = 0;
  let onChunkCalls = 0;

  runBmsspTraceJob(spec, {
    onGraph: (received) => {
      onGraphCalls += 1;
      graph = received;
    },
    onChunk: (chunk) => {
      onChunkCalls += 1;
      chunks.push(chunk);
    },
  });

  if (graph === undefined) {
    throw new Error("onGraph was not called");
  }

  return { graph, chunks, onGraphCalls, onChunkCalls };
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

/**
 * Prefix views of the kind / vertex / edge / cost columns for `count` rows.
 *
 * @param chunk - One trace slab from the job stream.
 */
function chunkColumnPrefix(chunk: TraceChunk): {
  kind: Uint8Array;
  vertex: Int32Array;
  edge: Int32Array;
  cost: Uint32Array;
} {
  const rowCount = chunk.count;
  return {
    kind: chunk.kind.subarray(0, rowCount),
    vertex: chunk.vertex.subarray(0, rowCount),
    edge: chunk.edge.subarray(0, rowCount),
    cost: chunk.cost.subarray(0, rowCount),
  };
}

describe("runBmsspTraceJob small maze", () => {
  it("calls onGraph once, onChunk at least once, and emits recurse events", () => {
    const { graph, chunks, onGraphCalls, onChunkCalls } = runJob(SMALL_MAZE_SPEC);

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
  });
});

describe("runBmsspTraceJob streaming chunks", () => {
  it("drainCompleted emits multiple onChunk calls before the job returns", () => {
    let onChunkCalls = 0;
    const spec: BmsspTraceSpec = { ...SMALL_MAZE_SPEC, chunkCapacity: 8 };

    runBmsspTraceJob(spec, {
      onGraph: () => {},
      onChunk: () => {
        onChunkCalls += 1;
      },
    });

    expect(onChunkCalls).toBeGreaterThan(1);
  });
});

describe("runBmsspTraceJob determinism", () => {
  it("identical spec yields identical chunk column bytes and end counters", () => {
    const first = runJob(SMALL_MAZE_SPEC);
    const second = runJob(SMALL_MAZE_SPEC);

    expect(first.chunks.length).toBe(second.chunks.length);
    for (let index = 0; index < first.chunks.length; index += 1) {
      const firstChunk = first.chunks[index];
      const secondChunk = second.chunks[index];
      if (firstChunk === undefined || secondChunk === undefined) {
        throw new Error(`missing chunk at index ${String(index)}`);
      }
      expect(firstChunk.count).toBe(secondChunk.count);
      expect(chunkColumnPrefix(firstChunk)).toEqual(chunkColumnPrefix(secondChunk));
    }

    expect(sumChunkTallies(first.chunks)).toEqual(sumChunkTallies(second.chunks));
  });
});

describe("runBmsspTraceJob validation", () => {
  it("throws when source is out of range", () => {
    expect(() =>
      runBmsspTraceJob(
        { kind: "maze", n: 40, seed: 42, source: 40 },
        { onGraph: () => {}, onChunk: () => {} },
      ),
    ).toThrow(/source must be an integer in \[0, n\)/);
  });
});

describe("runBmsspTraceJob k/t overrides", () => {
  it("different k on the same graph changes billed work", () => {
    const paperT = paperBmsspParams(40).t;
    const lowK = runJob({ ...SMALL_MAZE_SPEC, k: 2, t: paperT });
    const highK = runJob({ ...SMALL_MAZE_SPEC, k: 8, t: paperT });

    const lowWork = sumChunkTallies(lowK.chunks).work;
    const highWork = sumChunkTallies(highK.chunks).work;
    expect(lowWork).not.toBe(highWork);
  });

  it("paper mode bills different work than demo defaults on the same maze", () => {
    const demo = runJob(SMALL_MAZE_SPEC);
    const paper = runJob({ ...SMALL_MAZE_SPEC, mode: "paper" });

    expect(sumChunkTallies(demo.chunks).work).not.toBe(sumChunkTallies(paper.chunks).work);
  });
});
