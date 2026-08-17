/**
 * Lens URL codec for graph gallery state (issue #8, #12).
 *
 * Pure parse/serialize of `?g=&n=&seed=&algo=&bmssp=&bk=&bt=` — no DOM. Race,
 * speed, overlays, and scrub position are intentionally excluded until a later
 * issue. Work-clock scrub `t` lives on the race codec, not here.
 */

import { GRAPH_KINDS, type GraphKind } from "../core/graph.ts";
import {
  isBmsspUrlMode,
  parseBmsspMode,
  parseOptionalBlockParam,
  type BmsspUrlMode,
} from "./bmsspUrl.ts";

export type { BmsspUrlMode };

/** Lens algorithm lane selected via the URL (`algo` query param). */
export type LensAlgo = "dijkstra" | "bmssp" | "dmsy";

/** Graph gallery fields encoded in the Lens URL. */
export type LensUrlState = {
  g: GraphKind;
  n: number;
  seed: number;
  algo: LensAlgo;
  /** BMSSP block-parameter mode; `demo` when omitted from the URL. */
  bmssp: BmsspUrlMode;
  /** BMSSP block size `k`; `null` when omitted (demo or paper mode default). */
  bk: number | null;
  /** BMSSP block count `t`; `null` when omitted (demo or paper mode default). */
  bt: number | null;
};

/** Defaults match the sweep-winning lens preset (sparse / 25000 / 4, BMSSP lane). */
export const DEFAULT_LENS_URL: LensUrlState = {
  g: "sparse",
  n: 25000,
  seed: 4,
  algo: "bmssp",
  bmssp: "demo",
  bk: null,
  bt: null,
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
 * @param value - Candidate `algo` slug from the query string.
 * @returns Whether `value` is a supported {@link LensAlgo}.
 */
function isLensAlgo(value: string): value is LensAlgo {
  return value === "dijkstra" || value === "bmssp" || value === "dmsy";
}

/**
 * @param raw - `algo` query value, or null when absent.
 * @returns A valid lens algorithm, defaulting to BMSSP on invalid input.
 */
function parseLensAlgo(raw: string | null): LensAlgo {
  if (raw === null || raw === "") {
    return DEFAULT_LENS_URL.algo;
  }
  if (isLensAlgo(raw)) {
    return raw;
  }
  return DEFAULT_LENS_URL.algo;
}

/**
 * Parse a query string or {@link URLSearchParams} into Lens gallery state.
 *
 * Unknown keys are ignored. Invalid or missing `g`, `n`, `seed`, and `algo`
 * values fall back to {@link DEFAULT_LENS_URL} field-by-field without throwing.
 *
 * @param search - Query string (e.g. `"?g=city&n=500&seed=1&algo=bmssp"`) or parsed params.
 */
export function parseLensUrl(search: string | URLSearchParams): LensUrlState {
  const params = toSearchParams(search);
  return {
    g: parseGraphKind(params.get("g")),
    n: parsePositiveInteger(params.get("n"), DEFAULT_LENS_URL.n),
    seed: parseInteger(params.get("seed"), DEFAULT_LENS_URL.seed),
    algo: parseLensAlgo(params.get("algo")),
    bmssp: parseBmsspMode(params.get("bmssp")),
    bk: parseOptionalBlockParam(params.get("bk")),
    bt: parseOptionalBlockParam(params.get("bt")),
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
  if (!isLensAlgo(state.algo)) {
    throw new Error(`Invalid lens algo: ${state.algo}`);
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
 * Serialize Lens gallery state to a canonical query string.
 *
 * The result always starts with `?` and contains `g`, `n`, `seed`, and `algo`.
 * `bmssp` is included only when `paper`; `bk` and `bt` only when non-null.
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
  params.set("algo", state.algo);
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
