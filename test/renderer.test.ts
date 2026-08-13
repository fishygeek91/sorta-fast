import { describe, expect, it } from "vitest";

import { packCsr, type Graph } from "../src/core/graph.ts";
import { LaneState } from "../src/harness/laneState.ts";
import { GHOST_WINDOW_OPS, Renderer } from "../src/render/renderer.ts";
import {
  createFakeSurface,
  getFakeContext,
  type DrawCall,
  type FakeCanvasSurface,
} from "./helpers/fake-canvas.ts";

const GHOST_STROKE = "rgba(40, 40, 40, 0.35)";

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
} {
  const target: FakeCanvasSurface = createFakeSurface(200, 200);
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
  if (layers.length < 3) {
    throw new Error(`expected 3 offscreen layers, got ${String(layers.length)}`);
  }
  const overlay = layers[2];
  if (overlay === undefined) {
    throw new Error("overlay layer is missing");
  }
  return { renderer, target, overlay };
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
    expect(drawImages).toBeGreaterThanOrEqual(3);
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
    expect(incremental).toHaveLength(3);
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

    expect(overlayArcCount(overlay)).toBe(0);
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
});
