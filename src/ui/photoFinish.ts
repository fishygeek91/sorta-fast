/**
 * Pure photo-finish helpers for race mode (issue #14).
 *
 * No DOM, no trace imports, no algorithm code — reads {@link LaneState} only.
 */

import { LaneState, UNSETTLED } from "../harness/laneState.ts";

/**
 * Format billed work as an en-US integer with thousands separators.
 *
 * @param work - Billed work counter (fractional ops are floored).
 * @returns Decimal string, e.g. `17133` → `"17,133"`.
 */
function formatWork(work: number): string {
  return Math.floor(work).toLocaleString("en-US");
}

/**
 * Whether a lane has frozen on the photo-finish vertex.
 *
 * @param state - Lane playback snapshot.
 * @param finish - Candidate finish vertex id.
 * @returns `true` iff `finish` is an integer in `[0, n)` and
 *   `settleOrder[finish] !== UNSETTLED`.
 */
export function isLaneFrozen(state: LaneState, finish: number): boolean {
  if (!Number.isInteger(finish) || finish < 0 || finish >= state.n) {
    return false;
  }
  return state.settleOrder[finish] !== UNSETTLED;
}

/**
 * Walk the shortest-path predecessor chain from finish toward the source.
 *
 * Vertices are returned from finish back to source (finish first, source last).
 * If `finish` is unsettled, returns `[]`. If `pred` is unsettled at the current
 * vertex, that vertex is included and the walk stops (the source). Detects cycles
 * and throws if the walk would exceed `n + 1` vertices.
 *
 * @param state - Lane playback snapshot.
 * @param finish - Finish vertex to walk from.
 * @returns Vertex ids on the gold path, or `[]` when finish is unsettled.
 * @throws If a cycle is detected in the predecessor chain.
 */
export function walkGoldPath(state: LaneState, finish: number): number[] {
  if (!Number.isInteger(finish) || finish < 0 || finish >= state.n) {
    return [];
  }
  if (state.settleOrder[finish] === UNSETTLED) {
    return [];
  }

  const path: number[] = [];
  const seen = new Set<number>();
  let vertex = finish;

  while (path.length <= state.n) {
    if (seen.has(vertex)) {
      throw new Error(`cycle in predecessor chain at vertex ${String(vertex)}`);
    }
    seen.add(vertex);
    path.push(vertex);

    const parent = state.pred[vertex];
    if (parent === UNSETTLED) {
      break;
    }
    vertex = parent;
  }

  if (path.length > state.n + 1) {
    throw new Error(`predecessor chain exceeded n+1 vertices from finish ${String(finish)}`);
  }

  return path;
}

/**
 * Lane row for {@link formatRaceBanner}.
 */
export type RaceBannerLane = {
  /** Display label, e.g. `"Dijkstra"` or `"BMSSP '25"`. */
  label: string;
  /** Billed work on the shared race clock. */
  work: number;
};

/**
 * Rank lanes by billed work; ties keep array order (first entry wins).
 *
 * @param lanes - Lane rows in UI order.
 * @returns Indices sorted by `(work, original index)`.
 */
function rankLaneIndices(lanes: readonly RaceBannerLane[]): number[] {
  const indices = lanes.map((_, index) => index);
  indices.sort((a, b) => {
    const workA = Math.floor(lanes[a].work);
    const workB = Math.floor(lanes[b].work);
    if (workA !== workB) {
      return workA - workB;
    }
    return a - b;
  });
  return indices;
}

/**
 * Format the race photo-finish banner with winner margin and per-lane totals.
 *
 * Winner is the lane with lowest {@link Math.floor} work; ties favor the first
 * lane in `lanes`. The headline compares winner vs second-place work; the suffix
 * lists every lane total in input order.
 *
 * Two-lane example:
 * `"BMSSP beat Dijkstra by 17,133 comparisons on this graph. (Dijkstra: 48,210; BMSSP: 31,077)"`
 *
 * @param lanes - Two or three lane labels and work totals.
 * @returns Banner text for the photo-finish overlay.
 * @throws If fewer than two lanes are provided.
 */
export function formatRaceBanner(lanes: readonly RaceBannerLane[]): string {
  if (lanes.length < 2) {
    throw new Error("formatRaceBanner requires at least two lanes");
  }

  const ranked = rankLaneIndices(lanes);
  const winnerIndex = ranked[0];
  const secondIndex = ranked[1];
  const winner = lanes[winnerIndex];
  const second = lanes[secondIndex];

  const winnerWork = Math.floor(winner.work);
  const secondWork = Math.floor(second.work);
  const delta = secondWork - winnerWork;

  const headline = `${winner.label} beat ${second.label} by ${formatWork(delta)} comparisons on this graph.`;
  const totals = lanes.map((lane) => `${lane.label}: ${formatWork(lane.work)}`).join("; ");

  return `${headline} (${totals})`;
}

/**
 * Counter bundle for a single race lane panel.
 */
export type RaceLaneCounters = {
  /** Total billed comparisons ({@link Math.floor} of lane work). */
  comparisons: number;
  /** Heap trace events applied. */
  heapOps: number;
  /** D-structure trace events applied. */
  dstructOps: number;
  /** Relax trace events applied. */
  relaxations: number;
  /** Settles where dist was below prior max settled dist. */
  outOfOrderSettles: number;
  /** Vertices with a settle order assigned. */
  settledCount: number;
  /** Vertex count for the lane graph. */
  n: number;
};

/**
 * Snapshot live race counters from lane playback state.
 *
 * @param state - Lane playback snapshot.
 * @returns Scalar counters for the race lane UI.
 */
export function raceCountersFromLane(state: LaneState): RaceLaneCounters {
  return {
    comparisons: Math.floor(state.work),
    heapOps: state.heapOps,
    dstructOps: state.dstructOps,
    relaxations: state.relaxations,
    outOfOrderSettles: state.outOfOrderSettles,
    settledCount: state.settledCount,
    n: state.n,
  };
}
