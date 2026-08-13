/**
 * Race lane configuration derived from URL query params (issue #14, #15).
 *
 * Pure helpers — no DOM. Lane list comes from `race=` (or legacy `lane3=dijkstra`)
 * via {@link parseRaceUrl}; see design.md §3.5.
 */

import { parseRaceUrl } from "./raceUrl.ts";

/**
 * Per-lane display and algorithm binding for the multi-lane race UI.
 */
export type RaceLaneConfig = {
  algo: "dijkstra" | "bmssp";
  id: string;
  label: string;
  persona: "marble" | "ember" | "stub";
};

/** Running counts while mapping duplicate algo slugs to distinct lane ids. */
type RaceLaneCounts = {
  dijkstra: number;
  bmssp: number;
};

/**
 * Map one canonical race slug to a {@link RaceLaneConfig}, disambiguating duplicates.
 *
 * @param token - `dijkstra` or `bmssp` from the parsed race list.
 * @param counts - Mutable per-algo occurrence counts for id/label suffixing.
 */
function raceLaneFromToken(token: "dijkstra" | "bmssp", counts: RaceLaneCounts): RaceLaneConfig {
  if (token === "dijkstra") {
    if (counts.dijkstra === 0) {
      counts.dijkstra += 1;
      return { algo: "dijkstra", id: "dijkstra", label: "Dijkstra", persona: "marble" };
    }
    counts.dijkstra += 1;
    return { algo: "dijkstra", id: "dijkstra-b", label: "Dijkstra B", persona: "stub" };
  }
  if (counts.bmssp === 0) {
    counts.bmssp += 1;
    return { algo: "bmssp", id: "bmssp", label: "BMSSP '25", persona: "ember" };
  }
  counts.bmssp += 1;
  return { algo: "bmssp", id: "bmssp-b", label: "BMSSP B", persona: "ember" };
}

/**
 * Build the lane list for a race from URL search params.
 *
 * Derives lanes from {@link parseRaceUrl}: default two lanes (Dijkstra + BMSSP),
 * three when `race=` or legacy `lane3=dijkstra` requests a third slot.
 * `dmsy` tokens in `race=` are ignored until issue #27.
 *
 * @param search - Query string or parsed {@link URLSearchParams}.
 */
export function lanesFromSearch(search: string | URLSearchParams): RaceLaneConfig[] {
  const { race } = parseRaceUrl(search);
  const counts: RaceLaneCounts = { dijkstra: 0, bmssp: 0 };
  const lanes: RaceLaneConfig[] = [];
  for (const token of race) {
    lanes.push(raceLaneFromToken(token, counts));
  }
  return lanes;
}
