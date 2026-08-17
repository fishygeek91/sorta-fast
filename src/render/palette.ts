/**
 * Settle-order color palette for Sorta Fast.
 *
 * Perceptually uniform, colorblind-safe gradient baked from OKLCH (fixed L/C,
 * hue sweep blue → gold). Used by the canvas fill layer so settle order reads
 * clearly in still screenshots as well as during replay.
 */

/** Number of precomputed LUT entries along the gradient. */
export const PALETTE_STOPS = 256;

/** OKLab lightness for every stop (perceptually uniform sweep). */
const PALETTE_L = 0.72;

/** OKLCH chroma — moderate saturation, cividis-like legibility. */
const PALETTE_C = 0.12;

/** Hue at t = 0 (blue, degrees). */
const PALETTE_HUE_START_DEG = 250;

/** Hue at t = 1 (gold, degrees). */
const PALETTE_HUE_END_DEG = 80;

/**
 * Clamp `value` into `[min, max]`.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Encode one linear sRGB channel in `[0, 1]` to an 8-bit sRGB sample `0..255`.
 */
function linearToSrgb8(channel: number): number {
  const clamped = clamp(channel, 0, 1);
  let encoded: number;
  if (clamped <= 0.0031308) {
    encoded = 12.92 * clamped;
  } else {
    encoded = 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  }
  return Math.round(clamp(encoded, 0, 1) * 255);
}

/**
 * Convert OKLCH (Björn Ottosson OKLab space) to 8-bit sRGB bytes.
 *
 * @param l - OKLab lightness in `[0, 1]`.
 * @param c - OKLCH chroma.
 * @param hueDeg - OKLCH hue in degrees.
 */
function oklchToSrgbBytes(
  l: number,
  c: number,
  hueDeg: number,
): { r: number; g: number; b: number } {
  const hueRad = (hueDeg * Math.PI) / 180;
  const a = c * Math.cos(hueRad);
  const b = c * Math.sin(hueRad);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const lCubed = lPrime * lPrime * lPrime;
  const mCubed = mPrime * mPrime * mPrime;
  const sCubed = sPrime * sPrime * sPrime;

  const rLin = 4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed;
  const gLin = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed;
  const bLin = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed;

  return {
    r: linearToSrgb8(rLin),
    g: linearToSrgb8(gLin),
    b: linearToSrgb8(bLin),
  };
}

/**
 * Pack 8-bit sRGB channels into `0xRRGGBB` (no alpha).
 */
function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

/**
 * Unpack `0xRRGGBB` into `{ r, g, b }` each `0..255`.
 */
function unpackRgb(packed: number): { r: number; g: number; b: number } {
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  };
}

/**
 * Build the deterministic 256-stop sRGB LUT from OKLCH parameters.
 */
function buildPaletteLut(): Uint32Array {
  const lut = new Uint32Array(PALETTE_STOPS);
  const hueSpan = PALETTE_HUE_END_DEG - PALETTE_HUE_START_DEG;
  const lastIndex = PALETTE_STOPS - 1;

  for (let i = 0; i < PALETTE_STOPS; i++) {
    const t = i / lastIndex;
    const hueDeg = PALETTE_HUE_START_DEG + t * hueSpan;
    const { r, g, b } = oklchToSrgbBytes(PALETTE_L, PALETTE_C, hueDeg);
    lut[i] = packRgb(r, g, b);
  }

  return lut;
}

/** Precomputed packed RGB LUT; indexed by `round(t * (PALETTE_STOPS - 1))`. */
const PALETTE_LUT = buildPaletteLut();

/**
 * Validate settle-order inputs.
 *
 * @throws {RangeError} when `order` or `n` are not integers in the required range.
 */
function assertSettleOrderInputs(order: number, n: number): void {
  if (!Number.isInteger(order) || order < 0) {
    throw new RangeError(`order must be an integer >= 0, got ${order}`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`n must be an integer >= 1, got ${n}`);
  }
}

/**
 * Map settle order to gradient parameter `t` in `[0, 1]`.
 *
 * `t = order / max(1, n - 1)` keeps endpoint colors stable as `n` grows during
 * playback (first vertex always blue, last always gold when `n > 1`).
 */
function settleGradientT(order: number, n: number): number {
  assertSettleOrderInputs(order, n);
  const denom = Math.max(1, n - 1);
  return order / denom;
}

/**
 * `t` in `[0, 1]` → packed `0xRRGGBB` (no alpha).
 *
 * Out-of-range `t` is clamped before indexing the LUT.
 */
export function rgbAt(t: number): number {
  const clamped = clamp(t, 0, 1);
  const index = Math.round(clamped * (PALETTE_STOPS - 1));
  const packed = PALETTE_LUT[index];
  if (packed === undefined) {
    throw new Error(`palette LUT index ${String(index)} is missing`);
  }
  return packed;
}

/**
 * Settle-order color. `t = order / max(1, n - 1)` so colors stay stable during playback.
 *
 * @param order - Vertex settle index; must be integer `>= 0`.
 * @param n - Total vertices in the graph; must be integer `>= 1`.
 * @returns CSS `rgb(r, g, b)` string with integer channels.
 * @throws {RangeError} when `order` or `n` fail validation.
 */
export function cssColorForSettleOrder(order: number, n: number): string {
  const { r, g, b } = rgbForSettleOrder(order, n);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Same mapping as {@link cssColorForSettleOrder}, returns `{ r, g, b }` each `0..255`.
 *
 * @param order - Vertex settle index; must be integer `>= 0`.
 * @param n - Total vertices in the graph; must be integer `>= 1`.
 * @throws {RangeError} when `order` or `n` fail validation.
 */
export function rgbForSettleOrder(order: number, n: number): { r: number; g: number; b: number } {
  const t = settleGradientT(order, n);
  return unpackRgb(rgbAt(t));
}

/** Deterministic integer mix for subtree id → LUT index (issue #27). */
const SUBTREE_MIX = 2654435761;

/**
 * Map a DMSY forest subtree id to a LUT index in `[0, PALETTE_STOPS)`.
 *
 * @param tree - Non-negative integer subtree / search id.
 * @throws {RangeError} when `tree` is not a non-negative integer.
 */
function subtreeLutIndex(tree: number): number {
  if (!Number.isInteger(tree) || tree < 0) {
    throw new RangeError(`tree must be a non-negative integer, got ${tree}`);
  }
  return ((tree * SUBTREE_MIX) >>> 0) % PALETTE_STOPS;
}

/**
 * Patchwork fill color for a DMSY subtree id — same LUT as settle order, keyed by tree.
 *
 * @param tree - Non-negative integer subtree / search id.
 * @returns CSS `rgb(r, g, b)` string with integer channels.
 * @throws {RangeError} when `tree` is not a non-negative integer.
 */
export function cssColorForSubtree(tree: number): string {
  const { r, g, b } = rgbForSubtree(tree);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Same mapping as {@link cssColorForSubtree}, returns `{ r, g, b }` each `0..255`.
 *
 * @param tree - Non-negative integer subtree / search id.
 * @throws {RangeError} when `tree` is not a non-negative integer.
 */
export function rgbForSubtree(tree: number): { r: number; g: number; b: number } {
  const index = subtreeLutIndex(tree);
  const t = index / (PALETTE_STOPS - 1);
  return unpackRgb(rgbAt(t));
}
