/**
 * Chrome, lane-persona accent, and settle-diff fill tokens for Sorta Fast.
 *
 * The perceptually-uniform settle gradient lives in {@link ./palette.ts};
 * this module supplies UI chrome (paper, ink, panels), lane accents
 * (marble, ember, moss), and settle-diff vertex fills (#68) per design.md section 3.6.
 */

/** Light or dark chrome palette. */
export type ThemeMode = "dark" | "light";

/**
 * Semantic color tokens for chrome, overlays, and lane persona accents.
 *
 * Values are CSS `rgb()` / `rgba()` strings ready for canvas or DOM.
 */
export type ThemeTokens = {
  /** Page / canvas background. */
  paper: string;
  /** Primary text and stroke on paper. */
  ink: string;
  /** Secondary text and de-emphasized labels. */
  muted: string;
  /** Raised panel / card surface. */
  panel: string;
  /** Dividers and subtle borders. */
  hairline: string;
  /** Interactive hover surface. */
  hover: string;
  /** Dijkstra lane accent (marble / stone). */
  marble: string;
  /** BMSSP lane accent (ember). */
  ember: string;
  /** DMSY lane accent (moss). */
  moss: string;
  /** Photo-finish and highlight gold. */
  gold: string;
  /** Active frontier overlay stroke. */
  frontier: string;
  /** Ghosted / trail overlay stroke. */
  ghost: string;
  /** Source vertex mark ring. */
  sourceMark: string;
  /** Finish vertex mark ring. */
  finishMark: string;
  /** D-structure schematic block fill (stone). */
  stoneFill: string;
  /** Settle-diff fill when only Dijkstra has settled the vertex. */
  diffMarble: string;
  /** Settle-diff fill when only BMSSP has settled the vertex. */
  diffEmber: string;
  /** Settle-diff fill when both lanes have settled the vertex. */
  diffBoth: string;
};

/** `localStorage` key for persisting the user's theme preference. */
export const THEME_STORAGE_KEY = "sorta-fast-theme";

/** Locked token sets for each {@link ThemeMode}. */
export const THEMES: Record<ThemeMode, ThemeTokens> = {
  dark: {
    paper: "rgb(22, 21, 19)",
    ink: "rgb(236, 230, 220)",
    muted: "rgb(168, 160, 148)",
    panel: "rgb(32, 30, 27)",
    hairline: "rgb(90, 86, 80)",
    hover: "rgb(42, 38, 34)",
    marble: "rgb(180, 176, 168)",
    ember: "rgb(180, 70, 40)",
    moss: "rgb(56, 128, 118)",
    gold: "rgb(212, 168, 55)",
    frontier: "rgb(236, 230, 220)",
    ghost: "rgba(236, 230, 220, 0.35)",
    sourceMark: "rgb(255, 255, 255)",
    finishMark: "rgb(212, 168, 55)",
    stoneFill: "rgb(90, 86, 80)",
    diffMarble: "rgb(180, 176, 168)",
    diffEmber: "rgb(180, 70, 40)",
    diffBoth: "rgb(160, 153, 140)",
  },
  light: {
    paper: "rgb(246, 244, 239)",
    ink: "rgb(26, 26, 26)",
    muted: "rgb(120, 112, 100)",
    panel: "rgb(255, 252, 247)",
    hairline: "rgb(180, 176, 168)",
    hover: "rgb(255, 248, 236)",
    marble: "rgb(180, 176, 168)",
    ember: "rgb(180, 70, 40)",
    moss: "rgb(56, 128, 118)",
    gold: "rgb(148, 108, 20)",
    frontier: "rgb(40, 40, 40)",
    ghost: "rgba(40, 40, 40, 0.35)",
    sourceMark: "rgb(255, 255, 255)",
    finishMark: "rgb(60, 56, 48)",
    stoneFill: "rgb(180, 176, 168)",
    diffMarble: "rgb(90, 86, 80)",
    diffEmber: "rgb(180, 70, 40)",
    diffBoth: "rgb(120, 112, 100)",
  },
};

/**
 * Comma-separated RGB channels for `rgba()` templates (BMSSP FX).
 *
 * Must remain `"180, 70, 40"` — paired with {@link THEMES} ember accent.
 */
export const EMBER_RGB = "180, 70, 40";

/** Photo-finish gold stroke color; renderer re-exports this constant. */
export const PHOTO_FINISH_GOLD = "rgb(212, 168, 55)";

/** Regex for `rgb(r, g, b)` and `rgba(r, g, b, a)` CSS color strings. */
const CSS_RGB_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/;

/**
 * Brettel/Viénot dichromacy simulation matrix for deuteranopia (linear sRGB).
 *
 * ```
 * | R' |   | 0.625  0.375  0.000 | | R |
 * | G' | = | 0.700  0.300  0.000 | | G |
 * | B' |   | 0.000  0.300  0.700 | | B |
 * ```
 */
