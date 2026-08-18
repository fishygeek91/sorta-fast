/**
 * Layered Canvas2D renderer: static edges, dirty-rect settle fills, frontier overlay (issue #6),
 * BMSSP FX overlays (issue #12), and settle-diff dual-lane fills (issue #68).
 *
 * Four offscreen layers: edge, fill, overlay, fx. Consumes {@link LaneState} only — no algorithm
 * or trace imports.
 */

import { SIZE_PRESETS, type Graph } from "../core/graph.ts";
import { FOREST_EDGE_CUT, FOREST_EDGE_GROW, LaneState, UNSETTLED } from "../harness/laneState.ts";
import { fitCamera, projectX, projectY, type Camera } from "./camera.ts";
import {
  createDirtyRect,
  DIRTY_HIT_CAP,
  includeNode,
  markFull,
  resetDirty,
  type DirtyRect,
} from "./dirtyRect.ts";
import { devicePx, devicePxInt } from "./devicePx.ts";
import { rgbForSettleOrder, rgbForSubtree } from "./palette.ts";
import {
  fillSettleDiff,
  SETTLE_DIFF_BOTH,
  SETTLE_DIFF_LEFT,
  SETTLE_DIFF_NEITHER,
  SETTLE_DIFF_RIGHT,
} from "./settleDiff.ts";
import { type CanvasSurface, type DrawContext, type SurfaceFactory } from "./surface.ts";
import { EMBER_RGB, PHOTO_FINISH_GOLD, parseRgb, THEMES, type ThemeTokens } from "./theme.ts";

export { EMBER_RGB, PHOTO_FINISH_GOLD };

/** Vertex count at which the aggregated ImageData fill path activates (issue #20). */
export const AGGREGATED_RENDER_MIN_N = SIZE_PRESETS.L;

/** Aggregated node footprint in CSS pixels (2×2 squares; issue #79). Backing-store size is devicePxInt of this × pixelScale. */
export const AGGREGATED_NODE_PX = 2;

/** Edge line width in CSS pixels (issue #80). Backing-store width is devicePx of this × pixelScale. */
const EDGE_LINE_WIDTH = 1;

/** Frontier ring line width in CSS pixels (issue #80). Backing-store width is devicePx of this × pixelScale. */
const FRONTIER_LINE_WIDTH = 1.5;

/** Ghost edge line width in CSS pixels (issue #80). Backing-store width is devicePx of this × pixelScale. */
const GHOST_LINE_WIDTH = 1.5;

/** Forest grow edge line width in CSS pixels (issue #27). Not scaled by pixelScale. */
const FOREST_GROW_LINE_WIDTH = 1.5;

/** Forest cut edge line width in CSS pixels (issue #27). Not scaled by pixelScale. */
const FOREST_CUT_LINE_WIDTH = 2.5;

/** Full circle arc in radians. */
const TAU = Math.PI * 2;

/** Ghost trail window in billed ops (scrub-safe; not wall-clock). */
export const GHOST_WINDOW_OPS = 10_000;

/** Forest grow/cut pulse window in billed ops (scrub-safe; not wall-clock). */
export const FOREST_GROW_WINDOW_OPS = GHOST_WINDOW_OPS;

/** Pivot flare ring window in billed ops (scrub-safe; not wall-clock). */
export const PIVOT_FLARE_WINDOW_OPS = 10_000;

/** Lane persona accent for settle-diff fills (issue #68). */
export type DiffPersona = "marble" | "ember" | "moss" | "stub";

/** Options for {@link Renderer.drawDiff} settle-diff overlay (issue #68). */
export type DiffOverlayOpts = {
  source?: number;
  finish?: number;
  leftPersona: DiffPersona;
  rightPersona: DiffPersona;
};

/** Optional overlay toggles for frontier, ghosts, BMSSP narration FX, and photo-finish. */
export type OverlayFlags = {
  frontier?: boolean;
  relaxedEdges?: boolean;
  recursionTint?: boolean;
  pivotFlares?: boolean;
  batchBlooms?: boolean;
  dstructStrip?: boolean;
  /** Source vertex ring; defaults to 0. Always drawn when in range. */
  source?: number;
  /** Finish vertex ring; omitted = no finish mark. Drawn when an integer in range. */
  finish?: number;
  /** Gold pred-walk path on the fx layer when true and finish is in range with path length >= 2. */
  photoFinish?: boolean;
  /** DMSY spanning-forest grow edges on the overlay layer (issue #27). */
  forestGrow?: boolean;
  /** DMSY partition cut edges on the overlay layer (issue #27). */
  forestCut?: boolean;
  /** DMSY subtree patchwork settle fills keyed by `forestTree` (issue #27). */
  subtreePatchwork?: boolean;
};

/** Resolved overlay toggles — omitted keys default to enabled; photo-finish marks resolved separately. */
type ResolvedOverlayFlags = {
  frontier: boolean;
  relaxedEdges: boolean;
  recursionTint: boolean;
  pivotFlares: boolean;
  batchBlooms: boolean;
  dstructStrip: boolean;
  source: number;
  finish: number | undefined;
  photoFinish: boolean;
  forestGrow: boolean;
  forestCut: boolean;
  subtreePatchwork: boolean;
};

/** Recursion-depth tint alpha scale (full canvas on fx layer). */
const RECURSION_TINT_ALPHA_SCALE = 0.08;

/** Recursion depth contributing at most this value to tint alpha. */
const RECURSION_DEPTH_CAP = 5;

/** Pivot flare outer ring radius multiplier vs node radius. */
const PIVOT_FLARE_OUTER_SCALE = 2.2;

/** Pivot flare inner ring radius multiplier vs node radius. */
const PIVOT_FLARE_INNER_SCALE = 1.35;

/** Batch bloom fill alpha on the fx layer. */
const BLOOM_FILL_ALPHA = 0.2;

/** Schematic D-structure strip height in CSS pixels along the canvas bottom (issue #79). Backing-store size is devicePxInt of this × pixelScale. */
export const DSTRUCT_STRIP_HEIGHT = 16;

/** Source/finish mark ring line width in CSS pixels (issue #79). Backing-store size is devicePx of this × pixelScale. */
export const MARK_LINE_WIDTH = 2;

/** Photo-finish gold path line width in CSS pixels (issue #79). Backing-store size is devicePx of this × pixelScale. */
export const PHOTO_FINISH_LINE_WIDTH = 3;

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
/**
 * True when CSR contains a directed arc `from -> to`.
 */
function hasArc(graph: Graph, from: number, to: number): boolean {
  const offsets = graph.offsets;
  const targets = graph.targets;
  const start = offsetAt(offsets, from);
  const end = offsetAt(offsets, from + 1);
  for (let e = start; e < end; e += 1) {
    if (targetAt(targets, e) === to) {
      return true;
    }
  }
  return false;
}

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
function resolveOverlayFlags(overlays?: OverlayFlags): ResolvedOverlayFlags {
  return {
    frontier: overlays?.frontier !== false,
    relaxedEdges: overlays?.relaxedEdges !== false,
    recursionTint: overlays?.recursionTint !== false,
    pivotFlares: overlays?.pivotFlares !== false,
    batchBlooms: overlays?.batchBlooms !== false,
    dstructStrip: overlays?.dstructStrip !== false,
    source: overlays?.source ?? 0,
    finish: overlays?.finish,
    photoFinish: overlays?.photoFinish === true,
    forestGrow: overlays?.forestGrow !== false,
    forestCut: overlays?.forestCut !== false,
    subtreePatchwork: overlays?.subtreePatchwork !== false,
  };
}

