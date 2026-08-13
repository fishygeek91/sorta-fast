import { describe, expect, it } from "vitest";

import { type Graph, pickFinishVertex } from "../src/core/graph.ts";
import { type TraceChunk } from "../src/core/trace.ts";
import { RaceScheduler } from "../src/harness/raceScheduler.ts";
import { lanesFromSearch } from "../src/ui/raceLanes.ts";
import { formatRaceBanner, isLaneFrozen, raceCountersFromLane } from "../src/ui/photoFinish.ts";
import { runTraceJob, type TraceJobSpec } from "../src/workers/traceJob.ts";

/** Small maze for fast headless race acceptance (#14). */
const SHARED_SPEC: TraceJobSpec = {
  kind: "maze",
  n: 40,
  seed: 42,
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
 * Load a paused 2-lane scheduler with full dijkstra/bmssp traces marked complete.
 *
 * @param dijkstra - Lane 0 chunks and graph.
 * @param bmssp - Lane 1 chunks (graph must match lane 0).
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
 * Load a paused 3-lane scheduler: dijkstra, bmssp, duplicate dijkstra trace.
 *
 * @param dijkstra - Lane 0 and lane 2 chunks (same trace reused).
 * @param bmssp - Lane 1 chunks.
 */
function loadCompleteThreeLaneRace(
  dijkstra: { graph: Graph; chunks: TraceChunk[] },
  bmssp: { graph: Graph; chunks: TraceChunk[] },
): RaceScheduler {
  const race = new RaceScheduler(dijkstra.graph, 3);
  for (const chunk of dijkstra.chunks) {
    race.appendChunk(0, chunk);
    race.appendChunk(2, chunk);
  }
  for (const chunk of bmssp.chunks) {
    race.appendChunk(1, chunk);
  }
  race.markLaneComplete(0);
  race.markLaneComplete(1);
  race.markLaneComplete(2);
  return race;
}

/**
 * Set photo-finish vertex and seek to the end of the shared race clock.
 *
 * @param race - Loaded scheduler with all lanes complete.
 * @param graph - Shared CSR graph.
 * @param source - SSSP source vertex.
 * @returns Finish vertex chosen by {@link pickFinishVertex}.
 */
function seekCompleteWithPhotoFinish(race: RaceScheduler, graph: Graph, source: number): number {
  const finish = pickFinishVertex(graph, source);
  race.setFinishVertex(finish);
  race.seek(race.maxTotalWork);
  return finish;
}

describe("race UI acceptance — lanesFromSearch", () => {
  it("defaults to two lanes; lane3=dijkstra adds dijkstra-b stub", () => {
    expect(lanesFromSearch("")).toHaveLength(2);
    expect(lanesFromSearch("?lane3=1")).toHaveLength(2);

    const lanes = lanesFromSearch("?lane3=dijkstra");
    expect(lanes).toHaveLength(3);
    expect(lanes[0].algo).toBe("dijkstra");
    expect(lanes[0].id).toBe("dijkstra");
    expect(lanes[1].algo).toBe("bmssp");
    expect(lanes[1].id).toBe("bmssp");
    expect(lanes[2].algo).toBe("dijkstra");
    expect(lanes[2].id).toBe("dijkstra-b");
    expect(lanes[2].label).toBe("Dijkstra B");
  });
});

describe("race UI acceptance — 2-lane live counters from real traces", () => {
  const dijkstra = collectTraceJob("dijkstra", SHARED_SPEC);
  const bmssp = collectTraceJob("bmssp", SHARED_SPEC);

  it("raceCountersFromLane matches lane state; maze photo-freezes at finish", () => {
    const race = loadCompleteTwoLaneRace(dijkstra, bmssp);
    seekCompleteWithPhotoFinish(race, dijkstra.graph, SHARED_SPEC.source);

    for (let lane = 0; lane < 2; lane += 1) {
      const state = race.laneState(lane);
      const counters = raceCountersFromLane(state);

      expect(counters.comparisons).toBe(Math.floor(state.work));
      expect(counters.settledCount).toBeLessThanOrEqual(dijkstra.graph.n);
      expect(counters.n).toBe(dijkstra.graph.n);

      const progress = counters.settledCount / counters.n;
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }

    expect(race.allPhotoFrozen()).toBe(true);
  });
});

describe("race UI acceptance — 3-lane stub (dijkstra, bmssp, dijkstra)", () => {
  const dijkstra = collectTraceJob("dijkstra", SHARED_SPEC);
  const bmssp = collectTraceJob("bmssp", SHARED_SPEC);
  const laneConfigs = lanesFromSearch("?lane3=dijkstra");

  it("three lanes photo-freeze; banner lists all lane labels", () => {
    const race = loadCompleteThreeLaneRace(dijkstra, bmssp);
    seekCompleteWithPhotoFinish(race, dijkstra.graph, SHARED_SPEC.source);

    for (let lane = 0; lane < 3; lane += 1) {
      const counters = raceCountersFromLane(race.laneState(lane));
      expect(counters.n).toBe(dijkstra.graph.n);
      expect(counters.comparisons).toBeGreaterThan(0);
    }

    expect(race.allPhotoFrozen()).toBe(true);

    const banner = formatRaceBanner(
      laneConfigs.map((config, lane) => ({
        label: config.label,
        work: race.laneState(lane).work,
      })),
    );

    expect(banner).toContain("comparisons on this graph");
    expect(banner).toContain("Dijkstra");
    expect(banner).toContain("BMSSP '25");
    expect(banner).toContain("Dijkstra B");
  });
});

describe("race UI acceptance — complete race banner and rewind", () => {
  const dijkstra = collectTraceJob("dijkstra", SHARED_SPEC);
  const bmssp = collectTraceJob("bmssp", SHARED_SPEC);
  const labels = ["Dijkstra", "BMSSP '25"] as const;

  it("banner at end uses locked work; rewind clears photo-freeze", () => {
    const race = loadCompleteTwoLaneRace(dijkstra, bmssp);
    const finish = seekCompleteWithPhotoFinish(race, dijkstra.graph, SHARED_SPEC.source);

    expect(race.allPhotoFrozen()).toBe(true);

    const lockedWork0 = race.laneState(0).work;
    const lockedWork1 = race.laneState(1).work;

    const banner = formatRaceBanner([
      { label: labels[0], work: lockedWork0 },
      { label: labels[1], work: lockedWork1 },
    ]);

    expect(banner).toContain("beat");
    expect(banner).toContain("on this graph");
    expect(banner).toContain(labels[0]);
    expect(banner).toContain(labels[1]);

    race.seek(0);

    expect(race.allPhotoFrozen()).toBe(false);
    expect(isLaneFrozen(race.laneState(0), finish)).toBe(false);
    expect(isLaneFrozen(race.laneState(1), finish)).toBe(false);
  });
});

describe("race UI acceptance — Dijkstra out-of-order settles", () => {
  const dijkstra = collectTraceJob("dijkstra", SHARED_SPEC);
  const bmssp = collectTraceJob("bmssp", SHARED_SPEC);

  it("dijkstra lane reports zero out-of-order settles after full seek", () => {
    const race = loadCompleteTwoLaneRace(dijkstra, bmssp);
    seekCompleteWithPhotoFinish(race, dijkstra.graph, SHARED_SPEC.source);

    const counters = raceCountersFromLane(race.laneState(0));
    expect(counters.outOfOrderSettles).toBe(0);
  });
});
