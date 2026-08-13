import { describe, expect, it } from "vitest";

import { type Graph } from "../src/core/graph.ts";
import { type TraceChunk } from "../src/core/trace.ts";
import { RaceScheduler } from "../src/harness/raceScheduler.ts";
import { storyNominalSeconds, type StoryLaneTotals } from "../src/ui/storyDrive.ts";
import { runTraceJob, type TraceJobSpec } from "../src/workers/traceJob.ts";

/** Pedagogical preset for story-mode nominal duration (#19). */
const STORY_TRACE_SPEC: TraceJobSpec = {
  kind: "city",
  n: 500,
  seed: 1729,
  source: 0,
};

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
 * Build lane totals from completed dijkstra and bmssp traces.
 *
 * @param dijkstra - Lane 0 chunks and graph.
 * @param bmssp - Lane 1 chunks (graph must match lane 0).
 */
function totalsFromTraces(
  dijkstra: { graph: Graph; chunks: TraceChunk[] },
  bmssp: { graph: Graph; chunks: TraceChunk[] },
): StoryLaneTotals {
  const race = new RaceScheduler(dijkstra.graph, 2);
  for (const chunk of dijkstra.chunks) {
    race.appendChunk(0, chunk);
  }
  for (const chunk of bmssp.chunks) {
    race.appendChunk(1, chunk);
  }
  race.markLaneComplete(0);
  race.markLaneComplete(1);
  return {
    dijkstraWork: race.laneTotalWork(0),
    bmsspWork: race.laneTotalWork(1),
  };
}

describe("storyNominalSeconds — pedagogical seed", () => {
  it("nominal tour duration is about 90 seconds on city/500/1729", () => {
    const dijkstra = collectTraceJob("dijkstra", STORY_TRACE_SPEC);
    const bmssp = collectTraceJob("bmssp", STORY_TRACE_SPEC);
    const totals = totalsFromTraces(dijkstra, bmssp);
    const seconds = storyNominalSeconds(totals);

    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(60);
    expect(seconds).toBeLessThanOrEqual(120);
  });
});
