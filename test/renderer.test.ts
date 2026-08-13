import { describe, expect, it } from "vitest";

import { packCsr, type Graph } from "../src/core/graph.ts";
import { LaneState } from "../src/harness/laneState.ts";
import { fitCamera, projectX, projectY } from "../src/render/camera.ts";
import { rgbForSettleOrder } from "../src/render/palette.ts";
import {
  AGGREGATED_RENDER_MIN_N,
  GHOST_WINDOW_OPS,
  PHOTO_FINISH_GOLD,
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

/** Recursion tint alpha for depth 3 — must match renderer.ts constants. */
const RECURSION_TINT_DEPTH_3_ALPHA = Math.min(1, 3 / 5) * 0.08;

/** Batch bloom fill alpha — must match renderer.ts. */
const BLOOM_FILL_ALPHA = 0.2;

/** D-structure strip height in pixels — must match renderer.ts. */
const DSTRUCT_STRIP_HEIGHT = 16;

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

function drawImageCount(surface: FakeCanvasSurface): number {
  const ctx = getFakeContext(surface);
  return ctx.calls.filter((call) => call.op === "drawImage").length;
}

function createRendererWithLayers(graph: Graph): {
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
  const renderer = new Renderer({
    target,
    createSurface,
    graph,
  });
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

function dstructStripFillRects(fx: FakeCanvasSurface): DrawCall[] {
  const stripY = CANVAS_SIZE - DSTRUCT_STRIP_HEIGHT;
  return fxFillRects(fx).filter(
    (call) => call.args[1] === stripY && call.args[3] === DSTRUCT_STRIP_HEIGHT,
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
});
