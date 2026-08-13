/**
 * Story-mode drive resolution from shipped beats and lane totals (issue #19).
 *
 * Pure functions — no DOM, no trace imports, no algorithm code, no RaceScheduler.
 * Tests pass measured {@link StoryLaneTotals} so this module stays harness-free.
 */

import { BASE_OPS_PER_SECOND } from "../harness/workClock.ts";
import {
  STORY_SPEED,
  STORY_STEPS,
  storyStepById,
  type StoryCallout,
  type StoryLayout,
  type StoryStep,
  type StoryStepId,
} from "./storyScript.ts";

/** Billed totalWork per race lane after traces complete. */
export type StoryLaneTotals = {
  /** Dijkstra billed totalWork (lane 0). */
  dijkstraWork: number;
  /** BMSSP billed totalWork (lane 1). */
  bmsspWork: number;
};

/** Seek/play window and overlay fields for one story beat. */
export type StoryDrive = {
  /** Work-clock position to seek (integer >= 0). */
  seekT: number;
  /** Inclusive end of the auto-play window. */
  endT: number;
  layout: StoryLayout;
  callout: StoryCallout;
  caption: string;
  /** Lane 0 visible? */
  showDijkstra: boolean;
  /** Lane 1 visible? */
  showBmssp: boolean;
};

/**
 * @param totals - Lane billed work totals.
 * @throws When either total is not finite or is negative.
 */
function assertValidTotals(totals: StoryLaneTotals): void {
  if (!Number.isFinite(totals.dijkstraWork) || totals.dijkstraWork < 0) {
    throw new Error(
      `dijkstraWork must be a finite non-negative number, got ${String(totals.dijkstraWork)}`,
    );
  }
  if (!Number.isFinite(totals.bmsspWork) || totals.bmsspWork < 0) {
    throw new Error(
      `bmsspWork must be a finite non-negative number, got ${String(totals.bmsspWork)}`,
    );
  }
}

/**
 * Focus billed work for a beat layout (scrub range is derived from this lane total).
 *
 * @param layout - Beat layout (`both` uses max lane work).
 * @param totals - Lane billed work totals.
 */
function focusWorkForLayout(layout: StoryLayout, totals: StoryLaneTotals): number {
  switch (layout) {
    case "dijkstra":
      return totals.dijkstraWork;
    case "bmssp":
      return totals.bmsspWork;
    case "both":
      return Math.max(totals.dijkstraWork, totals.bmsspWork);
  }
}

/**
 * @param value - Raw work-clock position before clamping.
 * @param focusWork - Focus lane billed work for the beat.
 */
function clampWorkClockT(value: number, focusWork: number): number {
  const floored = Math.floor(value);
  if (floored < 0) {
    return 0;
  }
  const maxT = Math.floor(focusWork);
  if (floored > maxT) {
    return maxT;
  }
  return floored;
}

/**
 * Resolve seek/play window for a shipped story step.
 *
 * @param step - Shipped step definition, or a shipped {@link StoryStepId} resolved via {@link storyStepById}.
 * @param totals - Lane totalWork after traces are complete.
 * @returns Drive instructions for seek, auto-play window, layout, and caption.
 * @throws If totals are not finite or are negative, or the step id is not shipped (e.g. `forest`).
 */
export function applyStoryStep(step: StoryStep | StoryStepId, totals: StoryLaneTotals): StoryDrive {
  assertValidTotals(totals);

  const resolved = typeof step === "string" ? storyStepById(step) : step;
  const focusWork = focusWorkForLayout(resolved.layout, totals);

  const seekT = clampWorkClockT(resolved.startFrac * focusWork, focusWork);
  let endT = clampWorkClockT(resolved.endFrac * focusWork, focusWork);
  if (endT < seekT) {
    endT = seekT;
  }

  const layout = resolved.layout;
  const showDijkstra = layout === "dijkstra" || layout === "both";
  const showBmssp = layout === "bmssp" || layout === "both";

  return {
    seekT,
    endT,
    layout,
    callout: resolved.callout,
    caption: resolved.caption,
    showDijkstra,
    showBmssp,
  };
}

/**
 * Nominal auto-play seconds for the full shipped tour at {@link STORY_SPEED}.
 *
 * Sum over {@link STORY_STEPS} of `(endT - seekT) / (STORY_SPEED * BASE_OPS_PER_SECOND)`.
 *
 * @param totals - Lane totalWork after traces are complete.
 * @returns Wall-clock seconds at story play speed for all shipped beats.
 * @throws If totals are not finite or are negative.
 */
export function storyNominalSeconds(totals: StoryLaneTotals): number {
  assertValidTotals(totals);

  const opsPerSecond = STORY_SPEED * BASE_OPS_PER_SECOND;
  let totalSeconds = 0;

  for (const step of STORY_STEPS) {
    const drive = applyStoryStep(step, totals);
    totalSeconds += (drive.endT - drive.seekT) / opsPerSecond;
  }

  return totalSeconds;
}
