/**
 * Layered Canvas2D renderer: static edges, dirty-rect settle fills, frontier overlay (issue #6).
 *
 * Consumes {@link LaneState} only — no algorithm or trace imports.
 */

import { type Graph } from "../core/graph.ts";
import { LaneState, UNSETTLED } from "../harness/laneState.ts";
import { fitCamera, projectX, projectY, type Camera } from "./camera.ts";
import { createDirtyRect, includeNode, markFull, resetDirty, type DirtyRect } from "./dirtyRect.ts";
import { cssColorForSettleOrder } from "./palette.ts";
import { type CanvasSurface, type DrawContext, type SurfaceFactory } from "./surface.ts";

/** Paper background behind the graph. */
const PAPER_BG = "rgb(246, 244, 239)";

/** Static edge stroke color. */
const EDGE_STROKE = "rgb(180, 176, 168)";

/** Frontier ring stroke color. */
const FRONTIER_STROKE = "rgb(40, 40, 40)";

/** Edge line width in pixels. */
const EDGE_LINE_WIDTH = 1;

/** Frontier ring line width in pixels. */
const FRONTIER_LINE_WIDTH = 1.5;

/** Full circle arc in radians. */
const TAU = Math.PI * 2;

/**
 * Obtain a 2D draw context from `surface`, throwing when unavailable.
 *
 * @throws If `surface.getContext("2d")` returns null.
 */
function requireContext(surface: CanvasSurface, label: string): DrawContext {
  const ctx = surface.getContext("2d");
  if (ctx === null) {
    throw new Error(`${label}: 2d context is unavailable`);
  }
  return ctx;
}

/**
 * Read `graph.x[v]`, throwing when the slot is missing or non-finite.
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
 * Read `graph.y[v]`, throwing when the slot is missing or non-finite.
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
 * Read CSR `offsets[i]`, throwing when the slot is missing.
 */
function offsetAt(offsets: Uint32Array, i: number): number {
  const value = offsets[i];
  if (value === undefined) {
    throw new Error(`offsets[${String(i)}] is missing`);
  }
  return value;
}

/**
 * Read CSR `targets[e]`, throwing when the slot is missing.
 */
function targetAt(targets: Uint32Array, e: number): number {
  const value = targets[e];
  if (value === undefined) {
    throw new Error(`targets[${String(e)}] is missing`);
  }
  return value;
}

/**
 * Layered Canvas2D renderer for one race lane.
 */
export class Renderer {
  private readonly target: CanvasSurface;
  private graph: Graph;
  private camera: Camera;
  private readonly edgeLayer: CanvasSurface;
  private readonly fillLayer: CanvasSurface;
  private readonly overlayLayer: CanvasSurface;
  private lastSettle: Int32Array;
  private readonly dirty: DirtyRect;

  /**
   * @param opts.target - On-screen canvas surface.
   * @param opts.createSurface - Factory for offscreen layers (DOM or test fake).
   * @param opts.graph - Initial CSR graph with layout coordinates.
   */
  constructor(opts: { target: CanvasSurface; createSurface: SurfaceFactory; graph: Graph }) {
    this.target = opts.target;
    this.graph = opts.graph;
    this.dirty = createDirtyRect();
    this.lastSettle = new Int32Array(opts.graph.n);
    this.lastSettle.fill(UNSETTLED);

    const width = opts.target.width;
    const height = opts.target.height;
    this.camera = fitCamera(opts.graph, width, height);

    this.edgeLayer = opts.createSurface(width, height);
    this.fillLayer = opts.createSurface(width, height);
    this.overlayLayer = opts.createSurface(width, height);

    this.drawEdgeLayer();
    this.clearFillLayer();
  }

  /**
   * Replace the graph, rebuild the camera and edge layer, and mark a full redraw.
   */
  setGraph(graph: Graph): void {
    this.graph = graph;
    this.camera = fitCamera(graph, this.target.width, this.target.height);
    this.lastSettle = new Int32Array(graph.n);
    this.lastSettle.fill(UNSETTLED);
    resetDirty(this.dirty);
    markFull(this.dirty, this.target.width, this.target.height);
    this.drawEdgeLayer();
    this.clearFillLayer();
  }

