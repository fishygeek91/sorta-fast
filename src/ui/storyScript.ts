/**
 * Story-mode beat table and tour helpers (issue #19).
 *
 * Pure data + tiny helpers — no DOM, no harness/renderer/worker imports,
 * no trace or algorithm modules. Pedagogical preset: city / S / seed 1729.
 */

import { SIZE_PRESETS } from "../core/graph.ts";

/** Maximum caption length enforced at module load (keeps canvas callouts terse). */
const MAX_CAPTION_LENGTH = 220;

/** Story beat slug. `forest` is reserved for #27 and is not shipped. */
export type StoryStepId = "wavefront" | "sorting" | "pivots" | "forest" | "race";

/** Which lane canvases are visible for a beat. */
export type StoryLayout = "dijkstra" | "bmssp" | "both";

/** Optional counter highlight. */
export type StoryCallout = "comparisons" | null;

/** One story beat: layout, work-clock seek range, and canvas caption. */
export type StoryStep = {
  id: StoryStepId;
  layout: StoryLayout;
  startFrac: number;
  endFrac: number;
  callout: StoryCallout;
  /** One or two short sentences, canvas-anchored. */
  caption: string;
};

/**
 * Pedagogical graph preset for story mode (not the 25k default race).
 * BMSSP demo mode is the story URL default (`bmssp=demo`); this module documents the graph only.
 */
export const STORY_PRESET = { g: "city", n: SIZE_PRESETS.S, seed: 1729 } as const;

/**
 * Shipped story beats in tour order.
 *
 * Issue #27 inserts a `forest` step after {@link STORY_FOREST_INSERT_AFTER}; that slug is
 * reserved in {@link StoryStepId} but is not present in this array.
 */
const STORY_STEPS_TABLE: readonly StoryStep[] = [
  {
    id: "wavefront",
    layout: "dijkstra",
    startFrac: 0,
    endFrac: 0.85,
    callout: null,
    caption:
      "Dijkstra expands a perfect wavefront — it will not settle vertex k+1 until it is sure about vertex k.",
  },
  {
    id: "sorting",
    layout: "dijkstra",
    startFrac: 1,
    endFrac: 1,
    callout: "comparisons",
    caption:
      "That Comparisons number is the sorting barrier: full distance order costs about n log n comparisons.",
  },
  {
    id: "pivots",
    layout: "bmssp",
    startFrac: 0,
    endFrac: 0.7,
    callout: null,
    caption:
      "BMSSP refuses a full sort. It picks pivots and settles vertices in batch blooms on the same graph.",
  },
  {
    id: "race",
    layout: "both",
    startFrac: 0,
    endFrac: 0.6,
    callout: null,
    caption:
      "Same graph, same work clock. Fast algorithms are further along at the same billed-op tick.",
  },
];

/**
 * @param steps - Shipped beat table to validate.
 * @throws When any step has invalid fractions, empty caption, or duplicate ids.
 */
function assertValidStorySteps(steps: readonly StoryStep[]): void {
  const seenIds = new Set<StoryStepId>();
  for (const step of steps) {
    if (seenIds.has(step.id)) {
      throw new Error(`Duplicate story step id: ${step.id}`);
    }
    seenIds.add(step.id);

    if (!Number.isFinite(step.startFrac) || step.startFrac < 0 || step.startFrac > 1) {
      throw new Error(
        `Story step "${step.id}" startFrac must be in [0, 1], got ${String(step.startFrac)}`,
      );
    }
    if (!Number.isFinite(step.endFrac) || step.endFrac < 0 || step.endFrac > 1) {
      throw new Error(
        `Story step "${step.id}" endFrac must be in [0, 1], got ${String(step.endFrac)}`,
      );
    }
    if (step.startFrac > step.endFrac) {
      throw new Error(
        `Story step "${step.id}" startFrac must be <= endFrac, got ${String(step.startFrac)} > ${String(step.endFrac)}`,
      );
    }
    if (step.caption.length === 0) {
      throw new Error(`Story step "${step.id}" caption must be non-empty`);
    }
    if (step.caption.length > MAX_CAPTION_LENGTH) {
      throw new Error(
        `Story step "${step.id}" caption exceeds ${String(MAX_CAPTION_LENGTH)} characters`,
      );
    }
  }
}

assertValidStorySteps(STORY_STEPS_TABLE);

/** Shipped story beats in tour order (excludes reserved `forest` from #27). */
export const STORY_STEPS: readonly StoryStep[] = STORY_STEPS_TABLE;

/** Shipped ids in tour order (excludes `forest`). */
export const STORY_TOUR_IDS: readonly StoryStepId[] = STORY_STEPS.map((step) => step.id);

/** #27 inserts `forest` after this shipped id. */
export const STORY_FOREST_INSERT_AFTER = "pivots" as const;

/**
 * Play-speed multiplier for story rAF (WorkClock).
 *
 * Measured on the pedagogical preset (city / 500 / seed 1729): shipped beat
 * windows sum to 30,999 billed ops. At BASE_OPS_PER_SECOND = 20,000 this
 * speed yields ~91s of auto-play (issue #19 ~90s tour). Prefer slowing
 * speed over bumping n so mobile gen stays instant.
 */
export const STORY_SPEED = 0.017;

/** Wheel/swipe threshold in CSS pixels before advancing a step. */
export const STORY_SCROLL_THRESHOLD_PX = 80;

/**
 * @param id - Candidate step slug from URL or navigation.
 * @returns Whether `id` is a shipped beat (present in {@link STORY_STEPS}; not `forest`).
 */
export function isShippedStoryStepId(id: string): id is StoryStepId {
  for (const step of STORY_STEPS) {
    if (step.id === id) {
      return true;
    }
  }
  return false;
}

/**
 * @param id - Story beat slug.
 * @returns The shipped step definition for `id`.
 * @throws When `id` is not shipped (e.g. reserved `forest` from #27).
 */
export function storyStepById(id: StoryStepId): StoryStep {
  for (const step of STORY_STEPS) {
    if (step.id === id) {
      return step;
    }
  }
  throw new Error(`Story step is not shipped: ${id}`);
}

/**
 * @param id - Shipped story beat slug.
 * @returns Zero-based index of `id` in {@link STORY_STEPS}.
 * @throws When `id` is not shipped (e.g. reserved `forest` from #27).
 */
export function storyStepIndex(id: StoryStepId): number {
  for (let index = 0; index < STORY_STEPS.length; index += 1) {
    if (STORY_STEPS[index].id === id) {
      return index;
    }
  }
  throw new Error(`Story step is not shipped: ${id}`);
}

/**
 * @param id - Current shipped story beat slug.
 * @returns The next shipped slug, or `null` when `id` is the final beat.
 * @throws When `id` is not shipped.
 */
export function nextStoryStepId(id: StoryStepId): StoryStepId | null {
  const index = storyStepIndex(id);
  const next = STORY_STEPS[index + 1];
  if (next === undefined) {
    return null;
  }
  return next.id;
}

/**
 * @param id - Current shipped story beat slug.
 * @returns The previous shipped slug, or `null` when `id` is the first beat.
 * @throws When `id` is not shipped.
 */
export function prevStoryStepId(id: StoryStepId): StoryStepId | null {
  const index = storyStepIndex(id);
  if (index === 0) {
    return null;
  }
  const prev = STORY_STEPS[index - 1];
  if (prev === undefined) {
    return null;
  }
  return prev.id;
}
