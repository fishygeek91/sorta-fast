import { describe, expect, it } from "vitest";

import { packCsr, type Graph } from "../src/core/graph.ts";
import { LaneState } from "../src/harness/laneState.ts";
import { GHOST_WINDOW_OPS, PHOTO_FINISH_GOLD, Renderer } from "../src/render/renderer.ts";
import {
  createFakeSurface,
  getFakeContext,
  type DrawCall,
  type FakeCanvasSurface,
} from "./helpers/fake-canvas.ts";

const GHOST_STROKE = "rgba(40, 40, 40, 0.35)";

/** BMSSP ember accent — must match renderer.ts. */
const EMBER_RGB = "180, 70, 40";

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

function drawImageCount(surface: FakeCanvasSurface): number {
  const ctx = getFakeContext(surface);
  return ctx.calls.filter((call) => call.op === "drawImage").length;
}

function createRendererWithLayers(graph: Graph): {
  renderer: Renderer;
  target: FakeCanvasSurface;
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
  const overlay = layers[2];
  if (overlay === undefined) {
    throw new Error("overlay layer is missing");
  }
  const fx = layers[3];
  if (fx === undefined) {
    throw new Error("fx layer is missing");
  }
  return { renderer, target, overlay, fx };
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
});
