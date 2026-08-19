import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { packCsr, type Graph } from "../src/core/graph.ts";
import {
  FOREST_EDGE_CUT,
  FOREST_EDGE_GROW,
  FOREST_EDGE_NONE,
  LaneState,
} from "../src/harness/laneState.ts";
import { fitCamera, projectX, projectY } from "../src/render/camera.ts";
import {
  cssColorForSettleOrder,
  cssColorForSubtree,
  rgbForSettleOrder,
  rgbForSubtree,
} from "../src/render/palette.ts";
import {
  AGGREGATED_NODE_PX,
  AGGREGATED_RENDER_MIN_N,
  DSTRUCT_STRIP_HEIGHT,
  FOREST_GROW_WINDOW_OPS,
  GHOST_WINDOW_OPS,
  MARK_LINE_WIDTH,
  PHOTO_FINISH_GOLD,
  PHOTO_FINISH_LINE_WIDTH,
  PIVOT_FLARE_OUTER_SCALE,
  PIVOT_FLARE_WINDOW_OPS,
  Renderer,
} from "../src/render/renderer.ts";
import { EMBER_RGB, THEMES } from "../src/render/theme.ts";
import {
  createFakeSurface,
  getFakeContext,
  pixelAt,
  type DrawCall,
  type FakeCanvasSurface,
} from "./helpers/fake-canvas.ts";

const GHOST_STROKE = THEMES.dark.ghost;
const MOSS_STROKE = THEMES.dark.moss;

/** Recursion tint alpha for depth 3 — must match renderer.ts constants. */
const RECURSION_TINT_DEPTH_3_ALPHA = Math.min(1, 3 / 5) * 0.08;

/** Batch bloom fill alpha — must match renderer.ts. */
const BLOOM_FILL_ALPHA = 0.2;

const CANVAS_SIZE = 200;

function tinyGraph(): Graph {
  return packCsr(2, [{ from: 0, to: 1, weight: 1 }], [0.2, 0.8], [0.5, 0.5]);
}

/** Horizontal chain i -> i+1 for aggregated-path tests (issue #20). */
function chainGraph(n: number): Graph {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    x[i] = i / n;
    y[i] = 0.5;
  }
  const edges = [];
  for (let i = 0; i < n - 1; i += 1) {
    edges.push({ from: i, to: i + 1, weight: 1 });
  }
  return packCsr(n, edges, x, y);
}

function fillCallsSince(fill: FakeCanvasSurface, startIndex: number): readonly DrawCall[] {
  return getFakeContext(fill).calls.slice(startIndex);
}

function settledFillStyles(fill: FakeCanvasSurface): string[] {
  const styles: string[] = [];
  for (const call of getFakeContext(fill).calls) {
    if (call.op === "fill" && call.fillStyle !== undefined) {
      styles.push(call.fillStyle);
    }
  }
  return styles;
}

function drawImageCount(surface: FakeCanvasSurface): number {
  const ctx = getFakeContext(surface);
  return ctx.calls.filter((call) => call.op === "drawImage").length;
}

function createRendererWithLayers(
  graph: Graph,
  opts?: { pixelScale?: number },
): {
  renderer: Renderer;
  target: FakeCanvasSurface;
  edge: FakeCanvasSurface;
  fill: FakeCanvasSurface;
  overlay: FakeCanvasSurface;
  fx: FakeCanvasSurface;
} {
  const target: FakeCanvasSurface = createFakeSurface(CANVAS_SIZE, CANVAS_SIZE);
  const layers: FakeCanvasSurface[] = [];
  const createSurface = (w: number, h: number): FakeCanvasSurface => {
    const s = createFakeSurface(w, h);
    layers.push(s);
    return s;
  };
  const rendererOpts: {
    target: FakeCanvasSurface;
    createSurface: (w: number, h: number) => FakeCanvasSurface;
    graph: Graph;
    pixelScale?: number;
  } = {
    target,
    createSurface,
    graph,
  };
  if (opts?.pixelScale !== undefined) {
    rendererOpts.pixelScale = opts.pixelScale;
  }
  const renderer = new Renderer(rendererOpts);
  if (layers.length < 4) {
    throw new Error(`expected 4 offscreen layers, got ${String(layers.length)}`);
  }
  const edge = layers[0];
  if (edge === undefined) {
    throw new Error("edge layer is missing");
  }
  const fill = layers[1];
  if (fill === undefined) {
    throw new Error("fill layer is missing");
  }
  const overlay = layers[2];
  if (overlay === undefined) {
    throw new Error("overlay layer is missing");
  }
  const fx = layers[3];
  if (fx === undefined) {
    throw new Error("fx layer is missing");
  }
  return { renderer, target, edge, fill, overlay, fx };
}

function overlayCalls(overlay: FakeCanvasSurface): readonly DrawCall[] {
  return getFakeContext(overlay).calls;
}

function overlayArcCount(overlay: FakeCanvasSurface): number {
  return overlayCalls(overlay).filter((call) => call.op === "arc").length;
}

function overlayGhostStrokeCalls(overlay: FakeCanvasSurface): DrawCall[] {
  return overlayCalls(overlay).filter(
    (call) => call.op === "stroke" && call.strokeStyle === GHOST_STROKE,
  );
}

/** Edge line width in CSS pixels — must match renderer.ts (issue #80). */
const EDGE_LINE_WIDTH = 1;
/** Frontier ring line width in CSS pixels — must match renderer.ts (issue #80). */
const FRONTIER_LINE_WIDTH = 1.5;
const GHOST_LINE_WIDTH = 1.5;
/** Forest grow line width in CSS pixels — must match renderer.ts (issue #98). */
const FOREST_GROW_LINE_WIDTH = 1.5;
/** Forest cut line width in CSS pixels — must match renderer.ts (issue #98). */
const FOREST_CUT_LINE_WIDTH = 2.5;

function overlayForestGrowStrokeCalls(
  overlay: FakeCanvasSurface,
  lineWidth: number = FOREST_GROW_LINE_WIDTH,
): DrawCall[] {
  return overlayCalls(overlay).filter(
    (call) =>
      call.op === "stroke" && call.strokeStyle === MOSS_STROKE && call.lineWidth === lineWidth,
  );
}

