import { describe, expect, it } from "vitest";

import { type Graph } from "../src/core/graph.ts";
import { type TraceChunk, tally } from "../src/core/trace.ts";
import { RaceScheduler } from "../src/harness/raceScheduler.ts";
import { raceCountersFromLane } from "../src/ui/photoFinish.ts";
import { parseRaceUrl, serializeRaceUrl } from "../src/ui/raceUrl.ts";
import { runTraceJob, type TraceJobSpec } from "../src/workers/traceJob.ts";

/** Parsed maze race URL used for reproducibility checks (#15). */
const MAZE_RACE_QUERY = "?g=maze&n=40&seed=42&race=dijkstra,bmssp";

/** Parsed adversarial S preset for reproducibility checks (#20). */
const ADVERSARIAL_S_RACE_QUERY = "?g=adversarial&n=500&seed=42&race=dijkstra,bmssp";

/**
 * Run a trace job and collect the emitted graph and chunks in order.
 *
 * @param algo - Lane algorithm selector.
 * @param spec - Trace job parameters.
 * @returns CSR graph and trace slabs from `onGraph` / `onChunk`.
 * @throws When `onGraph` was never called.
 */
function collectTraceJob(
  algo: "dijkstra" | "bmssp",
  spec: TraceJobSpec,
): { graph: Graph; chunks: TraceChunk[] } {
  let graph: Graph | undefined;
  const chunks: TraceChunk[] = [];

  runTraceJob(algo, spec, {
    onGraph: (received) => {
      graph = received;
    },
    onChunk: (chunk) => {
      chunks.push(chunk);
    },
  });

  if (graph === undefined) {
    throw new Error("onGraph was not called");
  }

  return { graph, chunks };
}

/**
 * Load a paused two-lane scheduler with full dijkstra/bmssp traces marked complete.
 *
 * @param dijkstra - Lane 0 chunks and graph.
 * @param bmssp - Lane 1 chunks (graph must match lane 0).
 * @returns Scheduler with both lanes complete.
 */
function loadCompleteTwoLaneRace(
  dijkstra: { graph: Graph; chunks: TraceChunk[] },
  bmssp: { graph: Graph; chunks: TraceChunk[] },
): RaceScheduler {
  const race = new RaceScheduler(dijkstra.graph, 2);
  for (const chunk of dijkstra.chunks) {
    race.appendChunk(0, chunk);
  }
  for (const chunk of bmssp.chunks) {
    race.appendChunk(1, chunk);
  }
  race.markLaneComplete(0);
  race.markLaneComplete(1);
  return race;
}

/**
 * Prefix views of trace column bytes for `count` rows in one slab.
 *
 * @param chunk - One trace slab from a trace job stream.
 * @returns Column subarrays covering only populated rows.
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

/**
 * Sum billed work across all trace slabs via {@link tally}.
 *
 * @param chunks - Completed trace slabs from a trace job.
 * @returns Total billed ops recorded in chunk tallies.
 */
function totalWorkFromChunks(chunks: readonly TraceChunk[]): number {
  let work = 0;
  for (const chunk of chunks) {
    work += tally(chunk).work;
  }
  return work;
}

/**
 * Assert two trace job runs are byte-identical on graph CSR and chunk columns.
 *
 * @param first - First collected trace job output.
 * @param second - Second collected trace job output with the same spec.
 */
function expectIdenticalTraceJobs(
  first: { graph: Graph; chunks: TraceChunk[] },
  second: { graph: Graph; chunks: TraceChunk[] },
): void {
  expect(first.graph.offsets).toEqual(second.graph.offsets);
  expect(first.graph.targets).toEqual(second.graph.targets);
  expect(first.graph.weights).toEqual(second.graph.weights);

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

  expect(totalWorkFromChunks(first.chunks)).toBe(totalWorkFromChunks(second.chunks));
}

