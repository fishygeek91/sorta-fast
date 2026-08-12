/**
 * Lens URL codec for graph gallery state (issue #8).
 *
 * Pure parse/serialize of `?g=&n=&seed=` — no DOM. Race, speed, overlays,
 * and scrub position are intentionally excluded until a later issue.
 */

import { GRAPH_KINDS, type GraphKind } from "../core/graph.ts";

/** Graph gallery fields encoded in the Lens URL. */
export type LensUrlState = {
  g: GraphKind;
  n: number;
  seed: number;
};

/** Defaults match the current single-lane demo (`src/main.ts`). */
export const DEFAULT_LENS_URL: LensUrlState = { g: "maze", n: 5000, seed: 1729 };

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
    return DEFAULT_LENS_URL.g;
  }
  if (isGraphKind(raw)) {
    return raw;
  }
  return DEFAULT_LENS_URL.g;
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
 * Parse a query string or {@link URLSearchParams} into Lens gallery state.
 *
 * Unknown keys are ignored. Invalid or missing `g`, `n`, and `seed` values fall
 * back to {@link DEFAULT_LENS_URL} field-by-field without throwing.
 *
 * @param search - Query string (e.g. `"?g=city&n=500&seed=1"`) or parsed params.
 */
export function parseLensUrl(search: string | URLSearchParams): LensUrlState {
  const params = toSearchParams(search);
  return {
    g: parseGraphKind(params.get("g")),
    n: parsePositiveInteger(params.get("n"), DEFAULT_LENS_URL.n),
    seed: parseInteger(params.get("seed"), DEFAULT_LENS_URL.seed),
  };
}

/**
 * @param state - Candidate state to serialize.
 * @throws When `state` contains an unknown graph kind, non-integer seed, or n below 1.
 */
function assertValidLensUrlState(state: LensUrlState): void {
  if (!isGraphKind(state.g)) {
    throw new Error(`Invalid graph kind: ${state.g}`);
  }
  if (!Number.isFinite(state.n) || !Number.isInteger(state.n) || state.n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(state.n)}`);
  }
  if (!Number.isFinite(state.seed) || !Number.isInteger(state.seed)) {
    throw new Error(`seed must be a finite integer, got ${String(state.seed)}`);
  }
}

/**
 * Serialize Lens gallery state to a canonical query string.
 *
 * The result always starts with `?` and contains only `g`, `n`, and `seed`.
 *
 * @param state - Valid gallery state.
 * @throws When `state` fails {@link assertValidLensUrlState}.
 */
export function serializeLensUrl(state: LensUrlState): string {
  assertValidLensUrlState(state);
  const params = new URLSearchParams();
  params.set("g", state.g);
  params.set("n", String(state.n));
  params.set("seed", String(state.seed));
  return `?${params.toString()}`;
}
