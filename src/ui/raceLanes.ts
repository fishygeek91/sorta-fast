/**
 * Race lane configuration derived from URL query params (issue #14, #15).
 *
 * Pure helpers — no DOM. Lane list comes from `race=` (or `lane3=` flags)
 * via {@link parseRaceUrl}; see design.md §3.5.
 */

import { parseRaceUrl, type RaceAlgoSlug } from "./raceUrl.ts";

/**
 * Per-lane display and algorithm binding for the multi-lane race UI.
 */
export type RaceLaneConfig = {
  algo: "dijkstra" | "bmssp" | "dmsy";
  id: string;
  label: string;
  persona: "marble" | "ember" | "moss" | "stub";
};

/** Running counts while mapping duplicate algo slugs to distinct lane ids. */
type RaceLaneCounts = {
  dijkstra: number;
  bmssp: number;
  dmsy: number;
};

/**
 * Map one canonical race slug to a {@link RaceLaneConfig}, disambiguating duplicates.
 *
 * @param token - `dijkstra`, `bmssp`, or `dmsy` from the parsed race list.
 * @param counts - Mutable per-algo occurrence counts for id/label suffixing.
 */
function raceLaneFromToken(token: RaceAlgoSlug, counts: RaceLaneCounts): RaceLaneConfig {
  if (token === "dmsy") {
    counts.dmsy += 1;
    return { algo: "dmsy", id: "dmsy", label: "DMSY '26", persona: "moss" };
  }
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
 * Build lane configs from a parsed canonical race slug list.
 *
 * @param race - Lane algorithms in URL order (length 2 or 3).
 */
export function lanesFromRaceList(race: readonly RaceAlgoSlug[]): RaceLaneConfig[] {
  const counts: RaceLaneCounts = { dijkstra: 0, bmssp: 0, dmsy: 0 };
  const lanes: RaceLaneConfig[] = [];
  for (const token of race) {
    lanes.push(raceLaneFromToken(token, counts));
  }
  return lanes;
}

/**
 * Build the lane list for a race from URL search params.
 *
 * Derives lanes from {@link parseRaceUrl}: default three lanes (Dijkstra + BMSSP + DMSY),
 * legacy `lane3=1` (DMSY alias), `lane3=dijkstra` (Dijkstra B stub), or explicit `race=`.
 *
 * @param search - Query string or parsed {@link URLSearchParams}.
 */
export function lanesFromSearch(search: string | URLSearchParams): RaceLaneConfig[] {
  const { race } = parseRaceUrl(search);
  return lanesFromRaceList(race);
}
