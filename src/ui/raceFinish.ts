/**
 * Pure race finish-vertex resolution from URL target and graph layout (issue #14).
 */

import { isBfsReachable, pickFinishVertex, type Graph } from "../core/graph.ts";

/** Result of resolving the race photo-finish vertex. */
export type RaceFinishResolution = {
  finish: number | null;
  /** User-facing status; null when nothing to show. */
  status: string | null;
};

/**
 * Auto-pick a finish vertex and attach a caller-supplied status on success.
 *
 * @param graph - CSR graph with layout coordinates.
 * @param source - SSSP source vertex.
 * @param status - Warning shown when auto-pick succeeds.
 */
function autoPick(graph: Graph, source: number, status: string): RaceFinishResolution {
  try {
    return { finish: pickFinishVertex(graph, source), status };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { finish: null, status: detail };
  }
}

/**
 * Resolve the race photo-finish vertex from an optional URL target.
 *
 * @param graph - Streamed CSR graph for the race.
 * @param source - SSSP source vertex.
 * @param target - URL finish target; `null` defers to {@link pickFinishVertex}.
 */
export function resolveRaceFinishVertex(
  graph: Graph,
  source: number,
  target: number | null,
): RaceFinishResolution {
  if (target === null) {
    try {
      return { finish: pickFinishVertex(graph, source), status: null };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { finish: null, status: detail };
    }
  }

  if (target === source) {
    return autoPick(graph, source, `target ${target} is the source; using auto-pick`);
  }

  if (target < 0 || target >= graph.n) {
    return autoPick(graph, source, `target ${target} is out of range; using auto-pick`);
  }

  if (!isBfsReachable(graph, source, target)) {
    return { finish: target, status: `target ${target} unreachable from source` };
  }

  return { finish: target, status: null };
}