/**
 * True when `v` is a valid vertex index for the graph with `n` vertices.
 */
function isVertexInRange(v: number, n: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < n;
}

/**
 * Walk `pred` from `finish` toward `source`, collecting vertices until
 * {@link UNSETTLED}, a cycle, or `n` steps. Returns null when the path has fewer than two vertices.
 */
function buildPhotoFinishPath(state: LaneState, finish: number, source: number): number[] | null {
  const n = state.n;
  const pred = state.pred;
  const path: number[] = [];
  const visited = new Uint8Array(n);
  let v = finish;
  let steps = 0;

  while (steps < n) {
    path.push(v);
    if (v === source) {
      break;
    }
    const parent = pred[v];
    if (parent === undefined) {
      throw new Error(`pred[${String(v)}] is missing`);
    }
    if (parent === UNSETTLED) {
      break;
    }
    if (visited[v] === 1) {
      break;
    }
    visited[v] = 1;
    v = parent;
    steps += 1;
  }

  if (path.length < 2) {
    return null;
  }
  return path;
}

/**
 * True when lane state carries a finite FindPivots bloom bounding box for FX.
 */
function hasFiniteBloomBbox(state: LaneState): boolean {
  return (
    state.bloomActive === 1 &&
    Number.isFinite(state.bloomMinX) &&
    Number.isFinite(state.bloomMinY) &&
    Number.isFinite(state.bloomMaxX) &&
    Number.isFinite(state.bloomMaxY)
  );
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
  private readonly fxLayer: CanvasSurface;
  private lastSettle: Int32Array;
  private lastFrontier: Uint8Array;
  private srcOfEdge: Uint32Array;
  private lastGhost: Uint8Array;
  private lastForestGrow: Uint8Array;
  private lastForestCut: Uint8Array;
  private lastForestTree: Int32Array;
  private lastFrontierOverlay: boolean;
  private lastRelaxedEdgesOverlay: boolean;
  private lastRecursionTintOverlay: boolean;
  private lastPivotFlaresOverlay: boolean;
  private lastBatchBloomsOverlay: boolean;
  private lastDstructStripOverlay: boolean;
  private lastForestGrowOverlay: boolean;
  private lastForestCutOverlay: boolean;
  private lastSubtreePatchworkOverlay: boolean;
  private lastSource: number;
  private lastFinish: number | undefined;
  private lastPhotoFinish: boolean;
  private lastRecursionDepth: number;
  private lastBloomActive: number;
  private lastDBlockCount: number;
  private readonly dirty: DirtyRect;
  /** True until the first composite or after {@link setGraph}; forces a full four-layer blit. */
  private needsFullComposite: boolean;
  /** Paper background behind the graph. */
  private paperBg: string;
  /** Static edge stroke color. */
  private edgeStroke: string;
  /** Frontier ring stroke color. */
  private frontierStroke: string;
  /** Ghost relaxed-edge stroke color. */
  private ghostStroke: string;
  /** DMSY forest grow/cut overlay stroke (moss accent). */
  private mossStroke: string;
  /** BMSSP ember accent channels for `rgba()` templates. */
  private emberRgb: string;
  /** D-structure schematic stone fill. */
  private stoneFill: string;
  /** Source vertex outer ring stroke. */
  private sourceMarkStroke: string;
  /** Finish vertex ring stroke. */
  private finishMarkStroke: string;
  /** CPU settle-fill bitmap when {@link usesAggregated}; null below threshold. */
  private fillPixels: ImageData | null;
  /** Cached source/finish mark stroke width in backing-store pixels (issue #79). */
  private readonly markLineWidth: number;
  /** Cached photo-finish gold path width in backing-store pixels (issue #79). */
  private readonly photoFinishLineWidth: number;
  /** Cached D-structure strip height in backing-store pixels (issue #79). */
  private readonly dstructStripHeight: number;
  /** Cached aggregated node footprint in backing-store pixels (issue #79). */
  private readonly aggregatedNodePx: number;
  /** Cached static edge stroke width in backing-store pixels (issue #80). */
  private readonly edgeLineWidth: number;
  /** Cached frontier/pivot ring stroke width in backing-store pixels (issue #80). */
  private readonly frontierLineWidth: number;
  /** Cached relaxed-edge ghost stroke width in backing-store pixels (issue #80). */
  private readonly ghostLineWidth: number;
  /** Dirty-radius pad covering half the widest scaled stroke overhang (issue #80). */
  private readonly strokeDirtyPad: number;
  /** Last drawn settle-diff bucket per vertex (issue #68); 0 = {@link SETTLE_DIFF_NEITHER}. */
  private lastDiff: Uint8Array;
  /** Last drawn out-of-order tick flag per vertex (issue #68). */
  private lastOoo: Uint8Array;
  /** Scratch buffer for {@link fillSettleDiff} (issue #68). */
  private diffBuckets: Uint8Array;
  /** True when chrome tokens changed and settle-diff fills must be fully redrawn. */
  private diffChromeDirty: boolean;
  /** Marble persona settle-diff fill (issue #68). */
  private diffMarbleFill: string;
  /** Ember persona settle-diff fill (issue #68). */
  private diffEmberFill: string;
  /** Moss persona settle-diff fill (DMSY lane). */
  private diffMossFill: string;
  /** Both-lanes settle-diff fill (issue #68). */
  private diffBothFill: string;
  /** Ink stroke for OOO ticks and labels (issue #68). */
  private inkStroke: string;

  /**
   * @param opts.target - On-screen canvas surface.
   * @param opts.createSurface - Factory for offscreen layers (DOM or test fake).
   * @param opts.graph - Initial CSR graph with layout coordinates.
   * @param opts.pixelScale - Backing pixels per CSS pixel (issue #79). Omitted defaults to 1 so Lens/Story/headless tests stay unchanged. Must be finite and > 0.
   */
  constructor(opts: {
    target: CanvasSurface;
    createSurface: SurfaceFactory;
    graph: Graph;
    pixelScale?: number;
  }) {
    const pixelScale = opts.pixelScale ?? 1;
    this.markLineWidth = devicePx(MARK_LINE_WIDTH, pixelScale);
    this.photoFinishLineWidth = devicePx(PHOTO_FINISH_LINE_WIDTH, pixelScale);
    this.dstructStripHeight = devicePxInt(DSTRUCT_STRIP_HEIGHT, pixelScale);
    this.aggregatedNodePx = devicePxInt(AGGREGATED_NODE_PX, pixelScale);
    this.edgeLineWidth = devicePx(EDGE_LINE_WIDTH, pixelScale);
    this.frontierLineWidth = devicePx(FRONTIER_LINE_WIDTH, pixelScale);
    this.ghostLineWidth = devicePx(GHOST_LINE_WIDTH, pixelScale);
    this.strokeDirtyPad = Math.ceil(
      Math.max(
        this.markLineWidth,
        this.photoFinishLineWidth,
        this.edgeLineWidth,
        this.frontierLineWidth,
        this.ghostLineWidth,
      ) / 2,
    );

    this.target = opts.target;
    this.graph = opts.graph;
    this.dirty = createDirtyRect();
    this.lastSettle = new Int32Array(opts.graph.n);
    this.lastSettle.fill(UNSETTLED);
    this.lastDiff = new Uint8Array(opts.graph.n);
    this.lastOoo = new Uint8Array(opts.graph.n);
    this.diffBuckets = new Uint8Array(opts.graph.n);
    this.diffChromeDirty = false;
    this.lastFrontier = new Uint8Array(opts.graph.n);
    this.srcOfEdge = buildSrcOfEdge(opts.graph);
    this.lastGhost = new Uint8Array(opts.graph.m);
    this.lastForestGrow = new Uint8Array(opts.graph.m);
    this.lastForestCut = new Uint8Array(opts.graph.m);
    this.lastForestTree = new Int32Array(opts.graph.n);
    this.lastForestTree.fill(UNSETTLED);
    this.lastFrontierOverlay = true;
    this.lastRelaxedEdgesOverlay = true;
    this.lastRecursionTintOverlay = true;
    this.lastPivotFlaresOverlay = true;
    this.lastBatchBloomsOverlay = true;
    this.lastDstructStripOverlay = true;
    this.lastForestGrowOverlay = true;
    this.lastForestCutOverlay = true;
    this.lastSubtreePatchworkOverlay = true;
    this.lastSource = 0;
    this.lastFinish = undefined;
    this.lastPhotoFinish = false;
    this.lastRecursionDepth = 0;
    this.lastBloomActive = 0;
    this.lastDBlockCount = 0;
    this.needsFullComposite = true;

    const width = opts.target.width;
    const height = opts.target.height;
    this.camera = fitCamera(opts.graph, width, height);

    this.edgeLayer = opts.createSurface(width, height);
    this.fillLayer = opts.createSurface(width, height);
    this.overlayLayer = opts.createSurface(width, height);
    this.fxLayer = opts.createSurface(width, height);

    const dark = THEMES.dark;
    this.paperBg = dark.paper;
    this.edgeStroke = dark.hairline;
    this.frontierStroke = dark.frontier;
    this.ghostStroke = dark.ghost;
    this.mossStroke = dark.moss;
    this.emberRgb = EMBER_RGB;
    this.stoneFill = dark.stoneFill;
    this.sourceMarkStroke = dark.sourceMark;
    this.finishMarkStroke = dark.finishMark;
    this.diffMarbleFill = dark.diffMarble;
    this.diffEmberFill = dark.diffEmber;
    this.diffMossFill = dark.moss;
    this.diffBothFill = dark.diffBoth;
    this.inkStroke = dark.ink;
    this.fillPixels = null;

    this.syncFillPixels();
    this.drawEdgeLayer();
    this.clearFillLayer();
  }

  /**
   * Apply chrome palette tokens and redraw the static edge layer.
   *
   * Photo-finish gold stays the bright {@link PHOTO_FINISH_GOLD} constant;
   * ember FX channels remain {@link EMBER_RGB}.
   *
   * @param tokens - Semantic chrome colors from {@link THEMES}.
   */
  setChrome(tokens: ThemeTokens): void {
    this.paperBg = tokens.paper;
    this.edgeStroke = tokens.hairline;
    this.frontierStroke = tokens.frontier;
    this.ghostStroke = tokens.ghost;
    this.mossStroke = tokens.moss;
    this.emberRgb = EMBER_RGB;
    this.stoneFill = tokens.stoneFill;
    this.sourceMarkStroke = tokens.sourceMark;
    this.finishMarkStroke = tokens.finishMark;
    this.diffMarbleFill = tokens.diffMarble;
    this.diffEmberFill = tokens.diffEmber;
    this.diffMossFill = tokens.moss;
    this.diffBothFill = tokens.diffBoth;
    this.inkStroke = tokens.ink;
    this.diffChromeDirty = true;
    this.drawEdgeLayer();
    this.needsFullComposite = true;
  }

  /**
   * Replace the graph, rebuild the camera and edge layer, and mark a full redraw.
   */
  setGraph(graph: Graph): void {
    this.graph = graph;
    this.camera = fitCamera(graph, this.target.width, this.target.height);
    this.lastSettle = new Int32Array(graph.n);
    this.lastSettle.fill(UNSETTLED);
    this.lastDiff = new Uint8Array(graph.n);
    this.lastOoo = new Uint8Array(graph.n);
    this.diffBuckets = new Uint8Array(graph.n);
    this.diffChromeDirty = true;
    this.lastFrontier = new Uint8Array(graph.n);
    this.srcOfEdge = buildSrcOfEdge(graph);
    this.lastGhost = new Uint8Array(graph.m);
    this.lastForestGrow = new Uint8Array(graph.m);
    this.lastForestCut = new Uint8Array(graph.m);
    this.lastForestTree = new Int32Array(graph.n);
    this.lastForestTree.fill(UNSETTLED);
    this.needsFullComposite = true;
    this.lastRecursionDepth = 0;
    this.lastBloomActive = 0;
    this.lastDBlockCount = 0;
    resetDirty(this.dirty);
    markFull(this.dirty, this.target.width, this.target.height);
    this.syncFillPixels();
    this.drawEdgeLayer();
    this.clearFillLayer();
  }

  /**
   * Draw lane state. Diff against last drawn `settleOrder`:
   * - new settles: fill circles with {@link cssColorForSettleOrder}, `includeNode` dirty
   * - any unsettle: clear fill layer, redraw ALL settled nodes, `markFull`
   *
   * Overlay pass: clear overlay, optionally draw frontier rings, ghost trails, and pivot flares.
   * FX pass: clear fx, optionally draw recursion tint, batch blooms, and D-structure strip.
   * Dirty frontier, ghost, flare, bloom, and strip changes expand the dirty rect before paint.
   * Composite onto target: full blit on first frame, {@link setGraph}, unsettle, or hit cap;
   * otherwise blit only the dirty rect (edges + fill + overlay + fx).
   *
   * @param overlays - Optional toggles; omitted keys default to enabled.
   */
  draw(state: LaneState, overlays?: OverlayFlags): void {
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
    const flags = resolveOverlayFlags(overlays);

    if (
      flags.frontier !== this.lastFrontierOverlay ||
      flags.relaxedEdges !== this.lastRelaxedEdgesOverlay ||
      flags.recursionTint !== this.lastRecursionTintOverlay ||
      flags.pivotFlares !== this.lastPivotFlaresOverlay ||
      flags.batchBlooms !== this.lastBatchBloomsOverlay ||
      flags.dstructStrip !== this.lastDstructStripOverlay ||
      flags.forestGrow !== this.lastForestGrowOverlay ||
      flags.forestCut !== this.lastForestCutOverlay ||
      flags.subtreePatchwork !== this.lastSubtreePatchworkOverlay ||
      flags.source !== this.lastSource ||
      flags.finish !== this.lastFinish ||
      flags.photoFinish !== this.lastPhotoFinish
    ) {
      markFull(this.dirty, width, height);
      this.needsFullComposite = true;
    }

    const patchworkToggled = flags.subtreePatchwork !== this.lastSubtreePatchworkOverlay;

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
    let fillChanged = false;

    if (hadUnsettle) {
      this.clearFillLayer();
      markFull(this.dirty, width, height);
      fillChanged = true;
      for (let v = 0; v < n; v += 1) {
        const order = state.settleOrder[v];
        if (order === undefined) {
          throw new Error(`settleOrder[${String(v)}] is missing`);
        }
        if (order !== UNSETTLED) {
          this.drawSettledNode(fillCtx, v, order, n, state, flags);
        }
      }
    } else if (patchworkToggled) {
      for (let v = 0; v < n; v += 1) {
        const order = state.settleOrder[v];
        if (order === undefined) {
          throw new Error(`settleOrder[${String(v)}] is missing`);
        }
        if (order !== UNSETTLED) {
          this.drawSettledNode(fillCtx, v, order, n, state, flags);
          fillChanged = true;
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
          this.drawSettledNode(fillCtx, v, order, n, state, flags);
          fillChanged = true;
        } else if (
          flags.subtreePatchwork &&
          order !== UNSETTLED &&
          state.forestTree[v] !== this.lastForestTree[v]
        ) {
          this.drawSettledNode(fillCtx, v, order, n, state, flags);
          fillChanged = true;
        }
      }
    }

    if (this.usesAggregated() && fillChanged) {
      this.blitFillPixels(fillCtx);
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

    if (flags.relaxedEdges && !this.usesAggregated()) {
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

    if (!this.usesAggregated()) {
      const targets = this.graph.targets;
      if (flags.forestGrow) {
        for (let e = 0; e < m; e += 1) {
          const shouldDraw = this.shouldDrawForestGrow(e, state);
          const wasDrawn = this.lastForestGrow[e] === 1;
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
      if (flags.forestCut) {
        for (let e = 0; e < m; e += 1) {
          const shouldDraw = this.shouldDrawForestCut(e, state);
          const wasDrawn = this.lastForestCut[e] === 1;
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
    }

    if (flags.pivotFlares) {
      this.includePivotFlareDirty(state);
    }

    if (flags.recursionTint && (state.recursionDepth > 0 || this.lastRecursionDepth > 0)) {
      markFull(this.dirty, width, height);
    }

    if (flags.batchBlooms) {
      if (hasFiniteBloomBbox(state)) {
        this.includeBloomDirty(state);
      } else if (this.lastBloomActive === 1) {
        markFull(this.dirty, width, height);
      }
    }

    if (flags.dstructStrip && (state.dBlockCount > 0 || this.lastDBlockCount > 0)) {
      this.includeRectDirty(0, height - this.dstructStripHeight, width - 1, height - 1);
    }

    this.includePhotoFinishDirty(state, flags);

    this.drawOverlay(state, flags);
    this.drawFx(state, flags);

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
      const curTree = state.forestTree[v];
      if (curTree === undefined) {
        throw new Error(`forestTree[${String(v)}] is missing`);
      }
      this.lastForestTree[v] = curTree;
    }

    for (let e = 0; e < m; e += 1) {
      const drawn =
        flags.relaxedEdges && !this.usesAggregated() && this.shouldDrawGhost(e, state) ? 1 : 0;
      this.lastGhost[e] = drawn;
      const growDrawn =
        flags.forestGrow && !this.usesAggregated() && this.shouldDrawForestGrow(e, state) ? 1 : 0;
      this.lastForestGrow[e] = growDrawn;
      const cutDrawn =
        flags.forestCut && !this.usesAggregated() && this.shouldDrawForestCut(e, state) ? 1 : 0;
      this.lastForestCut[e] = cutDrawn;
    }

    this.lastFrontierOverlay = flags.frontier;
    this.lastRelaxedEdgesOverlay = flags.relaxedEdges;
    this.lastRecursionTintOverlay = flags.recursionTint;
    this.lastPivotFlaresOverlay = flags.pivotFlares;
    this.lastBatchBloomsOverlay = flags.batchBlooms;
    this.lastDstructStripOverlay = flags.dstructStrip;
    this.lastForestGrowOverlay = flags.forestGrow;
    this.lastForestCutOverlay = flags.forestCut;
    this.lastSubtreePatchworkOverlay = flags.subtreePatchwork;
    this.lastSource = flags.source;
    this.lastFinish = flags.finish;
    this.lastPhotoFinish = flags.photoFinish;
    this.lastRecursionDepth = state.recursionDepth;
    this.lastBloomActive = state.bloomActive;
    this.lastDBlockCount = state.dBlockCount;

    resetDirty(this.dirty);
  }

  /**
   * Draw settle-diff fills for two lane snapshots (issue #68).
   *
   * Dedicated instance path — does not update {@link draw} last-settle bookkeeping.
   * Fills vertices by left-only / right-only / both settle buckets; optional OOO ticks
   * and source/finish rings on the overlay layer; fx layer cleared.
   */
  drawDiff(left: LaneState, right: LaneState, opts: DiffOverlayOpts): void {
    if (left.n !== this.graph.n) {
      throw new Error(
        `left lane vertex count ${String(left.n)} does not match graph n ${String(this.graph.n)}`,
      );
    }
    if (right.n !== this.graph.n) {
      throw new Error(
        `right lane vertex count ${String(right.n)} does not match graph n ${String(this.graph.n)}`,
      );
    }
    if (left.m !== this.graph.m) {
      throw new Error(
        `left lane edge count ${String(left.m)} does not match graph m ${String(this.graph.m)}`,
      );
    }
    if (right.m !== this.graph.m) {
      throw new Error(
        `right lane edge count ${String(right.m)} does not match graph m ${String(this.graph.m)}`,
      );
    }

    const n = left.n;
    const width = this.target.width;
    const height = this.target.height;

    fillSettleDiff(this.diffBuckets, left, right);

    let hadUnsettle = this.diffChromeDirty;
    if (!hadUnsettle) {
      for (let v = 0; v < n; v += 1) {
        const prev = this.lastDiff[v];
        const cur = this.diffBuckets[v];
        if (prev === undefined || cur === undefined) {
          throw new Error(`diff bucket[${String(v)}] is missing`);
        }
        if (prev !== SETTLE_DIFF_NEITHER && cur === SETTLE_DIFF_NEITHER) {
          hadUnsettle = true;
          break;
        }
      }
    }

    const fillCtx = requireContext(this.fillLayer, "fillLayer");
    let fillChanged = false;

    if (hadUnsettle) {
      this.clearFillLayer();
      markFull(this.dirty, width, height);
      fillChanged = true;
      for (let v = 0; v < n; v += 1) {
        const bucket = this.diffBuckets[v];
        if (bucket === undefined) {
          throw new Error(`diffBuckets[${String(v)}] is missing`);
        }
        if (bucket !== SETTLE_DIFF_NEITHER) {
          const fill = this.bucketFillColor(bucket, opts);
          if (fill !== null) {
            this.drawDiffNode(fillCtx, v, fill);
          }
        }
      }
    } else {
      for (let v = 0; v < n; v += 1) {
        const prev = this.lastDiff[v];
        const bucket = this.diffBuckets[v];
        if (prev === undefined || bucket === undefined) {
          throw new Error(`diff bucket[${String(v)}] is missing`);
        }
        if (prev !== bucket && bucket !== SETTLE_DIFF_NEITHER) {
          const fill = this.bucketFillColor(bucket, opts);
          if (fill !== null) {
            this.drawDiffNode(fillCtx, v, fill);
            fillChanged = true;
          }
        }
      }
    }

    if (this.usesAggregated() && fillChanged) {
      this.blitFillPixels(fillCtx);
    }

    for (let v = 0; v < n; v += 1) {
      const leftOoo = left.outOfOrder[v];
      const rightOoo = right.outOfOrder[v];
      if (leftOoo === undefined || rightOoo === undefined) {
        throw new Error(`outOfOrder[${String(v)}] is missing`);
      }
      const curOoo = leftOoo === 1 || rightOoo === 1 ? 1 : 0;
      const prevOoo = this.lastOoo[v];
      if (prevOoo === undefined) {
        throw new Error(`lastOoo[${String(v)}] is missing`);
      }
      if (prevOoo !== curOoo) {
        this.includeVertexDirty(v);
      }
    }

    const overlayCtx = requireContext(this.overlayLayer, "overlayLayer");
    overlayCtx.clearRect(0, 0, this.overlayLayer.width, this.overlayLayer.height);

    const aggregated = this.usesAggregated();
    if (!aggregated) {
      const graph = this.graph;
      const camera = this.camera;
      overlayCtx.strokeStyle = this.inkStroke;
      overlayCtx.lineWidth = this.markLineWidth;

      for (let v = 0; v < n; v += 1) {
        const leftOoo = left.outOfOrder[v];
        const rightOoo = right.outOfOrder[v];
        if (leftOoo === undefined || rightOoo === undefined) {
          throw new Error(`outOfOrder[${String(v)}] is missing`);
        }
        if (leftOoo !== 1 && rightOoo !== 1) {
          continue;
        }
        const cx = projectX(camera, vertexX(graph, v));
        const cy = projectY(camera, vertexY(graph, v));
        overlayCtx.beginPath();
        overlayCtx.moveTo(cx, cy - camera.radius);
        overlayCtx.lineTo(cx, cy + camera.radius);
        overlayCtx.stroke();
      }
    }

    const diffOverlayFlags: ResolvedOverlayFlags = {
      frontier: false,
      relaxedEdges: false,
      recursionTint: false,
      pivotFlares: false,
      batchBlooms: false,
      dstructStrip: false,
      forestGrow: false,
      forestCut: false,
      subtreePatchwork: false,
      source: opts.source ?? 0,
      finish: opts.finish,
      photoFinish: false,
    };
    this.drawSourceFinishMarks(overlayCtx, left, diffOverlayFlags);

    const fxCtx = requireContext(this.fxLayer, "fxLayer");
    fxCtx.clearRect(0, 0, this.fxLayer.width, this.fxLayer.height);

    this.compositeToTarget();

    this.lastDiff.set(this.diffBuckets);
    for (let v = 0; v < n; v += 1) {
      const leftOoo = left.outOfOrder[v];
      const rightOoo = right.outOfOrder[v];
      if (leftOoo === undefined || rightOoo === undefined) {
        throw new Error(`outOfOrder[${String(v)}] is missing`);
      }
      this.lastOoo[v] = leftOoo === 1 || rightOoo === 1 ? 1 : 0;
    }
    this.diffChromeDirty = false;
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

    ctx.fillStyle = this.paperBg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = this.edgeStroke;
    ctx.lineWidth = this.edgeLineWidth;
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
        if (this.usesAggregated() && t < v && hasArc(graph, t, v)) {
          continue;
        }
        const x1 = projectX(camera, vertexX(graph, t));
        const y1 = projectY(camera, vertexY(graph, t));
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
    }

    ctx.stroke();
  }

  /**
   * Clear the settle-fill layer to transparent and zero the aggregated CPU buffer when present.
   */
  private clearFillLayer(): void {
    const ctx = requireContext(this.fillLayer, "fillLayer");
    ctx.clearRect(0, 0, this.fillLayer.width, this.fillLayer.height);
    this.clearFillPixels();
  }

  /**
   * True when the current graph uses the aggregated ImageData node fill path.
   */
  private usesAggregated(): boolean {
    return this.graph.n >= AGGREGATED_RENDER_MIN_N;
  }

  /**
   * Dirty-rect radius for one vertex: aggregated footprint or camera circle, padded by half the widest scaled stroke so HiDPI ring overhang is covered (issue #80).
   */
  private nodeDirtyRadius(): number {
    const base = this.usesAggregated() ? this.aggregatedNodePx : this.camera.radius;
    return base + this.strokeDirtyPad;
  }

  /**
   * Allocate or drop the CPU settle-fill bitmap when crossing the aggregated threshold.
   */
  private syncFillPixels(): void {
    if (!this.usesAggregated()) {
      this.fillPixels = null;
      return;
    }

    const ctx = requireContext(this.fillLayer, "fillLayer");
    const width = this.fillLayer.width;
    const height = this.fillLayer.height;
    const existing = this.fillPixels;
    if (existing === null || existing.width !== width || existing.height !== height) {
      this.fillPixels = ctx.getImageData(0, 0, width, height);
    }
    this.clearFillPixels();
  }

  /**
   * Zero the aggregated CPU buffer without touching the canvas layer.
   */
  private clearFillPixels(): void {
    const pixels = this.fillPixels;
    if (pixels !== null) {
      pixels.data.fill(0);
    }
  }

  /**
   * Resolve settled-node fill RGB from settle order or DMSY subtree patchwork (issue #27).
   */
  private settledFillRgb(
    v: number,
    order: number,
    n: number,
    state: LaneState,
    flags: ResolvedOverlayFlags,
  ): { r: number; g: number; b: number } {
    if (flags.subtreePatchwork) {
      const tree = state.forestTree[v];
      if (tree === undefined) {
        throw new Error(`forestTree[${String(v)}] is missing`);
      }
      if (tree !== UNSETTLED) {
        return rgbForSubtree(tree);
      }
    }
    return rgbForSettleOrder(order, n);
  }

  /**
   * Resolve settled-node fill CSS color from settle order or DMSY subtree patchwork (issue #27).
   */
  private settledFillCss(
    v: number,
    order: number,
    n: number,
    state: LaneState,
    flags: ResolvedOverlayFlags,
  ): string {
    const { r, g, b } = this.settledFillRgb(v, order, n, state, flags);
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Write one aggregated settled node (2 CSS px footprint) into the CPU buffer and expand the dirty rect.
   */
  private writeAggregatedNode(
    v: number,
    order: number,
    n: number,
    state: LaneState,
    flags: ResolvedOverlayFlags,
  ): void {
    const pixels = this.fillPixels;
    if (pixels === null) {
      throw new Error("writeAggregatedNode: fillPixels is null");
    }

    const graph = this.graph;
    const camera = this.camera;
    const cx = Math.floor(projectX(camera, vertexX(graph, v)));
    const cy = Math.floor(projectY(camera, vertexY(graph, v)));
    const { r, g, b } = this.settledFillRgb(v, order, n, state, flags);
    const data = pixels.data;
    const canvasWidth = pixels.width;
    const canvasHeight = pixels.height;

    for (let dy = 0; dy < this.aggregatedNodePx; dy += 1) {
      const py = cy + dy;
      if (py < 0 || py >= canvasHeight) {
        continue;
      }
      for (let dx = 0; dx < this.aggregatedNodePx; dx += 1) {
        const px = cx + dx;
        if (px < 0 || px >= canvasWidth) {
          continue;
        }
        const offset = (py * canvasWidth + px) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = 255;
      }
    }

    includeNode(
      this.dirty,
      cx + this.aggregatedNodePx * 0.5,
      cy + this.aggregatedNodePx * 0.5,
      this.aggregatedNodePx,
      this.target.width,
      this.target.height,
    );
  }

  /**
   * Blit the CPU settle buffer onto the fill layer with one {@link DrawContext.putImageData}.
   */
  private blitFillPixels(ctx: DrawContext): void {
    const pixels = this.fillPixels;
    if (pixels === null) {
      return;
    }

    const dirty = this.dirty;
    const width = this.fillLayer.width;
    const height = this.fillLayer.height;

    if (dirty.full) {
      ctx.putImageData(pixels, 0, 0);
      return;
    }

    if (dirty.w > 0 && dirty.h > 0) {
      ctx.putImageData(pixels, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h);
      return;
    }

    ctx.putImageData(pixels, 0, 0, 0, 0, width, height);
  }

  /**
   * Draw an aggregated overlay mark (2 CSS px footprint) at the projected vertex center.
   */
  private drawAggregatedOverlayMark(
    ctx: DrawContext,
    cx: number,
    cy: number,
    fillStyle: string,
  ): void {
    ctx.fillStyle = fillStyle;
    ctx.fillRect(Math.floor(cx), Math.floor(cy), this.aggregatedNodePx, this.aggregatedNodePx);
  }

  /**
   * Fill one settled vertex circle on the fill layer and expand the dirty rect.
   */
  private drawSettledNode(
    ctx: DrawContext,
    v: number,
    order: number,
    n: number,
    state: LaneState,
    flags: ResolvedOverlayFlags,
  ): void {
    if (this.usesAggregated()) {
      this.writeAggregatedNode(v, order, n, state, flags);
      return;
    }

    const graph = this.graph;
    const camera = this.camera;
    const cx = projectX(camera, vertexX(graph, v));
    const cy = projectY(camera, vertexY(graph, v));
    const radius = camera.radius;

    ctx.fillStyle = this.settledFillCss(v, order, n, state, flags);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();

    includeNode(this.dirty, cx, cy, radius, this.target.width, this.target.height);
  }

  /**
   * Resolve settle-diff bucket to a CSS fill color (issue #68).
   */
  private bucketFillColor(bucket: number, opts: DiffOverlayOpts): string | null {
    if (bucket === SETTLE_DIFF_LEFT) {
      return this.personaFill(opts.leftPersona);
    }
    if (bucket === SETTLE_DIFF_RIGHT) {
      return this.personaFill(opts.rightPersona);
    }
    if (bucket === SETTLE_DIFF_BOTH) {
      return this.diffBothFill;
    }
    return null;
  }

  /**
   * Resolve lane persona to settle-diff fill; stub uses marble (issue #68).
   */
  private personaFill(persona: DiffPersona): string {
    if (persona === "ember") {
      return this.diffEmberFill;
    }
    if (persona === "moss") {
      return this.diffMossFill;
    }
    return this.diffMarbleFill;
  }

  /**
   * Fill one settle-diff vertex on the fill layer and expand the dirty rect (issue #68).
   */
  private drawDiffNode(ctx: DrawContext, v: number, cssColor: string): void {
    if (this.usesAggregated()) {
      this.writeAggregatedCssColor(v, cssColor);
      return;
    }

    const graph = this.graph;
    const camera = this.camera;
    const cx = projectX(camera, vertexX(graph, v));
    const cy = projectY(camera, vertexY(graph, v));
    const radius = camera.radius;

    ctx.fillStyle = cssColor;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();

    includeNode(this.dirty, cx, cy, radius, this.target.width, this.target.height);
  }

  /**
   * Write one aggregated settle-diff node (2 CSS px footprint) via CSS color (issue #68).
   */
  private writeAggregatedCssColor(v: number, cssColor: string): void {
    const pixels = this.fillPixels;
    if (pixels === null) {
      throw new Error("writeAggregatedCssColor: fillPixels is null");
    }

    const graph = this.graph;
    const camera = this.camera;
    const cx = Math.floor(projectX(camera, vertexX(graph, v)));
    const cy = Math.floor(projectY(camera, vertexY(graph, v)));
    const { r, g, b } = parseRgb(cssColor);
    const data = pixels.data;
    const canvasWidth = pixels.width;
    const canvasHeight = pixels.height;

    for (let dy = 0; dy < this.aggregatedNodePx; dy += 1) {
      const py = cy + dy;
      if (py < 0 || py >= canvasHeight) {
        continue;
      }
      for (let dx = 0; dx < this.aggregatedNodePx; dx += 1) {
        const px = cx + dx;
        if (px < 0 || px >= canvasWidth) {
          continue;
        }
        const offset = (py * canvasWidth + px) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = 255;
      }
    }

    includeNode(
      this.dirty,
      cx + this.aggregatedNodePx * 0.5,
      cy + this.aggregatedNodePx * 0.5,
      this.aggregatedNodePx,
      this.target.width,
      this.target.height,
    );
  }

  /**
   * Expand the dirty rect by vertex `v`'s projected circle AABB.
   */
  private includeVertexDirty(v: number): void {
    const cx = projectX(this.camera, vertexX(this.graph, v));
    const cy = projectY(this.camera, vertexY(this.graph, v));
    includeNode(this.dirty, cx, cy, this.nodeDirtyRadius(), this.target.width, this.target.height);
  }

  /**
   * Union an inclusive pixel rectangle into the dirty rect, clipped to the canvas.
   */
  private includeRectDirty(x0: number, y0: number, x1: number, y1: number): void {
    const canvasWidth = this.target.width;
    const canvasHeight = this.target.height;
    const dirty = this.dirty;

    if (dirty.full) {
      return;
    }

    const clipX0 = Math.max(0, Math.floor(x0));
    const clipY0 = Math.max(0, Math.floor(y0));
    const clipX1 = Math.min(canvasWidth - 1, Math.floor(x1));
    const clipY1 = Math.min(canvasHeight - 1, Math.floor(y1));

    if (clipX0 > clipX1 || clipY0 > clipY1) {
      return;
    }

    dirty.hits += 1;
    if (dirty.hits > DIRTY_HIT_CAP) {
      markFull(dirty, canvasWidth, canvasHeight);
      return;
    }

    if (dirty.w === 0 && dirty.h === 0) {
      dirty.x = clipX0;
      dirty.y = clipY0;
      dirty.w = clipX1 - clipX0 + 1;
      dirty.h = clipY1 - clipY0 + 1;
      return;
    }

    const unionX0 = Math.min(dirty.x, clipX0);
    const unionY0 = Math.min(dirty.y, clipY0);
    const unionX1 = Math.max(dirty.x + dirty.w - 1, clipX1);
    const unionY1 = Math.max(dirty.y + dirty.h - 1, clipY1);

    dirty.x = unionX0;
    dirty.y = unionY0;
    dirty.w = unionX1 - unionX0 + 1;
    dirty.h = unionY1 - unionY0 + 1;
  }

  /**
   * Expand the dirty rect for every vertex showing an active pivot flare ring.
   */
  private includePivotFlareDirty(state: LaneState): void {
    const n = state.n;
    const radius = this.nodeDirtyRadius();

    for (let v = 0; v < n; v += 1) {
      if (!this.shouldDrawPivotFlare(v, state)) {
        continue;
      }
      const cx = projectX(this.camera, vertexX(this.graph, v));
      const cy = projectY(this.camera, vertexY(this.graph, v));
      includeNode(this.dirty, cx, cy, radius, this.target.width, this.target.height);
    }
  }

  /**
   * Expand the dirty rect for the projected FindPivots bloom bounding box.
   */
  private includeBloomDirty(state: LaneState): void {
    const camera = this.camera;
    const pad = camera.radius * 2;
    const x0 = projectX(camera, state.bloomMinX) - pad;
    const y0 = projectY(camera, state.bloomMinY) - pad;
    const x1 = projectX(camera, state.bloomMaxX) + pad;
    const y1 = projectY(camera, state.bloomMaxY) + pad;
    this.includeRectDirty(x0, y0, x1, y1);
  }

  /**
   * Expand the dirty rect for source/finish marks and the photo-finish gold path.
   */
  private includePhotoFinishDirty(state: LaneState, flags: ResolvedOverlayFlags): void {
    const n = state.n;

    if (flags.source !== this.lastSource) {
      if (isVertexInRange(this.lastSource, n)) {
        this.includeVertexDirty(this.lastSource);
      }
      if (isVertexInRange(flags.source, n)) {
        this.includeVertexDirty(flags.source);
      }
    }

    if (flags.finish !== this.lastFinish) {
      if (this.lastFinish !== undefined && isVertexInRange(this.lastFinish, n)) {
        this.includeVertexDirty(this.lastFinish);
      }
      if (flags.finish !== undefined && isVertexInRange(flags.finish, n)) {
        this.includeVertexDirty(flags.finish);
      }
    }

    if (
      flags.photoFinish &&
      flags.finish !== undefined &&
      isVertexInRange(flags.finish, n) &&
      (flags.photoFinish !== this.lastPhotoFinish ||
        flags.finish !== this.lastFinish ||
        flags.source !== this.lastSource)
    ) {
      const path = buildPhotoFinishPath(state, flags.finish, flags.source);
      if (path !== null) {
        for (const v of path) {
          this.includeVertexDirty(v);
        }
      }
    }
  }

  /**
   * Whether vertex `v` should show a pivot flare ring at the current work cursor.
   */
  private shouldDrawPivotFlare(v: number, state: LaneState): boolean {
    const flareWork = state.pivotFlareWork[v];
    if (flareWork === undefined) {
      throw new Error(`pivotFlareWork[${String(v)}] is missing`);
    }
    if (flareWork === UNSETTLED) {
      return false;
    }
    const age = state.work - flareWork;
    return age >= 0 && age < PIVOT_FLARE_WINDOW_OPS;
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
   * Whether edge `e` should show a DMSY forest grow stroke at the current work cursor.
   */
  private shouldDrawForestGrow(e: number, state: LaneState): boolean {
    const op = state.forestEdgeOp[e];
    if (op === undefined) {
      throw new Error(`forestEdgeOp[${String(e)}] is missing`);
    }
    if (op === FOREST_EDGE_GROW) {
      return true;
    }
    if (op === FOREST_EDGE_CUT) {
      return false;
    }
    const work = state.forestEdgeWork[e];
    if (work === undefined) {
      throw new Error(`forestEdgeWork[${String(e)}] is missing`);
    }
    if (work === UNSETTLED) {
      return false;
    }
    const age = state.work - work;
    return age >= 0 && age < FOREST_GROW_WINDOW_OPS;
  }

  /**
   * Whether edge `e` should show a DMSY forest cut stroke at the current work cursor.
   */
  private shouldDrawForestCut(e: number, state: LaneState): boolean {
    const op = state.forestEdgeOp[e];
    if (op === undefined) {
      throw new Error(`forestEdgeOp[${String(e)}] is missing`);
    }
    return op === FOREST_EDGE_CUT;
  }

  /**
   * Redraw the overlay layer: frontier rings, ghost trails, and pivot flare rings.
   */
  private drawOverlay(state: LaneState, flags: ResolvedOverlayFlags): void {
    const ctx = requireContext(this.overlayLayer, "overlayLayer");
    const graph = this.graph;
    const camera = this.camera;
    const width = this.overlayLayer.width;
    const height = this.overlayLayer.height;

    ctx.clearRect(0, 0, width, height);

    const aggregated = this.usesAggregated();

    if (flags.frontier) {
      const n = state.n;
      const frontier = state.frontier;

      if (aggregated) {
        ctx.fillStyle = this.frontierStroke;
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
          this.drawAggregatedOverlayMark(ctx, cx, cy, this.frontierStroke);
        }
      } else {
        ctx.strokeStyle = this.frontierStroke;
        ctx.lineWidth = this.frontierLineWidth;

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
    }

    if (flags.relaxedEdges && !aggregated) {
      const m = state.m;
      const targets = graph.targets;
      const srcOfEdge = this.srcOfEdge;

      ctx.strokeStyle = this.ghostStroke;
      ctx.lineWidth = this.ghostLineWidth;
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

    if (flags.forestGrow && !aggregated) {
      const m = state.m;
      const targets = graph.targets;
      const srcOfEdge = this.srcOfEdge;

      ctx.strokeStyle = this.mossStroke;
      ctx.lineWidth = FOREST_GROW_LINE_WIDTH;
      ctx.beginPath();

      let drewGrow = false;
      for (let e = 0; e < m; e += 1) {
        if (!this.shouldDrawForestGrow(e, state)) {
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
        drewGrow = true;
      }

      if (drewGrow) {
        ctx.stroke();
      }
    }

    if (flags.forestCut && !aggregated) {
      const m = state.m;
      const targets = graph.targets;
      const srcOfEdge = this.srcOfEdge;

      ctx.strokeStyle = this.mossStroke;
      ctx.lineWidth = FOREST_CUT_LINE_WIDTH;
      ctx.beginPath();

      let drewCut = false;
      for (let e = 0; e < m; e += 1) {
        if (!this.shouldDrawForestCut(e, state)) {
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
        drewCut = true;
      }

      if (drewCut) {
        ctx.stroke();
      }
    }

    if (flags.pivotFlares) {
      const n = state.n;

      if (aggregated) {
        const flareFill = `rgba(${this.emberRgb}, 0.85)`;
        for (let v = 0; v < n; v += 1) {
          if (!this.shouldDrawPivotFlare(v, state)) {
            continue;
          }
          const cx = projectX(camera, vertexX(graph, v));
          const cy = projectY(camera, vertexY(graph, v));
          this.drawAggregatedOverlayMark(ctx, cx, cy, flareFill);
        }
      } else {
        const radius = camera.radius;
        const innerRadius = radius * PIVOT_FLARE_INNER_SCALE;
        const outerRadius = radius * PIVOT_FLARE_OUTER_SCALE;

        ctx.strokeStyle = `rgba(${this.emberRgb}, 0.85)`;
        ctx.lineWidth = this.frontierLineWidth;

        for (let v = 0; v < n; v += 1) {
          if (!this.shouldDrawPivotFlare(v, state)) {
            continue;
          }

          const cx = projectX(camera, vertexX(graph, v));
          const cy = projectY(camera, vertexY(graph, v));

          ctx.beginPath();
          ctx.arc(cx, cy, outerRadius, 0, TAU);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(cx, cy, innerRadius, 0, TAU);
          ctx.stroke();
        }
      }
    }

    this.drawSourceFinishMarks(ctx, state, flags);
  }

  /**
   * Draw source and finish vertex rings on the overlay layer.
   */
  private drawSourceFinishMarks(
    ctx: DrawContext,
    state: LaneState,
    flags: ResolvedOverlayFlags,
  ): void {
    const graph = this.graph;
    const camera = this.camera;
    const n = state.n;
    const radius = camera.radius;
    const aggregated = this.usesAggregated();

    if (isVertexInRange(flags.source, n)) {
      const cx = projectX(camera, vertexX(graph, flags.source));
      const cy = projectY(camera, vertexY(graph, flags.source));
      if (aggregated) {
        this.drawAggregatedOverlayMark(ctx, cx, cy, this.sourceMarkStroke);
      } else {
        ctx.strokeStyle = this.sourceMarkStroke;
        ctx.lineWidth = this.markLineWidth;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.stroke();
      }
    }

    if (flags.finish !== undefined && isVertexInRange(flags.finish, n)) {
      const cx = projectX(camera, vertexX(graph, flags.finish));
      const cy = projectY(camera, vertexY(graph, flags.finish));
      if (aggregated) {
        this.drawAggregatedOverlayMark(ctx, cx, cy, this.finishMarkStroke);
      } else {
        ctx.strokeStyle = this.finishMarkStroke;
        ctx.lineWidth = this.markLineWidth;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.stroke();
      }
    }
  }

  /**
   * Redraw the fx layer: recursion-depth tint, batch blooms, and D-structure strip.
   */
  private drawFx(state: LaneState, flags: ResolvedOverlayFlags): void {
    const ctx = requireContext(this.fxLayer, "fxLayer");
    const width = this.fxLayer.width;
    const height = this.fxLayer.height;

    ctx.clearRect(0, 0, width, height);

    if (flags.recursionTint && state.recursionDepth > 0) {
      const depthFactor = Math.min(1, state.recursionDepth / RECURSION_DEPTH_CAP);
      const alpha = depthFactor * RECURSION_TINT_ALPHA_SCALE;
      ctx.fillStyle = `rgba(${this.emberRgb}, ${String(alpha)})`;
      ctx.fillRect(0, 0, width, height);
    }

    if (flags.batchBlooms && hasFiniteBloomBbox(state)) {
      const camera = this.camera;
      const pad = camera.radius * 2;
      const x0 = projectX(camera, state.bloomMinX) - pad;
      const y0 = projectY(camera, state.bloomMinY) - pad;
      const x1 = projectX(camera, state.bloomMaxX) + pad;
      const y1 = projectY(camera, state.bloomMaxY) + pad;
      ctx.fillStyle = `rgba(${this.emberRgb}, ${String(BLOOM_FILL_ALPHA)})`;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    if (flags.dstructStrip && state.dBlockCount > 0) {
      const blockCount = state.dBlockCount;
      let totalKeys = 0;
      for (let i = 0; i < blockCount; i += 1) {
        const size = state.dBlockSizes[i];
        if (size === undefined) {
          throw new Error(`dBlockSizes[${String(i)}] is missing`);
        }
        totalKeys += Math.max(0, size);
      }

      const stripY = height - this.dstructStripHeight;
      let x = 0;
      for (let i = 0; i < blockCount; i += 1) {
        const size = state.dBlockSizes[i];
        if (size === undefined) {
          throw new Error(`dBlockSizes[${String(i)}] is missing`);
        }
        const segmentWidth =
          totalKeys > 0
            ? Math.round((Math.max(0, size) / totalKeys) * width)
            : Math.round(width / blockCount);
        const nextX = i === blockCount - 1 ? width : Math.min(width, x + segmentWidth);
        const w = nextX - x;
        if (w > 0) {
          ctx.fillStyle = i % 2 === 0 ? `rgb(${this.emberRgb})` : this.stoneFill;
          ctx.fillRect(x, stripY, w, this.dstructStripHeight);
        }
        x = nextX;
      }
    }

    this.drawPhotoFinishPath(ctx, state, flags);
  }

  /**
   * Stroke the gold shortest-path polyline on the fx layer when photo-finish is active.
   */
  private drawPhotoFinishPath(
    ctx: DrawContext,
    state: LaneState,
    flags: ResolvedOverlayFlags,
  ): void {
    if (!flags.photoFinish) {
      return;
    }
    if (flags.finish === undefined || !isVertexInRange(flags.finish, state.n)) {
      return;
    }

    const path = buildPhotoFinishPath(state, flags.finish, flags.source);
    if (path === null) {
      return;
    }

    const graph = this.graph;
    const camera = this.camera;

    ctx.strokeStyle = PHOTO_FINISH_GOLD;
    ctx.lineWidth = this.photoFinishLineWidth;
    ctx.beginPath();

    for (let i = 0; i < path.length; i += 1) {
      const v = path[i];
      if (v === undefined) {
        throw new Error(`photo-finish path[${String(i)}] is missing`);
      }
      const x = projectX(camera, vertexX(graph, v));
      const y = projectY(camera, vertexY(graph, v));
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }

  /**
   * Blit edge, fill, overlay, and fx layers onto the target canvas.
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
      targetCtx.fillStyle = this.paperBg;
      targetCtx.fillRect(0, 0, width, height);
      targetCtx.drawImage(this.edgeLayer, 0, 0, width, height, 0, 0, width, height);
      targetCtx.drawImage(this.fillLayer, 0, 0, width, height, 0, 0, width, height);
      targetCtx.drawImage(this.overlayLayer, 0, 0, width, height, 0, 0, width, height);
      targetCtx.drawImage(this.fxLayer, 0, 0, width, height, 0, 0, width, height);
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
      targetCtx.drawImage(this.fxLayer, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  }
}
