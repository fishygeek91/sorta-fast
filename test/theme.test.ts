import { describe, expect, it } from "vitest";

import {
  EMBER_RGB,
  parseRgb,
  parseStoredTheme,
  PHOTO_FINISH_GOLD,
  rgbDistance,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeTokens,
} from "../src/render/theme.ts";

/** All semantic token keys on {@link ThemeTokens}. */
const THEME_TOKEN_KEYS: (keyof ThemeTokens)[] = [
  "paper",
  "ink",
  "muted",
  "panel",
  "hairline",
  "hover",
  "marble",
  "ember",
  "moss",
  "gold",
  "frontier",
  "ghost",
  "sourceMark",
  "finishMark",
  "stoneFill",
];

/** Matches `rgb(r, g, b)` and `rgba(r, g, b, a)` CSS literals. */
const CSS_RGB_STRING_RE = /^rgba?\(\d{1,3}, \d{1,3}, \d{1,3}(, [\d.]+)?\)$/;

describe("theme", () => {
  describe("parseStoredTheme", () => {
    it("accepts dark", () => {
      expect(parseStoredTheme("dark")).toBe("dark");
    });

    it("accepts light", () => {
      expect(parseStoredTheme("light")).toBe("light");
    });

    it("defaults to dark for null, empty, system, and case-mismatched values", () => {
      expect(parseStoredTheme(null)).toBe("dark");
      expect(parseStoredTheme("")).toBe("dark");
      expect(parseStoredTheme("system")).toBe("dark");
      expect(parseStoredTheme("LIGHT")).toBe("dark");
    });
  });

  describe("THEMES", () => {
    it("dark palette exposes every ThemeTokens key as rgb()/rgba() strings", () => {
      for (const key of THEME_TOKEN_KEYS) {
        expect(THEMES.dark[key]).toMatch(CSS_RGB_STRING_RE);
      }
    });

    it("light palette exposes every ThemeTokens key as rgb()/rgba() strings", () => {
      for (const key of THEME_TOKEN_KEYS) {
        expect(THEMES.light[key]).toMatch(CSS_RGB_STRING_RE);
      }
    });

    it("locks paper backgrounds per mode", () => {
      expect(THEMES.dark.paper).toBe("rgb(22, 21, 19)");
      expect(THEMES.light.paper).toBe("rgb(246, 244, 239)");
    });

    it("shares lane accent colors across modes", () => {
      expect(THEMES.dark.marble).toBe("rgb(180, 176, 168)");
      expect(THEMES.dark.ember).toBe("rgb(180, 70, 40)");
      expect(THEMES.dark.moss).toBe("rgb(56, 128, 118)");
      expect(THEMES.light.marble).toBe("rgb(180, 176, 168)");
      expect(THEMES.light.ember).toBe("rgb(180, 70, 40)");
      expect(THEMES.light.moss).toBe("rgb(56, 128, 118)");
    });
  });

  describe("constants", () => {
    it("exports BMSSP ember channel template", () => {
      expect(EMBER_RGB).toBe("180, 70, 40");
    });

    it("exports photo-finish gold stroke", () => {
      expect(PHOTO_FINISH_GOLD).toBe("rgb(212, 168, 55)");
    });

    it("exports localStorage key", () => {
      expect(THEME_STORAGE_KEY).toBe("sorta-fast-theme");
    });
  });

  describe("parseRgb", () => {
    it("throws RangeError on garbage input", () => {
      expect(() => parseRgb("not-a-color")).toThrow(RangeError);
    });

    it("parses rgb() with implicit alpha 1", () => {
      expect(parseRgb("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    });

    it("parses rgba() with explicit alpha", () => {
      expect(parseRgb("rgba(10, 20, 30, 0.5)")).toEqual({
        r: 10,
        g: 20,
        b: 30,
        a: 0.5,
      });
    });
  });

  describe("rgbDistance", () => {
    it("returns 0 for identical colors", () => {
      expect(rgbDistance("rgb(100, 120, 140)", "rgb(100, 120, 140)")).toBe(0);
    });
  });
});
