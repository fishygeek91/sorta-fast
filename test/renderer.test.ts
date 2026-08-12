import { describe, expect, it } from "vitest";

import { packCsr } from "../src/core/graph.ts";
import { LaneState } from "../src/harness/laneState.ts";
import { Renderer } from "../src/render/renderer.ts";
import {
  createFakeSurface,
  getFakeContext,
  type FakeCanvasSurface,
} from "./helpers/fake-canvas.ts";

function drawImageCount(surface: FakeCanvasSurface): number {
  const ctx = getFakeContext(surface);
  return ctx.calls.filter((call) => call.op === "drawImage").length;
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

    const state = new LaneState(2);
    state.settleOrder[0] = 0;
    state.frontier[1] = 1;

    expect(() => renderer.draw(state)).not.toThrow();

    const drawImages = drawImageCount(target);
    expect(drawImages).toBeGreaterThanOrEqual(3);
  });
});
