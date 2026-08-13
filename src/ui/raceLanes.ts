/**
 * Race lane configuration derived from URL query params (issue #14).
 *
 * Pure helpers — no DOM. Lane count is 2 by default or 3 when `lane3=dijkstra`.
 */

/**
 * Per-lane display and algorithm binding for the multi-lane race UI.
 */
export type RaceLaneConfig = {
  algo: "dijkstra" | "bmssp";
  id: string;
  label: string;
  persona: "marble" | "ember" | "stub";
};

/** Default two-lane race: Dijkstra vs BMSSP. */
const DEFAULT_TWO_LANES: readonly RaceLaneConfig[] = [
  { algo: "dijkstra", id: "dijkstra", label: "Dijkstra", persona: "marble" },
  { algo: "bmssp", id: "bmssp", label: "BMSSP '25", persona: "ember" },
];

/** Third lane appended when `lane3=dijkstra` (debug / comparison lane). */
const DIJKSTRA_B_LANE: RaceLaneConfig = {
  algo: "dijkstra",
  id: "dijkstra-b",
  label: "Dijkstra B",
  persona: "stub",
};

/**
 * @param search - Raw query string (with or without leading `?`) or parsed params.
 * @returns A {@link URLSearchParams} view of `search`.
 */
function toSearchParams(search: string | URLSearchParams): URLSearchParams {
  if (typeof search === "string") {
    return new URLSearchParams(search);
  }
  return search;
}

/**
 * Build the lane list for a race from URL search params.
 *
 * Default (no `lane3` or invalid `lane3`): two lanes — Dijkstra and BMSSP.
 * `lane3=dijkstra` (exact): append a third Dijkstra comparison lane.
 * `lane3=1` and other values are ignored (reserved for #27). Length is always 2 or 3.
 *
 * @param search - Query string or parsed {@link URLSearchParams}.
 */
export function lanesFromSearch(search: string | URLSearchParams): RaceLaneConfig[] {
  const params = toSearchParams(search);
  const lane3 = params.get("lane3");

  if (lane3 === "dijkstra") {
    return [...DEFAULT_TWO_LANES, DIJKSTRA_B_LANE];
  }

  return [...DEFAULT_TWO_LANES];
}