  /**
   * Draw lane state. Diff against last drawn `settleOrder`:
   * - new settles: fill circles with {@link cssColorForSettleOrder}, `includeNode` dirty
   * - any unsettle: clear fill layer, redraw ALL settled nodes, `markFull`
   *
   * Frontier overlay: clear overlay, draw rings for `frontier[v] === 1`, always composite overlay.
   * Composite onto target: edges, then fill (dirty source rect), then overlay.
   * First draw or after {@link setGraph}: full composite.
   */
  draw(state: LaneState): void {
    if (state.n !== this.graph.n) {
      throw new Error(
        `lane vertex count ${String(state.n)} does not match graph n ${String(this.graph.n)}`,
      );
    }

    const n = state.n;
    const width = this.target.width;
    const height = this.target.height;

    let hadUnsettle = false;
    for (let v = 0; v < n; v += 1) {
      const prev = this.lastSettle[v];
      const cur = state.settleOrder[v];
      if (prev === undefined || cur === undefined) {
        throw new Error(`settleOrder[${String(v)}] is missing`);
      }
      if (prev !== UNSETTLED && cur === UNSETTLED) {
        hadUnsettle = true;
        break;
      }
    }

    const fillCtx = requireContext(this.fillLayer, "fillLayer");

    if (hadUnsettle) {
      this.clearFillLayer();
      markFull(this.dirty, width, height);
      for (let v = 0; v < n; v += 1) {
        const order = state.settleOrder[v];
        if (order === undefined) {
          throw new Error(`settleOrder[${String(v)}] is missing`);
        }
        if (order !== UNSETTLED) {
          this.drawSettledNode(fillCtx, v, order, n);
        }
      }
    } else {
      for (let v = 0; v < n; v += 1) {
        const prev = this.lastSettle[v];
        const order = state.settleOrder[v];
        if (prev === undefined || order === undefined) {
          throw new Error(`settleOrder[${String(v)}] is missing`);
        }
        if (prev === UNSETTLED && order !== UNSETTLED) {
          this.drawSettledNode(fillCtx, v, order, n);
        }
      }
    }

    this.drawFrontierOverlay(state);

    this.compositeToTarget();

    for (let v = 0; v < n; v += 1) {
      const order = state.settleOrder[v];
      if (order === undefined) {
        throw new Error(`settleOrder[${String(v)}] is missing`);
      }
      this.lastSettle[v] = order;
    }

    resetDirty(this.dirty);
  }

  /**
   * Paint the static edge bitmap (paper background + CSR edges).
   */
  private drawEdgeLayer(): void {
    const ctx = requireContext(this.edgeLayer, "edgeLayer");
    const graph = this.graph;
    const camera = this.camera;
    const width = this.edgeLayer.width;
    const height = this.edgeLayer.height;

    ctx.fillStyle = PAPER_BG;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = EDGE_STROKE;
    ctx.lineWidth = EDGE_LINE_WIDTH;
    ctx.beginPath();

    const n = graph.n;
    const offsets = graph.offsets;
    const targets = graph.targets;

    for (let v = 0; v < n; v += 1) {
      const start = offsetAt(offsets, v);
      const end = offsetAt(offsets, v + 1);
      const x0 = projectX(camera, vertexX(graph, v));
      const y0 = projectY(camera, vertexY(graph, v));

      for (let e = start; e < end; e += 1) {
        const t = targetAt(targets, e);
        const x1 = projectX(camera, vertexX(graph, t));
        const y1 = projectY(camera, vertexY(graph, t));
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
    }

    ctx.stroke();
  }

  /**
   * Clear the settle-fill layer to transparent.
   */
  private clearFillLayer(): void {
    const ctx = requireContext(this.fillLayer, "fillLayer");
    ctx.clearRect(0, 0, this.fillLayer.width, this.fillLayer.height);
  }

  /**
   * Fill one settled vertex circle on the fill layer and expand the dirty rect.
   */
  private drawSettledNode(ctx: DrawContext, v: number, order: number, n: number): void {
    const graph = this.graph;
    const camera = this.camera;
    const cx = projectX(camera, vertexX(graph, v));
    const cy = projectY(camera, vertexY(graph, v));
    const radius = camera.radius;

    ctx.fillStyle = cssColorForSettleOrder(order, n);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();

    includeNode(this.dirty, cx, cy, radius, this.target.width, this.target.height);
  }

  /**
   * Redraw the frontier ring overlay for the current lane state.
   */
  private drawFrontierOverlay(state: LaneState): void {
    const ctx = requireContext(this.overlayLayer, "overlayLayer");
    const graph = this.graph;
    const camera = this.camera;
    const width = this.overlayLayer.width;
    const height = this.overlayLayer.height;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = FRONTIER_STROKE;
    ctx.lineWidth = FRONTIER_LINE_WIDTH;

    const n = state.n;
    const frontier = state.frontier;

    for (let v = 0; v < n; v += 1) {
      const onFrontier = frontier[v];
      if (onFrontier === undefined) {
        throw new Error(`frontier[${String(v)}] is missing`);
      }
      if (onFrontier !== 1) {
        continue;
      }

      const cx = projectX(camera, vertexX(graph, v));
      const cy = projectY(camera, vertexY(graph, v));
      ctx.beginPath();
      ctx.arc(cx, cy, camera.radius, 0, TAU);
      ctx.stroke();
    }
  }

  /**
   * Blit edge, fill, and overlay layers onto the target canvas.
   *
   * Always a full three-layer composite so frontier rings do not accumulate
   * (transparent overlay pixels would not erase stale rings under alpha blit).
   * Dirty-rect batching still applies to fill-layer painting, not the blit.
   */
  private compositeToTarget(): void {
    const targetCtx = requireContext(this.target, "target");
    const width = this.target.width;
    const height = this.target.height;

    targetCtx.fillStyle = PAPER_BG;
    targetCtx.fillRect(0, 0, width, height);
    targetCtx.drawImage(this.edgeLayer, 0, 0, width, height, 0, 0, width, height);
    targetCtx.drawImage(this.fillLayer, 0, 0, width, height, 0, 0, width, height);
    targetCtx.drawImage(this.overlayLayer, 0, 0, width, height, 0, 0, width, height);
  }
}