function overlayForestCutStrokeCalls(
  overlay: FakeCanvasSurface,
  lineWidth: number = FOREST_CUT_LINE_WIDTH,
): DrawCall[] {
  return overlayCalls(overlay).filter(
    (call) =>
      call.op === "stroke" && call.strokeStyle === MOSS_STROKE && call.lineWidth === lineWidth,
  );
}

/** Pivot flare ring stroke — must match renderer.ts ember rgba stroke. */
const PIVOT_FLARE_STROKE = `rgba(${EMBER_RGB}, 0.85)`;

function overlayLineToCount(overlay: FakeCanvasSurface): number {
  return overlayCalls(overlay).filter((call) => call.op === "lineTo").length;
}

function fxCalls(fx: FakeCanvasSurface): readonly DrawCall[] {
  return getFakeContext(fx).calls;
}

function fxFillRects(fx: FakeCanvasSurface): DrawCall[] {
  return fxCalls(fx).filter((call) => call.op === "fillRect");
}

function hasRecursionTintFill(fx: FakeCanvasSurface): boolean {
  const expected = `rgba(${EMBER_RGB}, ${String(RECURSION_TINT_DEPTH_3_ALPHA)})`;
  return fxFillRects(fx).some(
    (call) =>
      call.fillStyle === expected &&
      call.args[0] === 0 &&
      call.args[1] === 0 &&
      call.args[2] === CANVAS_SIZE &&
      call.args[3] === CANVAS_SIZE,
  );
}

function hasBloomFill(fx: FakeCanvasSurface): boolean {
  const expected = `rgba(${EMBER_RGB}, ${String(BLOOM_FILL_ALPHA)})`;
  return fxFillRects(fx).some((call) => call.fillStyle === expected);
}

function dstructStripFillRects(
  fx: FakeCanvasSurface,
  stripHeight: number = DSTRUCT_STRIP_HEIGHT,
): DrawCall[] {
  const stripY = CANVAS_SIZE - stripHeight;
  return fxFillRects(fx).filter((call) => call.args[1] === stripY && call.args[3] === stripHeight);
}

function edgeStrokeCalls(edge: FakeCanvasSurface): DrawCall[] {
  return getFakeContext(edge).calls.filter(
    (call) => call.op === "stroke" && call.strokeStyle === THEMES.dark.hairline,
  );
}

function overlayFrontierStrokeCalls(overlay: FakeCanvasSurface): DrawCall[] {
  return overlayCalls(overlay).filter(
    (call) => call.op === "stroke" && call.strokeStyle === THEMES.dark.frontier,
  );
}

function overlayPivotFlareStrokeCalls(overlay: FakeCanvasSurface): DrawCall[] {
  return overlayCalls(overlay).filter(
    (call) => call.op === "stroke" && call.strokeStyle === PIVOT_FLARE_STROKE,
  );
}

/**
 * Half the widest scaled stroke overhang — mirrors renderer.ts strokeDirtyPad (issue #80).
 */
function strokeDirtyPadForScale(pixelScale: number): number {
  const mark = MARK_LINE_WIDTH * pixelScale;
  const photo = PHOTO_FINISH_LINE_WIDTH * pixelScale;
  const edge = EDGE_LINE_WIDTH * pixelScale;
  const frontier = FRONTIER_LINE_WIDTH * pixelScale;
  const ghost = GHOST_LINE_WIDTH * pixelScale;
  const forestGrow = FOREST_GROW_LINE_WIDTH * pixelScale;
  const forestCut = FOREST_CUT_LINE_WIDTH * pixelScale;
  return Math.ceil(Math.max(mark, photo, edge, frontier, ghost, forestGrow, forestCut) / 2);
}

/**
 * Inclusive pixel AABB for an incremental composite blit after a vertex dirty mark.
 *
 * Radius is node draw radius plus stroke dirty pad; bounds match dirtyRect clippedNodeAabb.
 */
function expectedVertexDirtyBlit(
  cx: number,
  cy: number,
  nodeRadius: number,
  strokeDirtyPad: number,
  canvasSize: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const dirtyRadius = nodeRadius + strokeDirtyPad;
  const x0 = Math.max(0, Math.floor(cx - dirtyRadius - 1));
  const y0 = Math.max(0, Math.floor(cy - dirtyRadius - 1));
  const x1 = Math.min(canvasSize - 1, Math.floor(cx + dirtyRadius + 1));
  const y1 = Math.min(canvasSize - 1, Math.floor(cy + dirtyRadius + 1));
  return {
    sx: x0,
    sy: y0,
    sw: x1 - x0 + 1,
    sh: y1 - y0 + 1,
  };
}

function sourceFinishMarkStrokes(overlay: FakeCanvasSurface): DrawCall[] {
  return overlayStrokeCalls(overlay).filter(
    (call) =>
      call.strokeStyle === THEMES.dark.sourceMark || call.strokeStyle === THEMES.dark.finishMark,
  );
}

function fxGoldStrokeCalls(fx: FakeCanvasSurface): DrawCall[] {
  return fxCalls(fx).filter(
    (call) => call.op === "stroke" && call.strokeStyle === PHOTO_FINISH_GOLD,
  );
}

function overlayStrokeCalls(overlay: FakeCanvasSurface): DrawCall[] {
  return overlayCalls(overlay).filter((call) => call.op === "stroke");
}

