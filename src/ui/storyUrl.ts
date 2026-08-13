/**
 * Story URL codec for guided-tour mode state (issue #19).
 *
 * Pure parse/serialize of `?mode=story&step=&g=&n=&seed=&t=` — no DOM.
 * Graph kind / size / seed parsing mirrors Race and Lens URL codecs.
 */

import { GRAPH_KINDS, type GraphKind } from "../core/graph.ts";
import { STORY_PRESET, isShippedStoryStepId, type StoryStepId } from "./storyScript.ts";

/** Graph gallery and story-tour fields encoded in the story URL. */
export type StoryUrlState = {
  g: GraphKind;
  n: number;
  seed: number;
  /** Shipped tour step slug; unshipped ids (e.g. `forest`) are rejected on serialize. */
  step: StoryStepId;
  /** Work-clock scrub position; `0` when omitted from the URL. */
  t: number;
};

/** Defaults match the story pedagogical preset (city / 500 / 1729, wavefront step). */
export const DEFAULT_STORY_URL: StoryUrlState = {
  g: STORY_PRESET.g,
  n: STORY_PRESET.n,
  seed: STORY_PRESET.seed,
  step: "wavefront",
  t: 0,
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
    return DEFAULT_STORY_URL.g;
  }
  if (isGraphKind(raw)) {
    return raw;
  }
  return DEFAULT_STORY_URL.g;
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
 * @param raw - `step` query value, or null when absent.
 * @returns A shipped story step slug; `forest` and other unshipped ids map to `wavefront`.
 */
function parseStoryStep(raw: string | null): StoryStepId {
  if (raw === null || raw === "") {
    return DEFAULT_STORY_URL.step;
  }
  if (raw === "forest") {
    return DEFAULT_STORY_URL.step;
  }
  if (isShippedStoryStepId(raw)) {
    return raw;
  }
  return DEFAULT_STORY_URL.step;
}

/**
 * True when the query string selects Story mode.
 *
 * @param search - Query string or parsed params (e.g. `?mode=story&step=pivots`).
 */
export function isStorySearch(search: string | URLSearchParams): boolean {
  const params = toSearchParams(search);
  return params.get("mode") === "story";
}

/**
 * Parse a query string or {@link URLSearchParams} into story tour state.
 *
 * Unknown keys are ignored. Invalid or missing fields fall back to
 * {@link DEFAULT_STORY_URL} field-by-field without throwing.
 *
 * @param search - Query string (e.g. `"?mode=story&step=pivots&g=city&n=500&seed=1729&t=123"`) or parsed params.
 */
export function parseStoryUrl(search: string | URLSearchParams): StoryUrlState {
  const params = toSearchParams(search);
  return {
    g: parseGraphKind(params.get("g")),
    n: parsePositiveInteger(params.get("n"), DEFAULT_STORY_URL.n),
    seed: parseInteger(params.get("seed"), DEFAULT_STORY_URL.seed),
    step: parseStoryStep(params.get("step")),
    t: parseWorkClockPosition(params.get("t")),
  };
}

/**
 * @param state - Candidate state to serialize.
 * @throws When `state` contains an unknown graph kind, invalid n/seed/t, or an unshipped step.
 */
function assertValidStoryUrlState(state: StoryUrlState): void {
  if (!isGraphKind(state.g)) {
    throw new Error(`Invalid graph kind: ${state.g}`);
  }
  if (!Number.isFinite(state.n) || !Number.isInteger(state.n) || state.n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(state.n)}`);
  }
  if (!Number.isFinite(state.seed) || !Number.isInteger(state.seed)) {
    throw new Error(`seed must be a finite integer, got ${String(state.seed)}`);
  }
  if (!isShippedStoryStepId(state.step)) {
    throw new Error(`Invalid or unshipped story step: ${state.step}`);
  }
  if (!Number.isFinite(state.t) || !Number.isInteger(state.t) || state.t < 0) {
    throw new Error(`t must be a non-negative integer, got ${String(state.t)}`);
  }
}

/**
 * Serialize story tour state to a canonical query string.
 *
 * The result always starts with `?` and contains `mode=story`, `step`, `g`, `n`, and `seed`.
 * `t` is included only when greater than zero.
 *
 * @param state - Valid story URL state.
 * @throws When `state` fails {@link assertValidStoryUrlState}.
 */
export function serializeStoryUrl(state: StoryUrlState): string {
  assertValidStoryUrlState(state);
  const params = new URLSearchParams();
  params.set("mode", "story");
  params.set("step", state.step);
  params.set("g", state.g);
  params.set("n", String(state.n));
  params.set("seed", String(state.seed));
  if (state.t > 0) {
    params.set("t", String(state.t));
  }
  return `?${params.toString()}`;
}
