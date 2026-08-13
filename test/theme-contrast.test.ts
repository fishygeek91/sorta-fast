import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  rgbDistance,
  simulateDeuteranopia,
  THEMES,
  type ThemeMode,
} from "../src/render/theme.ts";

/** Minimum WCAG AA contrast for normal body text on paper. */
const INK_ON_PAPER_MIN = 4.5;

/** Minimum WCAG AA contrast for large / de-emphasized text on paper. */
const MUTED_ON_PAPER_MIN = 3;

/** Minimum contrast for gold highlights on paper. */
const GOLD_ON_PAPER_MIN = 3;

/** Minimum contrast for ink on raised panels. */
const INK_ON_PANEL_MIN = 4.5;

/** Locked pairwise sRGB distance floor between CVD-simulated lane accents. */
const CVD_PAIRWISE_MIN_DISTANCE = 40;

/**
 * Encode simulated 8-bit sRGB channels as a CSS `rgb()` string.
 *
 * @param channels - Simulated red, green, and blue samples.
 */
function channelsToRgb(channels: { r: number; g: number; b: number }): string {
  return `rgb(${channels.r}, ${channels.g}, ${channels.b})`;
}

describe("theme contrast", () => {
  const modes: ThemeMode[] = ["dark", "light"];

  for (const mode of modes) {
    describe(`${mode} mode`, () => {
      const tokens = THEMES[mode];

      it("ink on paper meets WCAG AA body text contrast", () => {
        expect(contrastRatio(tokens.ink, tokens.paper)).toBeGreaterThanOrEqual(INK_ON_PAPER_MIN);
      });

      it("muted on paper meets WCAG AA large-text contrast", () => {
        expect(contrastRatio(tokens.muted, tokens.paper)).toBeGreaterThanOrEqual(
          MUTED_ON_PAPER_MIN,
        );
      });

      it("gold on paper meets highlight contrast floor", () => {
        expect(contrastRatio(tokens.gold, tokens.paper)).toBeGreaterThanOrEqual(GOLD_ON_PAPER_MIN);
      });

      it("ink on panel meets WCAG AA body text contrast", () => {
        expect(contrastRatio(tokens.ink, tokens.panel)).toBeGreaterThanOrEqual(INK_ON_PANEL_MIN);
      });
    });
  }

  describe("deuteranopia lane accent distinctness", () => {
    it("marble, ember, and moss remain pairwise distinct after CVD simulation", () => {
      const accents = ["marble", "ember", "moss"] as const;
      const simulated = accents.map((key) => channelsToRgb(simulateDeuteranopia(THEMES.dark[key])));

      expect(rgbDistance(simulated[0], simulated[1])).toBeGreaterThanOrEqual(
        CVD_PAIRWISE_MIN_DISTANCE,
      );
      expect(rgbDistance(simulated[0], simulated[2])).toBeGreaterThanOrEqual(
        CVD_PAIRWISE_MIN_DISTANCE,
      );
      expect(rgbDistance(simulated[1], simulated[2])).toBeGreaterThanOrEqual(
        CVD_PAIRWISE_MIN_DISTANCE,
      );
    });
  });
});
