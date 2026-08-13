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

/** Ghost relaxed-edge stroke color (muted, distinct from static edges). */
const GHOST_STROKE = "rgba(40, 40, 40, 0.35)";

/** Ghost edge line width in pixels. */
const GHOST_LINE_WIDTH = 1.5;

/** Full circle arc in radians. */
const TAU = Math.PI * 2;

/** Ghost trail window in billed ops (scrub-safe; not wall-clock). */
export const GHOST_WINDOW_OPS = 10_000;

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
 * Build CSR edge index → source vertex lookup for O(1) ghost endpoint resolution.
 */
function buildSrcOfEdge(graph: Graph): Uint32Array {
  const srcOfEdge = new Uint32Array(graph.m);
  const n = graph.n;
  const offsets = graph.offsets;
  for (let v = 0; v < n; v += 1) {
    const start = offsetAt(offsets, v);
    const end = offsetAt(offsets, v + 1);
    for (let e = start; e < end; e += 1) {
      srcOfEdge[e] = v;
    }
  }
  return srcOfEdge;
}

/**
 * Resolve overlay toggles: omitted argument or missing keys default to enabled.
 */
function resolveOverlayFlags(overlays?: { frontier?: boolean; relaxedEdges?: boolean }): {
  frontier: boolean;
  relaxedEdges: boolean;
} {
  return {
    frontier: overlays?.frontier !== false,
    relaxedEdges: overlays?.relaxedEdges !== false,
  };
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
  private lastFrontier: Uint8Array;
  private srcOfEdge: Uint32Array;
  private lastGhost: Uint8Array;
  private lastFrontierOverlay: boolean;
  private lastRelaxedEdgesOverlay: boolean;
  private readonly dirty: DirtyRect;
  /** True until the first composite or after {@link setGraph}; forces a full three-layer blit. */
  private needsFullComposite: boolean;

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
    this.lastFrontier = new Uint8Array(opts.graph.n);
    this.srcOfEdge = buildSrcOfEdge(opts.graph);
    this.lastGhost = new Uint8Array(opts.graph.m);
    this.lastFrontierOverlay = true;
    this.lastRelaxedEdgesOverlay = true;
    this.needsFullComposite = true;

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
    this.lastFrontier = new Uint8Array(graph.n);
    this.srcOfEdge = buildSrcOfEdge(graph);
    this.lastGhost = new Uint8Array(graph.m);
    this.needsFullComposite = true;
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
   * Overlay pass: clear overlay, optionally draw frontier rings and relaxed-edge ghost trails.
   * Dirty frontier and ghost changes expand the dirty rect before overlay paint.
   * Composite onto target: full blit on first frame, {@link setGraph}, unsettle, or hit cap;
   * otherwise blit only the dirty rect (edges + fill + overlay).
   *
   * @param overlays - Optional toggles; omitted keys default to enabled (frontier on, ghosts on).
   */
  draw(state: LaneState, overlays?: { frontier?: boolean; relaxedEdges?: boolean }): void {
    if (state.n !== this.graph.n) {
      throw new Error(
        `lane vertex count ${String(state.n)} does not match graph n ${String(this.graph.n)}`,
      );
    }
    if (state.m !== this.graph.m) {
      throw new Error(
        `lane edge count ${String(state.m)} does not match graph m ${String(this.graph.m)}`,
      );
    }

    const n = state.n;
    const m = state.m;
    const width = this.target.width;
    const height = this.target.height;
    const { frontier: frontierEnabled, relaxedEdges: relaxedEdgesEnabled } =
      resolveOverlayFlags(overlays);

    if (
      frontierEnabled !== this.lastFrontierOverlay ||
      relaxedEdgesEnabled !== this.lastRelaxedEdgesOverlay
    ) {
      markFull(this.dirty, width, height);
      this.needsFullComposite = true;
    }

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

    for (let v = 0; v < n; v += 1) {
      const prevFrontier = this.lastFrontier[v];
      const curFrontier = state.frontier[v];
      if (prevFrontier === undefined || curFrontier === undefined) {
        throw new Error(`frontier[${String(v)}] is missing`);
      }
      if (prevFrontier !== curFrontier) {
        this.includeVertexDirty(v);
      }
    }

    if (relaxedEdgesEnabled) {
      const targets = this.graph.targets;
      for (let e = 0; e < m; e += 1) {
        const shouldDraw = this.shouldDrawGhost(e, state);
        const wasDrawn = this.lastGhost[e] === 1;
        if (shouldDraw !== wasDrawn) {
          const src = this.srcOfEdge[e];
          if (src === undefined) {
            throw new Error(`srcOfEdge[${String(e)}] is missing`);
          }
          this.includeVertexDirty(src);
          this.includeVertexDirty(targetAt(targets, e));
        }
      }
    }

    this.drawOverlay(state, frontierEnabled, relaxedEdgesEnabled);

    this.compositeToTarget();

    for (let v = 0; v < n; v += 1) {
      const order = state.settleOrder[v];
      if (order === undefined) {
        throw new Error(`settleOrder[${String(v)}] is missing`);
      }
      this.lastSettle[v] = order;
      const curFrontier = state.frontier[v];
      if (curFrontier === undefined) {
        throw new Error(`frontier[${String(v)}] is missing`);
      }
      this.lastFrontier[v] = curFrontier;
    }

    for (let e = 0; e < m; e += 1) {
      const drawn = relaxedEdgesEnabled && this.shouldDrawGhost(e, state) ? 1 : 0;
      this.lastGhost[e] = drawn;
    }

    this.lastFrontierOverlay = frontierEnabled;
    this.lastRelaxedEdgesOverlay = relaxedEdgesEnabled;

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
   * Expand the dirty rect by vertex `v`'s projected circle AABB.
   */
  private includeVertexDirty(v: number): void {
    const cx = projectX(this.camera, vertexX(this.graph, v));
    const cy = projectY(this.camera, vertexY(this.graph, v));
    includeNode(this.dirty, cx, cy, this.camera.radius, this.target.width, this.target.height);
  }

  /**
   * Whether edge `e` should show a relaxed-edge ghost trail at the current work cursor.
   */
  private shouldDrawGhost(e: number, state: LaneState): boolean {
    const lastWork = state.lastRelaxWork[e];
    if (lastWork === undefined) {
      throw new Error(`lastRelaxWork[${String(e)}] is missing`);
    }
    if (lastWork === UNSETTLED) {
      return false;
    }
    const age = state.work - lastWork;
    return age >= 0 && age < GHOST_WINDOW_OPS;
  }

  /**
   * Redraw the overlay layer: optional frontier rings and relaxed-edge ghost trails.
   */
  private drawOverlay(
    state: LaneState,
    frontierEnabled: boolean,
    relaxedEdgesEnabled: boolean,
  ): void {
    const ctx = requireContext(this.overlayLayer, "overlayLayer");
    const graph = this.graph;
    const camera = this.camera;
    const width = this.overlayLayer.width;
    const height = this.overlayLayer.height;

    ctx.clearRect(0, 0, width, height);

    if (frontierEnabled) {
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

    if (relaxedEdgesEnabled) {
      const m = state.m;
      const targets = graph.targets;
      const srcOfEdge = this.srcOfEdge;

      ctx.strokeStyle = GHOST_STROKE;
      ctx.lineWidth = GHOST_LINE_WIDTH;
      ctx.beginPath();

      let drewGhost = false;
      for (let e = 0; e < m; e += 1) {
        if (!this.shouldDrawGhost(e, state)) {
          continue;
        }

        const src = srcOfEdge[e];
        if (src === undefined) {
          throw new Error(`srcOfEdge[${String(e)}] is missing`);
        }
        const tgt = targetAt(targets, e);
        const x0 = projectX(camera, vertexX(graph, src));
        const y0 = projectY(camera, vertexY(graph, src));
        const x1 = projectX(camera, vertexX(graph, tgt));
        const y1 = projectY(camera, vertexY(graph, tgt));
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        drewGhost = true;
      }

      if (drewGhost) {
        ctx.stroke();
      }
    }
  }

  /**
   * Blit edge, fill, and overlay layers onto the target canvas.
   *
   * Dirty rect limits the compositing blit; a full pass runs on the first frame,
   * after {@link setGraph}, on unsettle ({@link markFull}), or when the hit cap is exceeded.
   */
  private compositeToTarget(): void {
    const targetCtx = requireContext(this.target, "target");
    const width = this.target.width;
    const height = this.target.height;
    const dirty = this.dirty;

    if (this.needsFullComposite || dirty.full) {
      targetCtx.fillStyle = PAPER_BG;
      targetCtx.fillRect(0, 0, width, height);
      targetCtx.drawImage(this.edgeLayer, 0, 0, width, height, 0, 0, width, height);
      targetCtx.drawImage(this.fillLayer, 0, 0, width, height, 0, 0, width, height);
      targetCtx.drawImage(this.overlayLayer, 0, 0, width, height, 0, 0, width, height);
      this.needsFullComposite = false;
      return;
    }

    if (dirty.w > 0 && dirty.h > 0) {
      const sx = dirty.x;
      const sy = dirty.y;
      const sw = dirty.w;
      const sh = dirty.h;
      const dx = dirty.x;
      const dy = dirty.y;
      const dw = dirty.w;
      const dh = dirty.h;
      targetCtx.drawImage(this.edgeLayer, sx, sy, sw, sh, dx, dy, dw, dh);
      targetCtx.drawImage(this.fillLayer, sx, sy, sw, sh, dx, dy, dw, dh);
      targetCtx.drawImage(this.overlayLayer, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  }
}