describe("Renderer", () => {
  it("draws settled and frontier state without throwing", () => {
    const graph = packCsr(2, [{ from: 0, to: 1, weight: 1 }], [0.2, 0.8], [0.5, 0.5]);
    const target: FakeCanvasSurface = createFakeSurface(200, 200);
    const renderer = new Renderer({
      target,
      createSurface: createFakeSurface,
      graph,
    });

    const state = new LaneState(2, graph.m);
    state.settleOrder[0] = 0;
    state.frontier[1] = 1;

    expect(() => renderer.draw(state)).not.toThrow();

    const drawImages = drawImageCount(target);
    expect(drawImages).toBeGreaterThanOrEqual(4);
  });

  it("blits only the dirty rect after the first full composite", () => {
    const graph = packCsr(2, [{ from: 0, to: 1, weight: 1 }], [0.2, 0.8], [0.5, 0.5]);
    const target: FakeCanvasSurface = createFakeSurface(200, 200);
    const renderer = new Renderer({
      target,
      createSurface: createFakeSurface,
      graph,
    });

    const state = new LaneState(2, graph.m);
    state.settleOrder[0] = 0;
    renderer.draw(state);

    const ctx = getFakeContext(target);
    const afterFirst = ctx.calls.length;

    state.settleOrder[1] = 1;
    renderer.draw(state);

    const incremental = ctx.calls.slice(afterFirst).filter((call) => call.op === "drawImage");
    expect(incremental).toHaveLength(4);
    for (const call of incremental) {
      const sw = call.args[3];
      const sh = call.args[4];
      expect(typeof sw).toBe("number");
      expect(typeof sh).toBe("number");
      expect(sw).toBeGreaterThan(0);
      expect(sh).toBeGreaterThan(0);
      expect(sw).toBeLessThan(200);
      expect(sh).toBeLessThan(200);
    }

    const afterSecond = ctx.calls.length;
    renderer.draw(state);
    const unchanged = ctx.calls.slice(afterSecond).filter((call) => call.op === "drawImage");
    expect(unchanged).toHaveLength(0);
  });

  it("draws frontier rings on the overlay layer by default", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.settleOrder[0] = 0;
    state.frontier[1] = 1;

    renderer.draw(state);

    expect(overlayArcCount(overlay)).toBeGreaterThan(0);
  });

  it("skips frontier rings on the overlay when frontier toggle is off", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.settleOrder[0] = 0;
    state.frontier[1] = 1;

    renderer.draw(state, { frontier: false });

    expect(overlayArcCount(overlay)).toBe(1);
  });

  it("draws relaxed-edge ghosts on the overlay by default", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.lastRelaxWork[0] = 0;
    state.work = 1;

    renderer.draw(state);

    expect(overlayLineToCount(overlay)).toBeGreaterThan(0);
    expect(overlayGhostStrokeCalls(overlay).length).toBeGreaterThan(0);
  });

  it("skips relaxed-edge ghosts on the overlay when relaxedEdges toggle is off", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.lastRelaxWork[0] = 0;
    state.work = 1;

    renderer.draw(state, { relaxedEdges: false });

    expect(overlayLineToCount(overlay)).toBe(0);
    expect(overlayGhostStrokeCalls(overlay)).toHaveLength(0);
  });

  it("does not draw ghosts outside the GHOST_WINDOW_OPS window", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.lastRelaxWork[0] = 0;
    state.work = GHOST_WINDOW_OPS;

    renderer.draw(state);

    expect(overlayLineToCount(overlay)).toBe(0);
    expect(overlayGhostStrokeCalls(overlay)).toHaveLength(0);
  });

  it("draws forest grow edges on the overlay by default", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.forestEdgeOp[0] = FOREST_EDGE_GROW;
    state.forestEdgeWork[0] = 0;
    state.work = 1;

    renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });

    expect(overlayLineToCount(overlay)).toBeGreaterThan(0);
    expect(overlayForestGrowStrokeCalls(overlay).length).toBeGreaterThan(0);
  });

  it("skips forest grow edges on the overlay when forestGrow toggle is off", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.forestEdgeOp[0] = FOREST_EDGE_GROW;
    state.forestEdgeWork[0] = 0;
    state.work = 1;

    renderer.draw(state, {
      frontier: false,
      relaxedEdges: false,
      pivotFlares: false,
      forestGrow: false,
    });

    expect(overlayLineToCount(overlay)).toBe(0);
    expect(overlayForestGrowStrokeCalls(overlay)).toHaveLength(0);
  });

  it("draws a fresh forest grow pulse after the live grow is cleared", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.forestEdgeOp[0] = FOREST_EDGE_NONE;
    state.forestEdgeWork[0] = 0;
    state.work = 1;

    renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });

    expect(overlayLineToCount(overlay)).toBeGreaterThan(0);
    expect(overlayForestGrowStrokeCalls(overlay).length).toBeGreaterThan(0);
  });

  it("does not draw forest grow pulses outside FOREST_GROW_WINDOW_OPS", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.forestEdgeOp[0] = FOREST_EDGE_NONE;
    state.forestEdgeWork[0] = 0;
    state.work = FOREST_GROW_WINDOW_OPS;

    renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });

    expect(overlayLineToCount(overlay)).toBe(0);
    expect(overlayForestGrowStrokeCalls(overlay)).toHaveLength(0);
  });

  it("draws forest cut edges on the overlay by default", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.forestEdgeOp[0] = FOREST_EDGE_CUT;
    state.forestEdgeWork[0] = 0;
    state.work = 1;

    renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });

    expect(overlayLineToCount(overlay)).toBeGreaterThan(0);
    expect(overlayForestCutStrokeCalls(overlay).length).toBeGreaterThan(0);
  });

  it("skips forest cut edges on the overlay when forestCut toggle is off", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.forestEdgeOp[0] = FOREST_EDGE_CUT;
    state.forestEdgeWork[0] = 0;
    state.work = 1;

    renderer.draw(state, {
      frontier: false,
      relaxedEdges: false,
      pivotFlares: false,
      forestCut: false,
    });

    expect(overlayLineToCount(overlay)).toBe(0);
    expect(overlayForestCutStrokeCalls(overlay)).toHaveLength(0);
  });

  it("colors settled vertices by forestTree when subtreePatchwork is on", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.settleOrder[0] = 0;
    state.settleOrder[1] = 1;
    state.forestTree[0] = 1;
    state.forestTree[1] = 2;

    renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });

    const fills = settledFillStyles(fill);
    expect(fills).toContain(cssColorForSubtree(1));
    expect(fills).toContain(cssColorForSubtree(2));
    expect(fills[0]).not.toBe(fills[1]);
  });

  it("uses the same patchwork color for vertices sharing a forestTree id", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.settleOrder[0] = 0;
    state.settleOrder[1] = 1;
    state.forestTree[0] = 7;
    state.forestTree[1] = 7;

    renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });

    const fills = settledFillStyles(fill);
    expect(fills).toEqual([cssColorForSubtree(7), cssColorForSubtree(7)]);
  });

  it("uses settle-order fills when subtreePatchwork is off even with forestTree set", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.settleOrder[0] = 0;
    state.settleOrder[1] = 1;
    state.forestTree[0] = 1;
    state.forestTree[1] = 2;

    renderer.draw(state, {
      frontier: false,
      relaxedEdges: false,
      pivotFlares: false,
      subtreePatchwork: false,
    });

    const fills = settledFillStyles(fill);
    expect(fills).toEqual([cssColorForSettleOrder(0, 2), cssColorForSettleOrder(1, 2)]);
  });

  it("draws recursion-depth tint on the fx layer by default", () => {
    const graph = tinyGraph();
    const { renderer, fx } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.recursionDepth = 3;

    renderer.draw(state);

    expect(hasRecursionTintFill(fx)).toBe(true);
  });

  it("skips recursion-depth tint on the fx layer when recursionTint toggle is off", () => {
    const graph = tinyGraph();
    const { renderer, fx } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.recursionDepth = 3;

    renderer.draw(state, { recursionTint: false });

    expect(hasRecursionTintFill(fx)).toBe(false);
    expect(fxFillRects(fx).some((call) => call.fillStyle?.includes(EMBER_RGB) === true)).toBe(
      false,
    );
  });

  it("draws pivot flare rings on the overlay beyond frontier rings", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.pivotFlareWork[0] = 0;
    state.work = 0;

    renderer.draw(state, { frontier: false, pivotFlares: true });

    expect(overlayArcCount(overlay)).toBeGreaterThan(0);
  });

  it("skips pivot flare rings on the overlay when pivotFlares toggle is off", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.pivotFlareWork[0] = 0;
    state.work = 0;

    renderer.draw(state, { frontier: false, pivotFlares: false });

    expect(overlayArcCount(overlay)).toBe(1);
  });

  it("draws batch bloom fill on the fx layer by default", () => {
    const graph = tinyGraph();
    const { renderer, fx } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.bloomActive = 1;
    state.bloomMinX = 0.1;
    state.bloomMinY = 0.4;
    state.bloomMaxX = 0.9;
    state.bloomMaxY = 0.6;

    renderer.draw(state);

    expect(hasBloomFill(fx)).toBe(true);
  });

  it("skips batch bloom fill on the fx layer when batchBlooms toggle is off", () => {
    const graph = tinyGraph();
    const { renderer, fx } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.bloomActive = 1;
    state.bloomMinX = 0.1;
    state.bloomMinY = 0.4;
    state.bloomMaxX = 0.9;
    state.bloomMaxY = 0.6;

    renderer.draw(state, { batchBlooms: false });

    expect(hasBloomFill(fx)).toBe(false);
  });

  it("draws D-structure strip segments on the fx layer by default", () => {
    const graph = tinyGraph();
    const { renderer, fx } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.dBlockCount = 2;
    state.dBlockSizes[0] = 3;
    state.dBlockSizes[1] = 1;

    renderer.draw(state);

    expect(dstructStripFillRects(fx).length).toBeGreaterThan(0);
  });

  it("skips D-structure strip segments on the fx layer when dstructStrip toggle is off", () => {
    const graph = tinyGraph();
    const { renderer, fx } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.dBlockCount = 2;
    state.dBlockSizes[0] = 3;
    state.dBlockSizes[1] = 1;

    renderer.draw(state, { dstructStrip: false });

    expect(dstructStripFillRects(fx)).toHaveLength(0);
  });

  it("draws photo-finish gold path on the fx layer when photoFinish is true", () => {
    const graph = tinyGraph();
    const { renderer, fx } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.pred[1] = 0;
    state.settleOrder[0] = 0;
    state.settleOrder[1] = 1;

    renderer.draw(state, {
      frontier: false,
      relaxedEdges: false,
      recursionTint: false,
      pivotFlares: false,
      batchBlooms: false,
      dstructStrip: false,
      photoFinish: true,
      finish: 1,
    });

    expect(fxGoldStrokeCalls(fx).length).toBeGreaterThan(0);
  });

  it("skips photo-finish gold path on the fx layer when photoFinish is false", () => {
    const graph = tinyGraph();
    const { renderer, fx } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);
    state.pred[1] = 0;
    state.settleOrder[0] = 0;
    state.settleOrder[1] = 1;

    renderer.draw(state, {
      frontier: false,
      relaxedEdges: false,
      recursionTint: false,
      pivotFlares: false,
      batchBlooms: false,
      dstructStrip: false,
      photoFinish: false,
      finish: 1,
    });

    expect(fxGoldStrokeCalls(fx)).toHaveLength(0);
  });

  it("redraws edge layer paper fill when setChrome switches to light tokens", () => {
    const graph = tinyGraph();
    const { renderer, edge } = createRendererWithLayers(graph);

    renderer.setChrome(THEMES.light);

    const paperFill = getFakeContext(edge).calls.find(
      (call) => call.op === "fillRect" && call.fillStyle === THEMES.light.paper,
    );
    expect(paperFill).toBeDefined();
  });

  it("draws source and finish vertex rings on the overlay layer", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);

    const state = new LaneState(2, graph.m);

    renderer.draw(state, {
      frontier: false,
      relaxedEdges: false,
      pivotFlares: false,
      source: 0,
    });

    const baseArcs = overlayArcCount(overlay);
    const baseStrokes = overlayStrokeCalls(overlay).length;

    renderer.draw(state, {
      frontier: false,
      relaxedEdges: false,
      pivotFlares: false,
      source: 0,
      finish: 1,
    });

    expect(overlayArcCount(overlay)).toBeGreaterThan(baseArcs);
    expect(overlayStrokeCalls(overlay).length).toBeGreaterThan(baseStrokes);
  });

  it("exports AGGREGATED_RENDER_MIN_N as the L preset (25000)", () => {
    expect(AGGREGATED_RENDER_MIN_N).toBe(25000);
  });

  it("uses arc fills below the aggregated threshold", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);
    const fillCtx = getFakeContext(fill);
    const before = fillCtx.calls.length;

    const state = new LaneState(2, graph.m);
    state.settleOrder[0] = 0;
    renderer.draw(state);

    const fillOps = fillCallsSince(fill, before);
    expect(fillOps.some((call) => call.op === "arc")).toBe(true);
    expect(fillOps.some((call) => call.op === "putImageData")).toBe(false);
  });

  it("blits ImageData node fills at the aggregated threshold", () => {
    const n = AGGREGATED_RENDER_MIN_N;
    const graph = chainGraph(n);
    const { renderer, fill } = createRendererWithLayers(graph);
    const fillCtx = getFakeContext(fill);
    const before = fillCtx.calls.length;

    const state = new LaneState(n, graph.m);
    state.settleOrder[0] = 0;
    renderer.draw(state);

    const fillOps = fillCallsSince(fill, before);
    expect(fillOps.some((call) => call.op === "putImageData")).toBe(true);
    expect(fillOps.some((call) => call.op === "arc")).toBe(false);

    const camera = fitCamera(graph, CANVAS_SIZE, CANVAS_SIZE);
    const x0 = graph.x[0];
    const y0 = graph.y[0];
    if (x0 === undefined || y0 === undefined) {
      throw new Error("chain graph missing vertex 0 coordinates");
    }
    const px = Math.floor(projectX(camera, x0));
    const py = Math.floor(projectY(camera, y0));
    const pixel = pixelAt(fill, px, py);
    const expected = rgbForSettleOrder(0, n);
    expect(pixel.a).toBe(255);
    expect(pixel.r).toBe(expected.r);
    expect(pixel.g).toBe(expected.g);
    expect(pixel.b).toBe(expected.b);
  });

  it("skips ghost relaxed-edge strokes in aggregated mode", () => {
    const n = AGGREGATED_RENDER_MIN_N;
    const graph = chainGraph(n);
    const { renderer, overlay } = createRendererWithLayers(graph);
    const overlayCtx = getFakeContext(overlay);
    const before = overlayCtx.calls.length;

    const state = new LaneState(n, graph.m);
    state.lastRelaxWork[0] = 0;
    state.work = 1;
    state.frontier[1] = 1;

    renderer.draw(state, { relaxedEdges: true, frontier: true });

    const overlayOps = overlayCalls(overlay).slice(before);
    expect(overlayOps.some((call) => call.op === "lineTo")).toBe(false);
    expect(overlayGhostStrokeCalls(overlay)).toHaveLength(0);
    expect(
      overlayOps.some((call) => call.op === "fillRect" && call.fillStyle === THEMES.dark.frontier),
    ).toBe(true);
  });

  it("skips forest edge strokes in aggregated mode but keeps patchwork fills", () => {
    const n = AGGREGATED_RENDER_MIN_N;
    const graph = chainGraph(n);
    const { renderer, overlay, fill } = createRendererWithLayers(graph);
    const overlayCtx = getFakeContext(overlay);
    const before = overlayCtx.calls.length;

    const state = new LaneState(n, graph.m);
    state.settleOrder[0] = 0;
    state.settleOrder[12500] = 1;
    state.forestTree[0] = 3;
    state.forestTree[12500] = 9;
    state.forestEdgeOp[0] = FOREST_EDGE_GROW;
    state.forestEdgeOp[1] = FOREST_EDGE_CUT;
    state.forestEdgeWork[0] = 0;
    state.forestEdgeWork[1] = 0;
    state.work = 1;

    renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });

    const overlayOps = overlayCalls(overlay).slice(before);
    expect(overlayOps.some((call) => call.op === "lineTo")).toBe(false);
    expect(overlayForestGrowStrokeCalls(overlay)).toHaveLength(0);
    expect(overlayForestCutStrokeCalls(overlay)).toHaveLength(0);

    const camera = fitCamera(graph, CANVAS_SIZE, CANVAS_SIZE);
    const x0 = graph.x[0];
    const y0 = graph.y[0];
    const xMid = graph.x[12500];
    const yMid = graph.y[12500];
    if (x0 === undefined || y0 === undefined || xMid === undefined || yMid === undefined) {
      throw new Error("chain graph missing vertex coordinates");
    }
    const px0 = Math.floor(projectX(camera, x0));
    const py0 = Math.floor(projectY(camera, y0));
    const pxMid = Math.floor(projectX(camera, xMid));
    const pyMid = Math.floor(projectY(camera, yMid));
    const pixel0 = pixelAt(fill, px0, py0);
    const pixelMid = pixelAt(fill, pxMid, pyMid);
    const expected0 = rgbForSubtree(3);
    const expectedMid = rgbForSubtree(9);
    expect(pixel0.r).toBe(expected0.r);
    expect(pixel0.g).toBe(expected0.g);
    expect(pixel0.b).toBe(expected0.b);
    expect(pixelMid.r).toBe(expectedMid.r);
    expect(pixelMid.g).toBe(expectedMid.g);
    expect(pixelMid.b).toBe(expectedMid.b);
  });

  it("rejects non-finite or non-positive pixelScale", () => {
    const graph = tinyGraph();
    const target = createFakeSurface(CANVAS_SIZE, CANVAS_SIZE);
    const make = (pixelScale: number) =>
      new Renderer({ target, createSurface: createFakeSurface, graph, pixelScale });
    expect(() => make(0)).toThrow(/pixelScale/);
    expect(() => make(-1)).toThrow(/pixelScale/);
    expect(() => make(NaN)).toThrow(/pixelScale/);
    expect(() => make(Infinity)).toThrow(/pixelScale/);
  });

  it("scales photo-finish gold lineWidth with pixelScale", () => {
    const drawPhotoFinish = (pixelScale?: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, fx } =
        pixelScale === undefined
          ? createRendererWithLayers(graph)
          : createRendererWithLayers(graph, { pixelScale });

      const state = new LaneState(2, graph.m);
      state.pred[1] = 0;
      state.settleOrder[0] = 0;
      state.settleOrder[1] = 1;

      renderer.draw(state, {
        frontier: false,
        relaxedEdges: false,
        recursionTint: false,
        pivotFlares: false,
        batchBlooms: false,
        dstructStrip: false,
        photoFinish: true,
        finish: 1,
      });

      return fx;
    };

    const fxDefault = drawPhotoFinish();
    const goldDefault = fxGoldStrokeCalls(fxDefault);
    expect(goldDefault.length).toBeGreaterThan(0);
    for (const call of goldDefault) {
      expect(call.lineWidth).toBe(PHOTO_FINISH_LINE_WIDTH);
    }

    const fxScale1 = drawPhotoFinish(1);
    const goldScale1 = fxGoldStrokeCalls(fxScale1);
    expect(goldScale1.length).toBeGreaterThan(0);
    for (const call of goldScale1) {
      expect(call.lineWidth).toBe(PHOTO_FINISH_LINE_WIDTH);
    }

    const fxScale2 = drawPhotoFinish(2);
    const goldScale2 = fxGoldStrokeCalls(fxScale2);
    expect(goldScale2.length).toBeGreaterThan(0);
    for (const call of goldScale2) {
      expect(call.lineWidth).toBe(PHOTO_FINISH_LINE_WIDTH * 2);
    }
  });

  it("scales source and finish mark lineWidth with pixelScale", () => {
    const drawSourceFinishMarks = (pixelScale: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, overlay } = createRendererWithLayers(graph, { pixelScale });

      const state = new LaneState(2, graph.m);

      renderer.draw(state, {
        frontier: false,
        relaxedEdges: false,
        pivotFlares: false,
        source: 0,
        finish: 1,
      });

      return overlay;
    };

    const overlayScale1 = drawSourceFinishMarks(1);
    const marksScale1 = sourceFinishMarkStrokes(overlayScale1);
    expect(marksScale1.length).toBeGreaterThan(0);
    for (const call of marksScale1) {
      expect(call.lineWidth).toBe(MARK_LINE_WIDTH);
    }

    const overlayScale2 = drawSourceFinishMarks(2);
    const marksScale2 = sourceFinishMarkStrokes(overlayScale2);
    expect(marksScale2.length).toBeGreaterThan(0);
    for (const call of marksScale2) {
      expect(call.lineWidth).toBe(MARK_LINE_WIDTH * 2);
    }
  });

  it("scales D-structure strip height with pixelScale", () => {
    const drawDstructStrip = (pixelScale: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, fx } = createRendererWithLayers(graph, { pixelScale });

      const state = new LaneState(2, graph.m);
      state.dBlockCount = 2;
      state.dBlockSizes[0] = 3;
      state.dBlockSizes[1] = 1;

      renderer.draw(state);

      return fx;
    };

    const fxScale1 = drawDstructStrip(1);
    const stripScale1 = dstructStripFillRects(fxScale1);
    expect(stripScale1.length).toBeGreaterThan(0);
    for (const call of stripScale1) {
      expect(call.args[3]).toBe(DSTRUCT_STRIP_HEIGHT);
    }

    const stripHeightScale2 = DSTRUCT_STRIP_HEIGHT * 2;
    const fxScale2 = drawDstructStrip(2);
    const stripScale2 = dstructStripFillRects(fxScale2, stripHeightScale2);
    expect(stripScale2.length).toBeGreaterThan(0);
    for (const call of stripScale2) {
      expect(call.args[3]).toBe(stripHeightScale2);
    }
  });

  it("scales edge stroke lineWidth with pixelScale", () => {
    const drawEdges = (pixelScale?: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, edge } =
        pixelScale === undefined
          ? createRendererWithLayers(graph)
          : createRendererWithLayers(graph, { pixelScale });

      const state = new LaneState(2, graph.m);
      renderer.draw(state);

      return edge;
    };

    const edgeDefault = drawEdges();
    const strokesDefault = edgeStrokeCalls(edgeDefault);
    expect(strokesDefault.length).toBeGreaterThan(0);
    for (const call of strokesDefault) {
      expect(call.lineWidth).toBe(EDGE_LINE_WIDTH);
    }

    const edgeScale1 = drawEdges(1);
    const strokesScale1 = edgeStrokeCalls(edgeScale1);
    expect(strokesScale1.length).toBeGreaterThan(0);
    for (const call of strokesScale1) {
      expect(call.lineWidth).toBe(EDGE_LINE_WIDTH);
    }

    const edgeScale2 = drawEdges(2);
    const strokesScale2 = edgeStrokeCalls(edgeScale2);
    expect(strokesScale2.length).toBeGreaterThan(0);
    for (const call of strokesScale2) {
      expect(call.lineWidth).toBe(EDGE_LINE_WIDTH * 2);
    }
  });

  it("scales frontier ring lineWidth with pixelScale", () => {
    const drawFrontier = (pixelScale: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, overlay } = createRendererWithLayers(graph, { pixelScale });

      const state = new LaneState(2, graph.m);
      state.frontier[1] = 1;

      renderer.draw(state, { relaxedEdges: false, pivotFlares: false });

      return overlay;
    };

    const overlayScale1 = drawFrontier(1);
    const frontierScale1 = overlayFrontierStrokeCalls(overlayScale1);
    expect(frontierScale1.length).toBeGreaterThan(0);
    for (const call of frontierScale1) {
      expect(call.lineWidth).toBe(FRONTIER_LINE_WIDTH);
    }

    const overlayScale2 = drawFrontier(2);
    const frontierScale2 = overlayFrontierStrokeCalls(overlayScale2);
    expect(frontierScale2.length).toBeGreaterThan(0);
    for (const call of frontierScale2) {
      expect(call.lineWidth).toBe(FRONTIER_LINE_WIDTH * 2);
    }
  });

  it("scales ghost stroke lineWidth with pixelScale", () => {
    const drawGhost = (pixelScale: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, overlay } = createRendererWithLayers(graph, { pixelScale });

      const state = new LaneState(2, graph.m);
      state.lastRelaxWork[0] = 0;
      state.work = 1;

      renderer.draw(state, { frontier: false, pivotFlares: false });

      return overlay;
    };

    const overlayScale1 = drawGhost(1);
    const ghostScale1 = overlayGhostStrokeCalls(overlayScale1);
    expect(ghostScale1.length).toBeGreaterThan(0);
    for (const call of ghostScale1) {
      expect(call.lineWidth).toBe(GHOST_LINE_WIDTH);
    }

    const overlayScale2 = drawGhost(2);
    const ghostScale2 = overlayGhostStrokeCalls(overlayScale2);
    expect(ghostScale2.length).toBeGreaterThan(0);
    for (const call of ghostScale2) {
      expect(call.lineWidth).toBe(GHOST_LINE_WIDTH * 2);
    }
  });

  it("scales forest grow stroke lineWidth with pixelScale", () => {
    const drawGrow = (pixelScale: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, overlay } = createRendererWithLayers(graph, { pixelScale });
      const state = new LaneState(2, graph.m);
      state.forestEdgeOp[0] = FOREST_EDGE_GROW;
      state.forestEdgeWork[0] = 0;
      state.work = 1;
      renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });
      return overlay;
    };

    const overlayScale1 = drawGrow(1);
    const growScale1 = overlayForestGrowStrokeCalls(overlayScale1, FOREST_GROW_LINE_WIDTH);
    expect(growScale1.length).toBeGreaterThan(0);
    for (const call of growScale1) {
      expect(call.lineWidth).toBe(FOREST_GROW_LINE_WIDTH);
    }

    const overlayScale2 = drawGrow(2);
    const growScale2 = overlayForestGrowStrokeCalls(overlayScale2, FOREST_GROW_LINE_WIDTH * 2);
    expect(growScale2.length).toBeGreaterThan(0);
    for (const call of growScale2) {
      expect(call.lineWidth).toBe(FOREST_GROW_LINE_WIDTH * 2);
    }
  });

  it("scales forest cut stroke lineWidth with pixelScale", () => {
    const drawCut = (pixelScale: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, overlay } = createRendererWithLayers(graph, { pixelScale });
      const state = new LaneState(2, graph.m);
      state.forestEdgeOp[0] = FOREST_EDGE_CUT;
      state.forestEdgeWork[0] = 0;
      state.work = 1;
      renderer.draw(state, { frontier: false, relaxedEdges: false, pivotFlares: false });
      return overlay;
    };

    const overlayScale1 = drawCut(1);
    const cutScale1 = overlayForestCutStrokeCalls(overlayScale1, FOREST_CUT_LINE_WIDTH);
    expect(cutScale1.length).toBeGreaterThan(0);
    for (const call of cutScale1) {
      expect(call.lineWidth).toBe(FOREST_CUT_LINE_WIDTH);
    }

    const overlayScale2 = drawCut(2);
    const cutScale2 = overlayForestCutStrokeCalls(overlayScale2, FOREST_CUT_LINE_WIDTH * 2);
    expect(cutScale2.length).toBeGreaterThan(0);
    for (const call of cutScale2) {
      expect(call.lineWidth).toBe(FOREST_CUT_LINE_WIDTH * 2);
    }
  });

  /**
   * Source-grep pin: PHOTO_FINISH_LINE_WIDTH (3) dominates FOREST_CUT_LINE_WIDTH (2.5)
   * at every pixelScale, so including forest widths never changes strokeDirtyPad.
   * A behavioral pad assertion cannot exist until a forest width exceeds photo-finish.
   */
  it("strokeDirtyPad Math.max includes forest grow and cut line widths", () => {
    const rendererSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/render/renderer.ts"),
      "utf8",
    );
    expect(rendererSource).toContain("this.forestGrowLineWidth");
    expect(rendererSource).toContain("this.forestCutLineWidth");
    const padAssign = rendererSource.slice(
      rendererSource.indexOf("this.strokeDirtyPad = Math.ceil("),
    );
    const padBlock = padAssign.slice(0, padAssign.indexOf(");") + 2);
    expect(padBlock).toContain("this.forestGrowLineWidth");
    expect(padBlock).toContain("this.forestCutLineWidth");
  });

  it("pivot flare rings use the scaled frontier width", () => {
    const drawPivotFlare = (pixelScale: number): FakeCanvasSurface => {
      const graph = tinyGraph();
      const { renderer, overlay } = createRendererWithLayers(graph, { pixelScale });

      const state = new LaneState(2, graph.m);
      state.pivotFlareWork[0] = 0;
      state.work = 0;

      renderer.draw(state, { frontier: false, pivotFlares: true });

      return overlay;
    };

    const overlayScale1 = drawPivotFlare(1);
    const flareScale1 = overlayPivotFlareStrokeCalls(overlayScale1);
    expect(flareScale1.length).toBeGreaterThan(0);
    for (const call of flareScale1) {
      expect(call.lineWidth).toBe(FRONTIER_LINE_WIDTH);
    }

    const overlayScale2 = drawPivotFlare(2);
    const flareScale2 = overlayPivotFlareStrokeCalls(overlayScale2);
    expect(flareScale2.length).toBeGreaterThan(0);
    for (const call of flareScale2) {
      expect(call.lineWidth).toBe(FRONTIER_LINE_WIDTH * 2);
    }
  });

  it("dirty blit covers scaled stroke overhang at pixelScale 2", () => {
    const assertFrontierDirtyBlit = (pixelScale: number, expectedPad: number): void => {
      const graph = tinyGraph();
      const { renderer, target } = createRendererWithLayers(graph, { pixelScale });

      const state = new LaneState(2, graph.m);
      renderer.draw(state);

      const ctx = getFakeContext(target);
      const afterFirst = ctx.calls.length;

      state.frontier[1] = 1;
      renderer.draw(state);

      const incremental = ctx.calls.slice(afterFirst).filter((call) => call.op === "drawImage");
      expect(incremental).toHaveLength(4);

      const camera = fitCamera(graph, CANVAS_SIZE, CANVAS_SIZE);
      const vx = graph.x[1];
      const vy = graph.y[1];
      if (vx === undefined || vy === undefined) {
        throw new Error("tinyGraph missing vertex 1 coordinates");
      }
      const cx = projectX(camera, vx);
      const cy = projectY(camera, vy);
      const pad = strokeDirtyPadForScale(pixelScale);
      expect(pad).toBe(expectedPad);
      const expected = expectedVertexDirtyBlit(cx, cy, camera.radius, pad, CANVAS_SIZE);

      for (const call of incremental) {
        expect(call.args[1]).toBe(expected.sx);
        expect(call.args[2]).toBe(expected.sy);
        expect(call.args[3]).toBe(expected.sw);
        expect(call.args[4]).toBe(expected.sh);
        expect(call.args[5]).toBe(expected.sx);
        expect(call.args[6]).toBe(expected.sy);
        expect(call.args[7]).toBe(expected.sw);
        expect(call.args[8]).toBe(expected.sh);
      }
    };

    assertFrontierDirtyBlit(1, 2);
    assertFrontierDirtyBlit(2, 3);
  });

  const flareOnlyOverlays = {
    frontier: false,
    relaxedEdges: false,
    recursionTint: false,
    pivotFlares: true,
    batchBlooms: false,
    dstructStrip: false,
    forestGrow: false,
    forestCut: false,
    subtreePatchwork: false,
  } as const;

  const expectedPivotFlareDirtyBlit = (
    graph: Graph,
    pixelScale: number,
  ): { sx: number; sy: number; sw: number; sh: number } => {
    const camera = fitCamera(graph, CANVAS_SIZE, CANVAS_SIZE);
    const vx = graph.x[1];
    const vy = graph.y[1];
    if (vx === undefined || vy === undefined) {
      throw new Error("tinyGraph missing vertex 1 coordinates");
    }
    const cx = projectX(camera, vx);
    const cy = projectY(camera, vy);
    const flareRadius = Math.ceil(camera.radius * PIVOT_FLARE_OUTER_SCALE);
    const pad = strokeDirtyPadForScale(pixelScale);
    return expectedVertexDirtyBlit(cx, cy, flareRadius, pad, CANVAS_SIZE);
  };

  const assertPivotFlareDirtyBlitCalls = (
    incremental: DrawCall[],
    expected: { sx: number; sy: number; sw: number; sh: number },
  ): void => {
    expect(incremental).toHaveLength(4);
    for (const call of incremental) {
      expect(call.args[1]).toBe(expected.sx);
      expect(call.args[2]).toBe(expected.sy);
      expect(call.args[3]).toBe(expected.sw);
      expect(call.args[4]).toBe(expected.sh);
      expect(call.args[5]).toBe(expected.sx);
      expect(call.args[6]).toBe(expected.sy);
      expect(call.args[7]).toBe(expected.sw);
      expect(call.args[8]).toBe(expected.sh);
    }
  };

  it("dirty blit covers pivot flare outer ring at pixelScale 1", () => {
    const graph = tinyGraph();
    const { renderer, target } = createRendererWithLayers(graph, { pixelScale: 1 });

    const state = new LaneState(2, graph.m);
    renderer.draw(state, flareOnlyOverlays);

    const ctx = getFakeContext(target);
    const afterFirst = ctx.calls.length;

    state.pivotFlareWork[1] = 0;
    state.work = 0;
    renderer.draw(state, flareOnlyOverlays);

    const incremental = ctx.calls.slice(afterFirst).filter((call) => call.op === "drawImage");
    assertPivotFlareDirtyBlitCalls(incremental, expectedPivotFlareDirtyBlit(graph, 1));
  });

  it("dirty blit covers pivot flare outer ring on expiry at pixelScale 1", () => {
    const graph = tinyGraph();
    const { renderer, target } = createRendererWithLayers(graph, { pixelScale: 1 });

    const state = new LaneState(2, graph.m);
    state.pivotFlareWork[1] = 0;
    state.work = 0;
    renderer.draw(state, flareOnlyOverlays);

    const ctx = getFakeContext(target);
    const afterFirst = ctx.calls.length;

    state.work = PIVOT_FLARE_WINDOW_OPS;
    renderer.draw(state, flareOnlyOverlays);

    const incremental = ctx.calls.slice(afterFirst).filter((call) => call.op === "drawImage");
    assertPivotFlareDirtyBlitCalls(incremental, expectedPivotFlareDirtyBlit(graph, 1));
  });

  it("aggregated node footprint is 2×2 at pixelScale 1 and 4×4 at pixelScale 2", () => {
    const n = AGGREGATED_RENDER_MIN_N;

    const assertFootprint = (fill: FakeCanvasSurface, graph: Graph, footprintPx: number): void => {
      const camera = fitCamera(graph, CANVAS_SIZE, CANVAS_SIZE);
      const x0 = graph.x[0];
      const y0 = graph.y[0];
      if (x0 === undefined || y0 === undefined) {
        throw new Error("chain graph missing vertex 0 coordinates");
      }
      const px = Math.floor(projectX(camera, x0));
      const py = Math.floor(projectY(camera, y0));
      const expected = rgbForSettleOrder(0, n);

      const corner = pixelAt(fill, px, py);
      expect(corner.a).toBe(255);
      expect(corner.r).toBe(expected.r);
      expect(corner.g).toBe(expected.g);
      expect(corner.b).toBe(expected.b);

      const inner = pixelAt(fill, px + footprintPx - 1, py + footprintPx - 1);
      expect(inner.a).toBe(255);
      expect(inner.r).toBe(expected.r);
      expect(inner.g).toBe(expected.g);
      expect(inner.b).toBe(expected.b);

      if (px + footprintPx < CANVAS_SIZE) {
        const beyond = pixelAt(fill, px + footprintPx, py);
        expect(beyond.a).toBe(0);
      }
    };

    const graph = chainGraph(n);

    const { renderer: renderer1, fill: fill1 } = createRendererWithLayers(graph);
    const state1 = new LaneState(n, graph.m);
    state1.settleOrder[0] = 0;
    renderer1.draw(state1);
    assertFootprint(fill1, graph, AGGREGATED_NODE_PX);

    const { renderer: renderer2, fill: fill2 } = createRendererWithLayers(graph, {
      pixelScale: 2,
    });
    const state2 = new LaneState(n, graph.m);
    state2.settleOrder[0] = 0;
    renderer2.draw(state2);
    assertFootprint(fill2, graph, AGGREGATED_NODE_PX * 2);
  });
});
