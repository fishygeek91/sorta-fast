import { describe, expect, it } from "vitest";

import { packCsr, type Graph } from "../src/core/graph.ts";
import { LaneState, UNSETTLED } from "../src/harness/laneState.ts";
import { fitCamera, projectX, projectY } from "../src/render/camera.ts";
import { AGGREGATED_RENDER_MIN_N, Renderer, type DiffOverlayOpts } from "../src/render/renderer.ts";
import { parseRgb, THEMES } from "../src/render/theme.ts";
import {
  createFakeSurface,
  getFakeContext,
  pixelAt,
  type DrawCall,
  type FakeCanvasSurface,
} from "./helpers/fake-canvas.ts";

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

function overlayLineToCount(overlay: FakeCanvasSurface): number {
  return overlayCalls(overlay).filter((call) => call.op === "lineTo").length;
}

const marbleOpts: DiffOverlayOpts = {
  leftPersona: "marble",
  rightPersona: "marble",
};

const emberRightOpts: DiffOverlayOpts = {
  leftPersona: "marble",
  rightPersona: "ember",
};

describe("Renderer.drawDiff", () => {
  it("fills left-only settle with marble persona color", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);
    const fillCtx = getFakeContext(fill);
    const before = fillCtx.calls.length;

    const left = new LaneState(2, graph.m);
    const right = new LaneState(2, graph.m);
    left.settleOrder[0] = 0;

    renderer.drawDiff(left, right, marbleOpts);

    const fillOps = fillCallsSince(fill, before);
    const fillCall = fillOps.find((call) => call.op === "fill");
    expect(fillCall).toBeDefined();
    expect(fillCall?.fillStyle).toBe(THEMES.dark.diffMarble);
  });

  it("fills right-only settle with ember persona color", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);
    const fillCtx = getFakeContext(fill);
    const before = fillCtx.calls.length;

    const left = new LaneState(2, graph.m);
    const right = new LaneState(2, graph.m);
    right.settleOrder[1] = 0;

    renderer.drawDiff(left, right, emberRightOpts);

    const fillOps = fillCallsSince(fill, before);
    const fillCall = fillOps.find((call) => call.op === "fill");
    expect(fillCall?.fillStyle).toBe(THEMES.dark.diffEmber);
  });

  it("fills both-settled vertex with diffBoth color", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);
    const fillCtx = getFakeContext(fill);
    const before = fillCtx.calls.length;

    const left = new LaneState(2, graph.m);
    const right = new LaneState(2, graph.m);
    left.settleOrder[0] = 0;
    right.settleOrder[0] = 1;

    renderer.drawDiff(left, right, marbleOpts);

    const fillOps = fillCallsSince(fill, before);
    const fillCall = fillOps.find((call) => call.op === "fill");
    expect(fillCall?.fillStyle).toBe(THEMES.dark.diffBoth);
  });

  it("strokes ink OOO ticks on the overlay for out-of-order settles", () => {
    const graph = tinyGraph();
    const { renderer, overlay } = createRendererWithLayers(graph);
    const overlayCtx = getFakeContext(overlay);
    const before = overlayCtx.calls.length;

    const left = new LaneState(2, graph.m);
    const right = new LaneState(2, graph.m);
    left.outOfOrder[0] = 1;

    renderer.drawDiff(left, right, marbleOpts);

    const overlayOps = overlayCalls(overlay).slice(before);
    expect(overlayOps.some((call) => call.op === "moveTo")).toBe(true);
    expect(overlayOps.some((call) => call.op === "lineTo")).toBe(true);
    expect(
      overlayOps.some((call) => call.op === "stroke" && call.strokeStyle === THEMES.dark.ink),
    ).toBe(true);
  });

  it("clears fill on unsettle without leaving marble-only residue", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);

    const left = new LaneState(2, graph.m);
    const right = new LaneState(2, graph.m);
    left.settleOrder[0] = 0;

    renderer.drawDiff(left, right, marbleOpts);

    left.settleOrder[0] = UNSETTLED;
    expect(() => renderer.drawDiff(left, right, marbleOpts)).not.toThrow();

    const fillCtx = getFakeContext(fill);
    const before = fillCtx.calls.length;
    right.settleOrder[0] = UNSETTLED;
    renderer.drawDiff(left, right, marbleOpts);

    const fillOps = fillCallsSince(fill, before);
    const marbleArcs = fillOps.filter(
      (call) => call.op === "fill" && call.fillStyle === THEMES.dark.diffMarble,
    );
    expect(marbleArcs).toHaveLength(0);
  });

  it("uses light-theme diffMarble after setChrome", () => {
    const graph = tinyGraph();
    const { renderer, fill } = createRendererWithLayers(graph);
    renderer.setChrome(THEMES.light);

    const fillCtx = getFakeContext(fill);
    const before = fillCtx.calls.length;

    const left = new LaneState(2, graph.m);
    const right = new LaneState(2, graph.m);
    left.settleOrder[0] = 0;

    renderer.drawDiff(left, right, marbleOpts);

    const fillOps = fillCallsSince(fill, before);
    const fillCall = fillOps.find((call) => call.op === "fill");
    expect(fillCall?.fillStyle).toBe(THEMES.light.diffMarble);
  });

  it("uses ImageData fills and skips OOO ticks in aggregated mode", () => {
    const n = AGGREGATED_RENDER_MIN_N;
    const graph = chainGraph(n);
    const { renderer, fill, overlay } = createRendererWithLayers(graph);
    const fillCtx = getFakeContext(fill);
    const before = fillCtx.calls.length;

    const left = new LaneState(n, graph.m);
    const right = new LaneState(n, graph.m);
    left.settleOrder[0] = 0;
    left.outOfOrder[0] = 1;

    renderer.drawDiff(left, right, marbleOpts);

    const fillOps = fillCallsSince(fill, before);
    expect(fillOps.some((call) => call.op === "putImageData")).toBe(true);
    expect(fillOps.some((call) => call.op === "arc")).toBe(false);
    expect(overlayLineToCount(overlay)).toBe(0);

    const camera = fitCamera(graph, CANVAS_SIZE, CANVAS_SIZE);
    const x0 = graph.x[0];
    const y0 = graph.y[0];
    if (x0 === undefined || y0 === undefined) {
      throw new Error("chain graph missing vertex 0 coordinates");
    }
    const px = Math.floor(projectX(camera, x0));
    const py = Math.floor(projectY(camera, y0));
    const pixel = pixelAt(fill, px, py);
    const expected = parseRgb(THEMES.dark.diffMarble);
    expect(pixel.a).toBe(255);
    expect(pixel.r).toBe(expected.r);
    expect(pixel.g).toBe(expected.g);
    expect(pixel.b).toBe(expected.b);
  });

  it("composites to target without throwing", () => {
    const graph = tinyGraph();
    const { renderer, target } = createRendererWithLayers(graph);
    const left = new LaneState(2, graph.m);
    const right = new LaneState(2, graph.m);
    left.settleOrder[0] = 0;

    const before = drawImageCount(target);
    expect(() => renderer.drawDiff(left, right, marbleOpts)).not.toThrow();
    expect(drawImageCount(target)).toBeGreaterThan(before);
  });
});
