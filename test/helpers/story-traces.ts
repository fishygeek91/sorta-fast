/**
 * Shared story-test trace helpers (PR #57 nit, issue #60).
 *
 * Drains trace jobs and derives lane totals so `story-drive` and `story-pace`
 * tests do not duplicate the same collect/drain logic.
 */

import { type Graph } from "../../src/core/graph.ts";
import { type TraceChunk } from "../../src/core/trace.ts";
import { RaceScheduler } from "../../src/harness/raceScheduler.ts";
import { type StoryLaneTotals } from "../../src/ui/storyDrive.ts";
import { runTraceJob, type TraceJobSpec } from "../../src/workers/traceJob.ts";

/**
 * Run a trace job and collect the emitted graph and chunks in order.
 *
 * @param algo - Lane algorithm selector.
 * @param spec - Trace job parameters.
 * @returns CSR graph and trace slabs from `onGraph` / `onChunk`.
 * @throws When `onGraph` was never called.
 */
export function collectTraceJob(
  algo: "dijkstra" | "bmssp" | "dmsy",
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
 * Build three-lane billed totals from completed traces.
 *
 * @param dijkstra - Lane 0 chunks and graph.
 * @param bmssp - Lane 1 chunks (graph must match lane 0).
 * @param dmsy - Lane 2 chunks (graph must match lane 0).
 */
export function totalsFromTraces(
  dijkstra: { graph: Graph; chunks: TraceChunk[] },
  bmssp: { graph: Graph; chunks: TraceChunk[] },
  dmsy: { graph: Graph; chunks: TraceChunk[] },
): StoryLaneTotals {
  const race = new RaceScheduler(dijkstra.graph, 3);
  for (const chunk of dijkstra.chunks) {
    race.appendChunk(0, chunk);
  }
  for (const chunk of bmssp.chunks) {
    race.appendChunk(1, chunk);
  }
  for (const chunk of dmsy.chunks) {
    race.appendChunk(2, chunk);
  }
  race.markLaneComplete(0);
  race.markLaneComplete(1);
  race.markLaneComplete(2);
  return {
    dijkstraWork: race.laneTotalWork(0),
    bmsspWork: race.laneTotalWork(1),
    dmsyWork: race.laneTotalWork(2),
  };
}
