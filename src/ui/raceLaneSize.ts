/**
 * Race lane backing-store size (issue #77). Live canvases use CSS × DPR; export tiles stay {@link RACE_LANE_CSS_PX}.
 */

/** Fallback / export tile edge in CSS pixels. Live Race backing store is clientWidth × dpr (#77). */
export const RACE_LANE_CSS_PX = 400;

/** Device-pixel-ratio cap so 3× displays do not explode XL ImageData buffers. */
export const RACE_LANE_DPR_CAP = 2;

/**
 * Compute the square backing-store edge in device pixels.
 *
 * @param clientWidth - Canvas CSS width (`clientWidth`). When ≤ 0, uses {@link RACE_LANE_CSS_PX}.
 * @param devicePixelRatio - `window.devicePixelRatio`; non-finite or ≤ 0 is treated as 1. Capped at {@link RACE_LANE_DPR_CAP}.
 * @returns At least 1.
 */
export function raceBackingStorePx(clientWidth: number, devicePixelRatio: number): number {
  const cssPx = clientWidth > 0 ? clientWidth : RACE_LANE_CSS_PX;
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? Math.min(devicePixelRatio, RACE_LANE_DPR_CAP)
      : 1;
  return Math.max(1, Math.round(cssPx * dpr));
}

/**
 * Set `canvas.width` and `canvas.height` to {@link raceBackingStorePx} of
 * `canvas.clientWidth` and `window.devicePixelRatio` (1 if window/dpr missing).
 * Assigns only when the edge differs (assigning width clears the bitmap).
 *
 * @param canvas - Live Race lane canvas already in the document.
 * @returns True if the backing store changed.
 */
export function applyRaceCanvasBackingStore(canvas: HTMLCanvasElement): boolean {
  let dpr = 1;
  if (typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)) {
    dpr = window.devicePixelRatio;
  }
  const edge = raceBackingStorePx(canvas.clientWidth, dpr);
  if (canvas.width === edge && canvas.height === edge) {
    return false;
  }
  canvas.width = edge;
  canvas.height = edge;
  return true;
}
