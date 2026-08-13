/**
 * Race URL codec for graph gallery + race mode state (issue #14, #15).
 *
 * Pure parse/serialize of `?g=&n=&seed=&mode=&race=&target=&t=&bmssp=&bk=&bt=` — no DOM.
 * Legacy `lane3=dijkstra` is parsed when `race=` is absent (issue #15).
 * Graph kind / size / seed parsing mirrors Lens (`src/ui/urlState.ts`).
 *
 * Canonical race lane list: design.md §3.5. `dmsy` tokens are dropped until #27.
 */

import { GRAPH_KINDS, type GraphKind } from "../core/graph.ts";
import {
  isBmsspUrlMode,
  parseBmsspMode,
  parseOptionalBlockParam,
  type BmsspUrlMode,
} from "./bmsspUrl.ts";

export type { BmsspUrlMode };

/** View mode encoded in the `mode` query param. */
export type RaceMode = "race" | "lens";

/** Canonical race-algorithm slug allowed in the `race=` param (after filtering). */
export type RaceAlgoSlug = "dijkstra" | "bmssp";

/** Graph gallery and race fields encoded in the race URL. */
export type RaceUrlState = {
  g: GraphKind;
  n: number;
  seed: number;
  mode: RaceMode;
  /** Finish vertex; `null` means defer to `pickFinishVertex` later. */
  target: number | null;
  /** Canonical lane algo slugs in URL order (length 2 or 3). */
  race: readonly RaceAlgoSlug[];
  /** Work-clock scrub position; `0` when omitted from the URL. */
  t: number;
  /** BMSSP block-parameter mode; `demo` when omitted from the URL. */
  bmssp: BmsspUrlMode;
  /** BMSSP block size `k`; `null` when omitted (demo or paper mode default). */
  bk: number | null;
  /** BMSSP block count `t`; `null` when omitted (demo or paper mode default). */
  bt: number | null;
};

/** Defaults match the sweep-winning race preset (sparse / 25000 / 4, two lanes). */
export const DEFAULT_RACE_URL: RaceUrlState = {
  g: "sparse",
  n: 25000,
  seed: 4,
  mode: "race",
  target: null,
  race: ["dijkstra", "bmssp"],
  t: 0,
  bmssp: "demo",
  bk: null,
  bt: null,
};

const DEFAULT_RACE_LIST: readonly RaceAlgoSlug[] = ["dijkstra", "bmssp"];

const LEGACY_LANE3_RACE_LIST: readonly RaceAlgoSlug[] = ["dijkstra", "bmssp", "dijkstra"];

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
 * @param token - Single race-list token from a comma-separated `race=` value.
 * @returns Whether `token` is a supported race algo slug (excludes `dmsy` until #27).
 */
function isRaceAlgoSlug(token: string): token is RaceAlgoSlug {
  return token === "dijkstra" || token === "bmssp";
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
 * @param raw - `t` query value, or null when absent.
 * @returns A non-negative finite integer work-clock position; `0` when unset/invalid.
 */
function parseWorkClockPosition(raw: string | null): number {
  if (raw === null || raw === "") {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

/**
 * @param raw - Comma-separated `race=` query value.
 * @returns Filtered lane slugs in URL order (max 3); defaults when fewer than 2 remain.
 */
function parseRaceListFromParam(raw: string): readonly RaceAlgoSlug[] {
  const tokens = raw.split(",");
  const kept: RaceAlgoSlug[] = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (isRaceAlgoSlug(trimmed)) {
      kept.push(trimmed);
    }
  }
  if (kept.length > 3) {
    return kept.slice(0, 3);
  }
  if (kept.length < 2) {
    return DEFAULT_RACE_LIST;
  }
  return kept;
}

/**
 * @param params - Parsed query params.
 * @returns Canonical race lane list. `race=` wins over legacy `lane3=dijkstra`.
 */
function parseRaceList(params: URLSearchParams): readonly RaceAlgoSlug[] {
  const raceRaw = params.get("race");
  if (raceRaw !== null && raceRaw !== "") {
    return parseRaceListFromParam(raceRaw);
  }
  if (params.get("lane3") === "dijkstra") {
    return LEGACY_LANE3_RACE_LIST;
  }
  return DEFAULT_RACE_LIST;
}

/**
 * Parse a query string or {@link URLSearchParams} into race gallery state.
 *
 * Unknown keys are ignored. Invalid or missing fields fall back to
 * {@link DEFAULT_RACE_URL} field-by-field without throwing.
 *
 * @param search - Query string (e.g. `"?g=city&n=500&seed=1&mode=race&race=dijkstra,bmssp"`) or parsed params.
 */
export function parseRaceUrl(search: string | URLSearchParams): RaceUrlState {
  const params = toSearchParams(search);
  return {
    g: parseGraphKind(params.get("g")),
    n: parsePositiveInteger(params.get("n"), DEFAULT_RACE_URL.n),
    seed: parseInteger(params.get("seed"), DEFAULT_RACE_URL.seed),
    mode: parseRaceMode(params.get("mode")),
    target: parseTarget(params.get("target")),
    race: parseRaceList(params),
    t: parseWorkClockPosition(params.get("t")),
    bmssp: parseBmsspMode(params.get("bmssp")),
    bk: parseOptionalBlockParam(params.get("bk")),
    bt: parseOptionalBlockParam(params.get("bt")),
  };
}

/**
 * @param state - Candidate state to serialize.
 * @throws When `state` contains an unknown graph kind, invalid n/seed, mode, target, race, or t.
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
  if (state.race.length < 2 || state.race.length > 3) {
    throw new Error(`race must have length 2 or 3, got ${String(state.race.length)}`);
  }
  for (const token of state.race) {
    if (!isRaceAlgoSlug(token)) {
      throw new Error(`Invalid race token: ${token}`);
    }
  }
  if (!Number.isFinite(state.t) || !Number.isInteger(state.t) || state.t < 0) {
    throw new Error(`t must be a non-negative integer, got ${String(state.t)}`);
  }
  if (!isBmsspUrlMode(state.bmssp)) {
    throw new Error(`Invalid bmssp mode: ${state.bmssp}`);
  }
  if (state.bk !== null) {
    if (!Number.isFinite(state.bk) || !Number.isInteger(state.bk) || state.bk < 1) {
      throw new Error(`bk must be a positive integer or null, got ${String(state.bk)}`);
    }
  }
  if (state.bt !== null) {
    if (!Number.isFinite(state.bt) || !Number.isInteger(state.bt) || state.bt < 1) {
      throw new Error(`bt must be a positive integer or null, got ${String(state.bt)}`);
    }
  }
}

/**
 * Serialize race gallery state to a canonical query string.
 *
 * The result always starts with `?` and contains `g`, `n`, `seed`, `mode`, and `race`.
 * `target` is included only when non-null; `t` only when greater than zero.
 * `bmssp` is included only when `paper`; `bk` and `bt` only when non-null.
 * Legacy `lane3=` is never written.
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
  params.set("race", state.race.join(","));
  if (state.target !== null) {
    params.set("target", String(state.target));
  }
  if (state.t > 0) {
    params.set("t", String(state.t));
  }
  if (state.bmssp === "paper") {
    params.set("bmssp", "paper");
  }
  if (state.bk !== null) {
    params.set("bk", String(state.bk));
  }
  if (state.bt !== null) {
    params.set("bt", String(state.bt));
  }
  return `?${params.toString()}`;
}
