/**
 * Convert a CSS-pixel design weight to backing-store pixels (issue #79).
 *
 * Race passes `pixelScale ≈ backingPx / CSS px` (capped DPR). The renderer
 * stays resolution-agnostic and never hardcodes 400.
 */

/**
 * Validate a CSS-pixel design weight.
 *
 * @param cssPx - Design weight in CSS pixels.
 * @throws If `cssPx` is not finite.
 */
function assertFiniteCssPx(cssPx: number): void {
  if (!Number.isFinite(cssPx)) {
    throw new Error(`cssPx must be finite, got ${String(cssPx)}`);
  }
}

/**
 * Validate backing pixels per CSS pixel.
 *
 * @param pixelScale - Backing pixels per CSS pixel.
 * @throws If `pixelScale` is not finite or not > 0.
 */
function assertPixelScale(pixelScale: number): void {
  if (!Number.isFinite(pixelScale) || !(pixelScale > 0)) {
    throw new Error(`pixelScale must be a finite number > 0, got ${String(pixelScale)}`);
  }
}

/**
 * Scale a CSS-pixel length to backing-store pixels (fractional lineWidth OK).
 *
 * @param cssPx - Design weight in CSS pixels (must be finite).
 * @param pixelScale - Backing pixels per CSS pixel (must be finite and > 0).
 * @returns `cssPx * pixelScale`.
 * @throws If `cssPx` is non-finite or `pixelScale` is non-finite or <= 0.
 */
export function devicePx(cssPx: number, pixelScale: number): number {
  assertFiniteCssPx(cssPx);
  assertPixelScale(pixelScale);
  return cssPx * pixelScale;
}

/**
 * Scale a CSS-pixel length to an integer backing-store footprint.
 *
 * Used for ImageData node squares and the D-structure strip (issue #79).
 *
 * @param cssPx - Design weight in CSS pixels (must be finite).
 * @param pixelScale - Backing pixels per CSS pixel (must be finite and > 0).
 * @returns `Math.max(1, Math.round(cssPx * pixelScale))`.
 * @throws If `cssPx` is non-finite or `pixelScale` is non-finite or <= 0.
 */
export function devicePxInt(cssPx: number, pixelScale: number): number {
  assertFiniteCssPx(cssPx);
  assertPixelScale(pixelScale);
  return Math.max(1, Math.round(cssPx * pixelScale));
}