const DEUTERANOPIA_MATRIX: readonly [number, number, number][] = [
  [0.625, 0.375, 0.0],
  [0.7, 0.3, 0.0],
  [0.0, 0.3, 0.7],
];

/**
 * Parse a persisted theme string from `localStorage`.
 *
 * @param raw - Stored value, or `null` when unset.
 * @returns `"light"` or `"dark"`; defaults to `"dark"` for missing/invalid input.
 */
export function parseStoredTheme(raw: string | null): ThemeMode {
  if (raw === "light") {
    return "light";
  }
  if (raw === "dark") {
    return "dark";
  }
  return "dark";
}

/**
 * Parse an `rgb()` or `rgba()` CSS color into 8-bit channels and alpha.
 *
 * @param cssColor - CSS color string, e.g. `"rgb(22, 21, 19)"`.
 * @returns Channel values in `0..255` and alpha in `0..1` (defaults to `1` for `rgb()`).
 * @throws {RangeError} When `cssColor` is not a valid `rgb` / `rgba` literal.
 */
export function parseRgb(cssColor: string): { r: number; g: number; b: number; a: number } {
  const match = CSS_RGB_RE.exec(cssColor.trim());
  if (match === null) {
    throw new RangeError(`parseRgb: invalid css color "${cssColor}"`);
  }

  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] === undefined ? 1 : Number(match[4]);

  if (
    r < 0 ||
    r > 255 ||
    g < 0 ||
    g > 255 ||
    b < 0 ||
    b > 255 ||
    Number.isNaN(a) ||
    a < 0 ||
    a > 1
  ) {
    throw new RangeError(`parseRgb: channel or alpha out of range in "${cssColor}"`);
  }

  return { r, g, b, a };
}

/**
 * Convert an 8-bit sRGB sample to linear light in `[0, 1]`.
 *
 * @param channel - sRGB channel `0..255`.
 */
function srgb8ToLinear(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/**
 * Encode a linear sRGB channel in `[0, 1]` to an 8-bit sample `0..255`.
 *
 * @param channel - Linear sRGB channel.
 */
function linearToSrgb8(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  let encoded: number;
  if (clamped <= 0.0031308) {
    encoded = 12.92 * clamped;
  } else {
    encoded = 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  }
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

/**
 * WCAG 2.x relative luminance of an sRGB color.
 *
 * Uses the `rgb` channels only (alpha is not composited onto a backdrop).
 *
 * @param cssColor - CSS `rgb()` / `rgba()` string.
 * @returns Relative luminance in `[0, 1]`.
 * @throws {RangeError} When `cssColor` cannot be parsed.
 */
export function relativeLuminance(cssColor: string): number {
  const { r, g, b } = parseRgb(cssColor);
  const rLin = srgb8ToLinear(r);
  const gLin = srgb8ToLinear(g);
  const bLin = srgb8ToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * WCAG 2.x contrast ratio between two sRGB colors.
 *
 * @param a - First CSS color.
 * @param b - Second CSS color.
 * @returns Contrast ratio `>= 1`.
 * @throws {RangeError} When either color cannot be parsed.
 */
export function contrastRatio(a: string, b: string): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Simulate deuteranopia (missing M-cone) on an sRGB color.
 *
 * Applies the Brettel/Viénot linear RGB matrix documented on
 * {@link DEUTERANOPIA_MATRIX}, then re-encodes to 8-bit sRGB.
 *
 * @param cssColor - CSS `rgb()` / `rgba()` string (alpha ignored).
 * @returns Simulated 8-bit sRGB channels, each clamped to `0..255`.
 * @throws {RangeError} When `cssColor` cannot be parsed.
 */
export function simulateDeuteranopia(cssColor: string): { r: number; g: number; b: number } {
  const { r, g, b } = parseRgb(cssColor);
  const rLin = srgb8ToLinear(r);
  const gLin = srgb8ToLinear(g);
  const bLin = srgb8ToLinear(b);

  const outLin: [number, number, number] = [0, 0, 0];
  for (let row = 0; row < 3; row += 1) {
    const [mR, mG, mB] = DEUTERANOPIA_MATRIX[row];
    outLin[row] = mR * rLin + mG * gLin + mB * bLin;
  }

  return {
    r: linearToSrgb8(outLin[0]),
    g: linearToSrgb8(outLin[1]),
    b: linearToSrgb8(outLin[2]),
  };
}

/**
 * Euclidean distance between two colors in 8-bit sRGB space.
 *
 * Used by tests to assert pairwise distinctness under CVD simulation.
 *
 * @param a - First CSS color.
 * @param b - Second CSS color.
 * @returns Distance in `0..441.67` (max diagonal of the RGB cube).
 * @throws {RangeError} When either color cannot be parsed.
 */
export function rgbDistance(a: string, b: string): number {
  const colorA = parseRgb(a);
  const colorB = parseRgb(b);
  const dr = colorA.r - colorB.r;
  const dg = colorA.g - colorB.g;
  const db = colorA.b - colorB.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
