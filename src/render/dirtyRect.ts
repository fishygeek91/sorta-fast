/**
 * Inclusive pixel AABB dirty-rect accumulator for Canvas2D settle-fill batching (issue #6).
 *
 * Unions per-node circle bounds clipped to the canvas; falls back to a full redraw
 * when the hit cap is exceeded. No algorithm or trace imports.
 */

/** Inclusive pixel AABB. If `full` is true, redraw the whole canvas. */
export type DirtyRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  full: boolean;
  /** How many includeNode calls since last reset (for the cap). */
  hits: number;
};

/** After this many {@link includeNode} calls since reset, the rect becomes full. */
export const DIRTY_HIT_CAP = 256;

/**
 * Validate canvas dimension arguments shared by {@link markFull} and {@link includeNode}.
 *
 * @throws If `value` is not an integer >= 1.
 */
function assertCanvasDimension(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer >= 1, got ${String(value)}`);
  }
}

/**
 * Validate circle center coordinates.
 *
 * @throws If `cx` or `cy` is not finite.
 */
function assertCenter(cx: number, cy: number): void {
  if (!Number.isFinite(cx)) {
    throw new Error(`cx must be finite, got ${String(cx)}`);
  }
  if (!Number.isFinite(cy)) {
    throw new Error(`cy must be finite, got ${String(cy)}`);
  }
}

/**
 * Validate node draw radius.
 *
 * @throws If `radius` is not finite or not > 0.
 */
function assertRadius(radius: number): void {
  if (!Number.isFinite(radius) || !(radius > 0)) {
    throw new Error(`radius must be a finite number > 0, got ${String(radius)}`);
  }
}

/**
 * True when the dirty rect carries no pixel bounds yet (`w === 0` and `h === 0`).
 */
function isEmptyDirty(dirty: DirtyRect): boolean {
  return dirty.w === 0 && dirty.h === 0;
}

/**
 * Inclusive pixel AABB for a node circle with one pixel of padding, clipped to the canvas.
 *
 * Bounds are `(cx ± radius + 1)` on each axis, floored to integer pixels and clipped to
 * `[0, canvasWidth) × [0, canvasHeight)`.
 *
 * @returns Clipped inclusive min/max, or `null` when the node lies entirely outside the canvas.
 */
function clippedNodeAabb(
  cx: number,
  cy: number,
  radius: number,
  canvasWidth: number,
  canvasHeight: number,
): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const x1 = Math.min(canvasWidth - 1, Math.floor(cx + radius + 1));
  const y1 = Math.min(canvasHeight - 1, Math.floor(cy + radius + 1));

  if (x0 > x1 || y0 > y1) {
    return null;
  }

  return { x0, y0, x1, y1 };
}

/**
 * Create an empty dirty rect (`x=0`, `y=0`, `w=0`, `h=0`, `full=false`, `hits=0`).
 */
export function createDirtyRect(): DirtyRect {
  return {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    full: false,
    hits: 0,
  };
}

/**
 * Reset `dirty` to empty (`w=0`, `h=0`, `full=false`, `hits=0`).
 */
export function resetDirty(dirty: DirtyRect): void {
  dirty.x = 0;
  dirty.y = 0;
  dirty.w = 0;
  dirty.h = 0;
  dirty.full = false;
  dirty.hits = 0;
}

/**
 * Mark the entire canvas dirty for the next redraw.
 *
 * @param canvasWidth - Canvas width in pixels; integer >= 1.
 * @param canvasHeight - Canvas height in pixels; integer >= 1.
 * @throws If either dimension is not an integer >= 1.
 */
export function markFull(dirty: DirtyRect, canvasWidth: number, canvasHeight: number): void {
  assertCanvasDimension("canvasWidth", canvasWidth);
  assertCanvasDimension("canvasHeight", canvasHeight);

  dirty.x = 0;
  dirty.y = 0;
  dirty.w = canvasWidth;
  dirty.h = canvasHeight;
  dirty.full = true;
}

/**
 * Union the node's circle AABB (`cx ± radius + 1`, `cy ± radius + 1`) clipped to the canvas.
 *
 * The first call after {@link resetDirty} sets the rect to that node's bounds; later calls
 * expand the inclusive min/max. When `hits` exceeds {@link DIRTY_HIT_CAP}, {@link markFull}
 * is invoked instead.
 *
 * @param cx - Node center x in canvas pixels.
 * @param cy - Node center y in canvas pixels.
 * @param radius - Node draw radius in pixels; must be > 0.
 * @param canvasWidth - Canvas width in pixels; integer >= 1.
 * @param canvasHeight - Canvas height in pixels; integer >= 1.
 * @throws If canvas dimensions or `radius` are invalid, or `cx`/`cy` are not finite.
 */
export function includeNode(
  dirty: DirtyRect,
  cx: number,
  cy: number,
  radius: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  assertCanvasDimension("canvasWidth", canvasWidth);
  assertCanvasDimension("canvasHeight", canvasHeight);
  assertRadius(radius);
  assertCenter(cx, cy);

  dirty.hits += 1;

  if (dirty.full) {
    return;
  }

  if (dirty.hits > DIRTY_HIT_CAP) {
    markFull(dirty, canvasWidth, canvasHeight);
    return;
  }

  const aabb = clippedNodeAabb(cx, cy, radius, canvasWidth, canvasHeight);
  if (aabb === null) {
    return;
  }

  if (isEmptyDirty(dirty)) {
    dirty.x = aabb.x0;
    dirty.y = aabb.y0;
    dirty.w = aabb.x1 - aabb.x0 + 1;
    dirty.h = aabb.y1 - aabb.y0 + 1;
    return;
  }

  const unionX0 = Math.min(dirty.x, aabb.x0);
  const unionY0 = Math.min(dirty.y, aabb.y0);
  const unionX1 = Math.max(dirty.x + dirty.w - 1, aabb.x1);
  const unionY1 = Math.max(dirty.y + dirty.h - 1, aabb.y1);

  dirty.x = unionX0;
  dirty.y = unionY0;
  dirty.w = unionX1 - unionX0 + 1;
  dirty.h = unionY1 - unionY0 + 1;
}
