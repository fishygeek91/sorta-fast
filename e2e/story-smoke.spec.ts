/**
 * Story mode Playwright smoke test (GitHub issue #61).
 *
 * Verifies wheel-driven beat navigation on the shipped story tour (wavefront →
 * sorting → pivots → forest → race) without importing app modules — Playwright cannot
 * resolve the repo's `.ts` extension imports.
 */

import { test, expect, type Page } from "@playwright/test";

/** Default story query from {@link DEFAULT_STORY_URL} in src/ui/storyUrl.ts */
const DEFAULT_STORY_PATH = "?mode=story&step=wavefront&g=city&n=500&seed=1729";

/** Minimum gap between wheel steps in ms — src/ui/storyWheel.ts */
const STORY_WHEEL_COOLDOWN_MS = 600;

/** Cooldown plus slack before the next wheel advance. */
const WHEEL_COOLDOWN_WAIT_MS = STORY_WHEEL_COOLDOWN_MS + 100;

/** Wheel delta per event in {@link dispatchWheelBurst} (6 × 120 > 80px threshold in src/ui/storyScript.ts). */
const WHEEL_BURST_DELTA_Y = 120;

/** Number of wheel events per burst (one flick). */
const WHEEL_BURST_COUNT = 6;

/**
 * Count `.story-lanes .race-lane` elements whose computed `display` is not `none`.
 * Lane visibility uses the HTML `hidden` attribute plus CSS `.race-lane[hidden]{display:none}`.
 */
async function visibleLaneCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const lanes = document.querySelectorAll(".story-lanes .race-lane");
    let count = 0;
    for (const el of lanes) {
      if (window.getComputedStyle(el).display !== "none") {
        count += 1;
      }
    }
    return count;
  });
}

/**
 * Wait until workers finish and story nav unlocks (`syncNavButtons` in src/ui/story.ts).
 * `#story-next` enables when `race.allComplete`; `#story-status` stays hidden unless
 * a worker error is shown.
 */
async function waitStoryReady(page: Page): Promise<void> {
  await expect(page.locator("#story-next")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator("#story-status")).toBeHidden();
}

/**
 * Dispatch six `WheelEvent`s with `deltaY` on `.story-root` in a tight loop.
 * Simulates one scroll flick; the passive listener lives on `.story-root` (src/ui/story.ts).
 */
async function dispatchWheelBurst(page: Page): Promise<void> {
  await page.evaluate(
    ({ burstCount, deltaY }) => {
      const root = document.querySelector(".story-root");
      if (root === null) {
        throw new Error("Missing .story-root element");
      }
      for (let i = 0; i < burstCount; i += 1) {
        root.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { burstCount: WHEEL_BURST_COUNT, deltaY: WHEEL_BURST_DELTA_Y },
  );
}

/**
 * Parse `mode` and `step` from the current page URL query string.
 */
function storyStepFromUrl(page: Page): { mode: string | null; step: string | null } {
  const url = new URL(page.url());
  return {
    mode: url.searchParams.get("mode"),
    step: url.searchParams.get("step"),
  };
}

test.describe("Story mode smoke (#61)", () => {
  test("wheel advances beats and stays on Story at race", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(DEFAULT_STORY_PATH);

    await waitStoryReady(page);

    let { mode, step } = storyStepFromUrl(page);
    expect(mode).toBe("story");
    expect(step).toBe("wavefront");
    expect(await visibleLaneCount(page)).toBe(1);

    await page.waitForTimeout(WHEEL_COOLDOWN_WAIT_MS);
    await dispatchWheelBurst(page);

    ({ mode, step } = storyStepFromUrl(page));
    expect(mode).toBe("story");
    expect(step).toBe("sorting");
    expect(step).not.toBe("pivots");
    expect(step).not.toBe("race");
    expect(await visibleLaneCount(page)).toBe(1);

    await page.waitForTimeout(WHEEL_COOLDOWN_WAIT_MS);
    await dispatchWheelBurst(page);

    ({ mode, step } = storyStepFromUrl(page));
    expect(mode).toBe("story");
    expect(step).toBe("pivots");
    expect(await visibleLaneCount(page)).toBe(1);

    await page.waitForTimeout(WHEEL_COOLDOWN_WAIT_MS);
    await dispatchWheelBurst(page);

    ({ mode, step } = storyStepFromUrl(page));
    expect(mode).toBe("story");
    expect(step).toBe("forest");
    expect(await visibleLaneCount(page)).toBe(1);

    await page.waitForTimeout(WHEEL_COOLDOWN_WAIT_MS);
    await dispatchWheelBurst(page);

    ({ mode, step } = storyStepFromUrl(page));
    expect(mode).toBe("story");
    expect(step).toBe("race");
    expect(await visibleLaneCount(page)).toBe(2);

    await page.waitForTimeout(WHEEL_COOLDOWN_WAIT_MS);
    await dispatchWheelBurst(page);
    await page.waitForTimeout(500);

    ({ mode, step } = storyStepFromUrl(page));
    expect(mode).toBe("story");
    expect(step).toBe("race");
    await expect(page.locator(".story-root")).toBeVisible();
  });
});
