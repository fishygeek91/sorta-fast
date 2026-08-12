/**
 * Canvas camera: fit graph layout coordinates into pixel space (issue #6).
 *
 * Vertices carry `x`/`y` from generation time; this module maps them into
 * width×height without assuming a unit-square layout (maze grids included).
 */

import { type Graph } from "../core/graph.ts";

/** Pixel-space view transform produced by {@link fitCamera}. */
export type Camera = {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly radius: number;
  readonly width: number;
  readonly height: number;
};

const DEFAULT_PADDING = 16;

/**
 * Clamp `value` to the closed interval `[lo, hi]`.
 */
function clamp(lo: number, hi: number, value: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Read `graph.x[v]`, throwing if the slot is missing (out of range or sparse).
 */
function vertexX(graph: Graph, v: number): number {
  const x = graph.x[v];
  if (x === undefined) {
    throw new Error(`graph.x[${String(v)}] is missing`);
  }
  if (!Number.isFinite(x)) {
    throw new Error(`graph.x[${String(v)}] is not finite`);
  }
  return x;
}

/**
 * Read `graph.y[v]`, throwing if the slot is missing (out of range or sparse).
 */
function vertexY(graph: Graph, v: number): number {
  const y = graph.y[v];
  if (y === undefined) {
    throw new Error(`graph.y[${String(v)}] is missing`);
  }
  if (!Number.isFinite(y)) {
    throw new Error(`graph.y[${String(v)}] is not finite`);
  }
  return y;
}

/**
 * Fit all vertices into `width`×`height` with `padding` pixels on each side.
 *
 * Does not assume unit-square coordinates (maze layouts are grid-based).
 * When every vertex shares the same point, `scale` is 1 and that point is centered.
 *
 * Vertex radius:
 * `clamp(1.5, 4, 0.35 * min(innerW, innerH) / sqrt(max(n, 1)))`
 * where `innerW = width - 2 * padding`.
 *
 * @param graph - Layout-bearing CSR graph.
 * @param width - Canvas width in pixels; integer >= 1.
 * @param height - Canvas height in pixels; integer >= 1.
 * @param padding - Inset on each side in pixels; defaults to 16; must be >= 0.
 * @throws If `graph.n === 0`, dimensions are invalid, padding is negative,
 *   inner drawable area is non-positive, or a vertex coordinate is missing.
 */
export function fitCamera(
  graph: Graph,
  width: number,
  height: number,
  padding: number = DEFAULT_PADDING,
): Camera {
  if (!Number.isInteger(width) || width < 1) {
    throw new Error(`width must be an integer >= 1, got ${String(width)}`);
  }
  if (!Number.isInteger(height) || height < 1) {
    throw new Error(`height must be an integer >= 1, got ${String(height)}`);
  }
  if (!Number.isFinite(padding) || padding < 0) {
    throw new Error(`padding must be a number >= 0, got ${String(padding)}`);
  }

  const n = graph.n;
  if (n === 0) {
    throw new Error("fitCamera: graph has no vertices (n === 0)");
  }

  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;
  if (innerW <= 0 || innerH <= 0) {
    throw new Error(
      `inner drawable area must be positive, got ${String(innerW)}×${String(innerH)} (width=${String(width)}, height=${String(height)}, padding=${String(padding)})`,
    );
  }

  let minX = vertexX(graph, 0);
  let maxX = minX;
  let minY = vertexY(graph, 0);
  let maxY = minY;

  for (let v = 1; v < n; v += 1) {
    const x = vertexX(graph, v);
    const y = vertexY(graph, v);
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;

  let scale: number;
  if (spanX === 0 && spanY === 0) {
    scale = 1;
  } else {
    const scaleX = spanX > 0 ? innerW / spanX : Number.POSITIVE_INFINITY;
    const scaleY = spanY > 0 ? innerH / spanY : Number.POSITIVE_INFINITY;
    scale = Math.min(scaleX, scaleY);
  }

  const offsetX = padding + (innerW - spanX * scale) / 2 - minX * scale;
  const offsetY = padding + (innerH - spanY * scale) / 2 - minY * scale;

  const radius = clamp(1.5, 4, (0.35 * Math.min(innerW, innerH)) / Math.sqrt(Math.max(n, 1)));

  return {
    scale,
    offsetX,
    offsetY,
    radius,
    width,
    height,
  };
}

/**
 * Map a layout `x` coordinate to canvas pixels.
 *
 * Equivalent to `offsetX + (x - minX) * scale` with `minX` baked into `offsetX`.
 */
export function projectX(camera: Camera, x: number): number {
  return camera.offsetX + x * camera.scale;
}

/**
 * Map a layout `y` coordinate to canvas pixels.
 *
 * Equivalent to `offsetY + (y - minY) * scale` with `minY` baked into `offsetY`.
 */
export function projectY(camera: Camera, y: number): number {
  return camera.offsetY + y * camera.scale;
}
