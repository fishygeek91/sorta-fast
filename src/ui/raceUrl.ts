/**
 * Race URL codec for graph gallery + race mode state (issue #14).
 *
 * Pure parse/serialize of `?g=&n=&seed=&mode=&target=&lane3=` — no DOM.
 * Graph kind / size / seed parsing mirrors Lens (`src/ui/urlState.ts`).
 */

import { GRAPH_KINDS, type GraphKind } from "../core/graph.ts";

/** View mode encoded in the `mode` query param. */
export type RaceMode = "race" | "lens";

/** Lane-three slot — only `dijkstra` is supported today; other values parse as unset. */
export type RaceLane3 = "dijkstra";

/** Graph gallery and race fields encoded in the race URL. */
export type RaceUrlState = {
  g: GraphKind;
  n: number;
  seed: number;
  mode: RaceMode;
  /** Finish vertex; `null` means defer to `pickFinishVertex` later. */
  target: number | null;
  lane3: RaceLane3 | null;
};

/** Defaults match the race demo preset (maze / 5000 / 1729, two lanes). */
export const DEFAULT_RACE_URL: RaceUrlState = {
  g: "maze",
  n: 5000,
  seed: 1729,
  mode: "race",
  target: null,
  lane3: null,
};

/**
 * @param value - Candidate graph-kind slug from the query string.
 * @returns Whether `value` is a supported {@link GraphKind}.
 */
function isGraphKind(value: string): value is GraphKind {
  for (const kind of GRAPH_KINDS) {
    if (kind === value) {
      return true;
    }
  }
  return false;
}

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
 * @param raw - `g` query value, or null when absent.
 * @returns A valid graph kind, falling back to the default on invalid input.
 */
function parseGraphKind(raw: string | null): GraphKind {
  if (raw === null || raw === "") {
    return DEFAULT_RACE_URL.g;
  }
  if (isGraphKind(raw)) {
    return raw;
  }
  return DEFAULT_RACE_URL.g;
}

/**
 * @param raw - Numeric query value, or null when absent.
 * @param fallback - Default used when `raw` is missing or invalid.
 * @returns A positive integer node count.
 */
function parsePositiveInteger(raw: string | null, fallback: number): number {
  if (raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

/**
 * @param raw - Numeric query value, or null when absent.
 * @param fallback - Default used when `raw` is missing or invalid.
 * @returns A finite integer seed (mulberry32 / {@link generateGraph} compatible).
 */
function parseInteger(raw: string | null, fallback: number): number {
  if (raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return fallback;
  }
  return parsed;
}

/**
 * @param raw - `mode` query value, or null when absent.
 * @returns `lens` only when `raw` is exactly `lens`; otherwise `race`.
 */
function parseRaceMode(raw: string | null): RaceMode {
  if (raw === "lens") {
    return "lens";
  }
  return "race";
}

/**
 * @param raw - `target` query value, or null when absent.
 * @returns A non-negative integer finish vertex, or `null` when unset/invalid.
 */
function parseTarget(raw: string | null): number | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

/**
 * @param raw - `lane3` query value, or null when absent.
 * @returns `dijkstra` only for an exact match; otherwise `null`.
 */
function parseLane3(raw: string | null): RaceLane3 | null {
  if (raw === "dijkstra") {
    return "dijkstra";
  }
  return null;
}

/**
 * Parse a query string or {@link URLSearchParams} into race gallery state.
 *
 * Unknown keys are ignored. Invalid or missing fields fall back to
 * {@link DEFAULT_RACE_URL} field-by-field without throwing.
 *
 * @param search - Query string (e.g. `"?g=city&n=500&seed=1&mode=race"`) or parsed params.
 */
export function parseRaceUrl(search: string | URLSearchParams): RaceUrlState {
  const params = toSearchParams(search);
  return {
    g: parseGraphKind(params.get("g")),
    n: parsePositiveInteger(params.get("n"), DEFAULT_RACE_URL.n),
    seed: parseInteger(params.get("seed"), DEFAULT_RACE_URL.seed),
    mode: parseRaceMode(params.get("mode")),
    target: parseTarget(params.get("target")),
    lane3: parseLane3(params.get("lane3")),
  };
}

/**
 * @param state - Candidate state to serialize.
 * @throws When `state` contains an unknown graph kind, invalid n/seed, mode, target, or lane3.
 */
function assertValidRaceUrlState(state: RaceUrlState): void {
  if (!isGraphKind(state.g)) {
    throw new Error(`Invalid graph kind: ${state.g}`);
  }
  if (!Number.isFinite(state.n) || !Number.isInteger(state.n) || state.n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(state.n)}`);
  }
  if (!Number.isFinite(state.seed) || !Number.isInteger(state.seed)) {
    throw new Error(`seed must be a finite integer, got ${String(state.seed)}`);
  }
  if (state.mode !== "race" && state.mode !== "lens") {
    throw new Error(`Invalid race mode: ${state.mode}`);
  }
  if (state.target !== null) {
    if (!Number.isFinite(state.target) || !Number.isInteger(state.target) || state.target < 0) {
      throw new Error(`target must be a non-negative integer or null, got ${String(state.target)}`);
    }
  }
  if (state.lane3 !== null && state.lane3 !== "dijkstra") {
    throw new Error(`Invalid lane3: ${state.lane3}`);
  }
}

/**
 * Serialize race gallery state to a canonical query string.
 *
 * The result always starts with `?` and contains `g`, `n`, `seed`, and `mode`.
 * `target` and `lane3` are included only when set.
 *
 * @param state - Valid race URL state.
 * @throws When `state` fails {@link assertValidRaceUrlState}.
 */
export function serializeRaceUrl(state: RaceUrlState): string {
  assertValidRaceUrlState(state);
  const params = new URLSearchParams();
  params.set("g", state.g);
  params.set("n", String(state.n));
  params.set("seed", String(state.seed));
  params.set("mode", state.mode);
  if (state.target !== null) {
    params.set("target", String(state.target));
  }
  if (state.lane3 === "dijkstra") {
    params.set("lane3", "dijkstra");
  }
  return `?${params.toString()}`;
}
