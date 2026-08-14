/**
 * Race standing Playwright smoke test (GitHub issue #63).
 *
 * Verifies photo-finish banner and winner chip visibility after seek-to-end on a
 * small race URL without importing app modules — Playwright cannot resolve the
 * repo's `.ts` extension imports.
 */

import { test, expect, type Page } from "@playwright/test";

/** Small race preset — city / 500 / seed 1729 (same graph as story pedagogical preset). */
const RACE_PATH = "?mode=race&g=city&n=500&seed=1729";

/** Winner chip label from {@link WINNER_CHIP_TEXT} in src/ui/race.ts */
const WINNER_CHIP_TEXT = "Winner — lowest work";

/**
 * Wait until Race chrome mounts (Skip end visible) and no worker error is shown.
 * `.lens-status` stays hidden unless a worker reports an error. Photo-finish
 * readiness is handled by {@link seekPhotoFinish}.
 */
async function waitRaceReady(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Skip end" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".lens-status")).toBeHidden();
}

/**
 * Retry Skip end until photo-finish freeze completes (`allPhotoFrozen` in race.ts).
 * `#race-export-png` enables only when every lane is photo-frozen.
 */
async function seekPhotoFinish(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole("button", { name: "Skip end" }).click();
    await expect(page.locator("#race-export-png")).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 90_000 });
}

test.describe("Race standing (#63)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("photo-finish banner and winner chip are visible at 1440x900", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(RACE_PATH);

    await waitRaceReady(page);
    await seekPhotoFinish(page);

    const banner = page.locator(".race-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toBeInViewport();

    const winnerChips = page.locator(".race-lane-winner:not([hidden])");
    await expect(winnerChips).toHaveCount(1);
    await expect(winnerChips).toHaveText(WINNER_CHIP_TEXT);

    await expect(banner).toHaveText(/beat/);
    await expect(banner).toHaveText(/comparisons on this graph/);
  });
});
