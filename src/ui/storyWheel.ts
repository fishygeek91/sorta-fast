/**
 * Story-mode wheel step decision (issue #60).
 *
 * Pure helper — no DOM, no harness, no trace imports, no algorithm code.
 * Extractable wheel decision so vitest can pin burst/cooldown behavior without a DOM.
 */

import { STORY_SCROLL_THRESHOLD_PX } from "./storyScript.ts";

/** Minimum milliseconds between emitted wheel steps. */
export const STORY_WHEEL_COOLDOWN_MS = 600;

export type StoryWheelAction = "none" | "next" | "back";

export type StoryWheelDecision = {
  action: StoryWheelAction;
  accumulator: number;
  lastStepMs: number;
};

type DecideStoryWheelInput = {
  accumulator: number;
  lastStepMs: number;
  deltaY: number;
  nowMs: number;
  allowNext: boolean;
  allowBack: boolean;
  cooldownMs?: number;
  thresholdPx?: number;
};

/**
 * Decide whether a wheel delta should advance story navigation.
 *
 * Accumulates `deltaY` until `thresholdPx` is crossed, then emits at most one
 * `"next"` or `"back"` step when allowed. Cooldown suppresses accumulation and
 * clears residual delta.
 *
 * @param input.accumulator - Residual wheel delta not yet consumed (px).
 * @param input.lastStepMs - Timestamp of the last emitted or consumed step (ms).
 * @param input.deltaY - Wheel event `deltaY` for this frame (px).
 * @param input.nowMs - Current time (ms).
 * @param input.allowNext - Whether a forward step is permitted.
 * @param input.allowBack - Whether a backward step is permitted.
 * @param input.cooldownMs - Minimum gap between steps; defaults to {@link STORY_WHEEL_COOLDOWN_MS}.
 * @param input.thresholdPx - Abs accumulation before a step; defaults to {@link STORY_SCROLL_THRESHOLD_PX}.
 * @returns Navigation action plus updated accumulator and last-step timestamp.
 */
export function decideStoryWheel(input: DecideStoryWheelInput): StoryWheelDecision {
  const cooldownMs = input.cooldownMs ?? STORY_WHEEL_COOLDOWN_MS;
  const thresholdPx = input.thresholdPx ?? STORY_SCROLL_THRESHOLD_PX;

  if (input.nowMs - input.lastStepMs < cooldownMs) {
    return {
      action: "none",
      accumulator: 0,
      lastStepMs: input.lastStepMs,
    };
  }

  const accumulator = input.accumulator + input.deltaY;

  if (Math.abs(accumulator) < thresholdPx) {
    return {
      action: "none",
      accumulator,
      lastStepMs: input.lastStepMs,
    };
  }

  if (accumulator > 0) {
    if (input.allowNext) {
      return {
        action: "next",
        accumulator: 0,
        lastStepMs: input.nowMs,
      };
    }
    return {
      action: "none",
      accumulator: 0,
      lastStepMs: input.nowMs,
    };
  }

  if (input.allowBack) {
    return {
      action: "back",
      accumulator: 0,
      lastStepMs: input.nowMs,
    };
  }

  return {
    action: "none",
    accumulator: 0,
    lastStepMs: input.nowMs,
  };
}