/**
 * Build a {@link TraceJobSpec} from parsed race URL state (source fixed at 0).
 *
 * @param search - Race URL query string.
 * @returns Trace job parameters derived from URL graph fields.
 */
function traceSpecFromRaceUrl(search: string): TraceJobSpec {
  const state = parseRaceUrl(search);
  const spec: TraceJobSpec = {
    kind: state.g,
    n: state.n,
    seed: state.seed,
    source: 0,
    mode: state.bmssp,
  };
  if (state.bk !== null) {
    spec.k = state.bk;
  }
  if (state.bt !== null) {
    spec.t = state.bt;
  }
  return spec;
}

describe("race URL reproducibility — trace jobs from parsed URL", () => {
  const spec = traceSpecFromRaceUrl(MAZE_RACE_QUERY);

  it("identical URL params yield byte-identical dijkstra trace jobs", () => {
    const first = collectTraceJob("dijkstra", spec);
    const second = collectTraceJob("dijkstra", spec);
    expectIdenticalTraceJobs(first, second);
  });

  it("identical URL params yield byte-identical bmssp trace jobs", () => {
    const first = collectTraceJob("bmssp", spec);
    const second = collectTraceJob("bmssp", spec);
    expectIdenticalTraceJobs(first, second);
  });
});

describe("race URL reproducibility — adversarial at S", () => {
  const spec = traceSpecFromRaceUrl(ADVERSARIAL_S_RACE_QUERY);

  it("identical URL params yield byte-identical dijkstra trace jobs", () => {
    const first = collectTraceJob("dijkstra", spec);
    const second = collectTraceJob("dijkstra", spec);
    expectIdenticalTraceJobs(first, second);
  });

  it("identical URL params yield byte-identical bmssp trace jobs", () => {
    const first = collectTraceJob("bmssp", spec);
    const second = collectTraceJob("bmssp", spec);
    expectIdenticalTraceJobs(first, second);
  });
});

describe("race URL reproducibility — seek to parsed t", () => {
  const spec = traceSpecFromRaceUrl(MAZE_RACE_QUERY);
  const dijkstra = collectTraceJob("dijkstra", spec);
  const bmssp = collectTraceJob("bmssp", spec);

  it("parsed mid-trace t seeks two-lane race to appliedCursor", () => {
    const race = loadCompleteTwoLaneRace(dijkstra, bmssp);
    const midT = Math.floor(race.maxTotalWork / 2);

    const query = serializeRaceUrl({
      g: "maze",
      n: 40,
      seed: 42,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp"],
      t: midT,
      bmssp: "demo",
      bk: null,
      bt: null,
    });
    const parsed = parseRaceUrl(query);

    expect(parsed.t).toBe(midT);
    race.seek(parsed.t);
    expect(race.appliedCursor).toBe(parsed.t);
  });

  it("seek past end clamps appliedCursor to maxTotalWork when all lanes complete", () => {
    const race = loadCompleteTwoLaneRace(dijkstra, bmssp);
    const parsed = parseRaceUrl(`${MAZE_RACE_QUERY}&t=999999999`);

    race.seek(parsed.t);
    expect(race.appliedCursor).toBe(race.maxTotalWork);
  });

  it("scrub identity: same t yields identical lane counters", () => {
    const race = loadCompleteTwoLaneRace(dijkstra, bmssp);
    const midT = Math.floor(race.maxTotalWork / 2);

    race.seek(midT);
    const first = raceCountersFromLane(race.laneState(0));
    expect(Number.isFinite(first.comparisons)).toBe(true);
    expect(first.comparisons).toBeGreaterThan(0);
    expect(first.comparisons).toBeLessThanOrEqual(midT);

    race.seek(0);
    race.seek(midT);
    const second = raceCountersFromLane(race.laneState(0));

    expect(second.comparisons).toBe(first.comparisons);
    expect(second.settledCount).toBe(first.settledCount);
    expect(second.heapOps).toBe(first.heapOps);
    expect(second.relaxations).toBe(first.relaxations);
  });
});
