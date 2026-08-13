import { beforeAll, describe, expect, it } from "vitest";

import { packCsr, SIZE_PRESETS, type Graph } from "../src/core/graph.ts";
import { LaneState } from "../src/harness/laneState.ts";
import { AGGREGATED_RENDER_MIN_N, Renderer } from "../src/render/renderer.ts";
import { createFakeSurface } from "./helpers/fake-canvas.ts";

/** Issue #20 AC: ≥30fps stub-canvas draw on a fully settled XL lane. */
const XL_DRAW_BUDGET_MS = 33.3;
const TIMED_RUNS = 3;

/** Race lane canvas size (design.md §3.4). */
const CANVAS_SIZE = 400;

/**
 * Best-of-N after a warmup call of `run`.
 */
function bestOfTimed(run: () => number): { best: number; times: number[] } {
  run();
  const times: number[] = [];
  for (let i = 0; i < TIMED_RUNS; i += 1) {
    times.push(run());
  }
  return { best: Math.min(...times), times };
}

/**
 * Horizontal chain i → i+1 with layout x[i]=i/n, y[i]=0.5 (issue #20 XL fixture).
 *
 * @param n - Vertex count; must be ≥ {@link AGGREGATED_RENDER_MIN_N} for aggregated draw.
 */
function xlChainGraph(n: number): Graph {
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

/**
 * Lane snapshot with every vertex settled in index order.
 */
function fullySettledState(n: number, m: number): LaneState {
  const state = new LaneState(n, m);
  for (let v = 0; v < n; v += 1) {
    state.settleOrder[v] = v;
  }
  state.settledCount = n;
  return state;
}

describe("XL aggregated render draw budget (issue #20)", () => {
  let graph: Graph;
  let state: LaneState;
  let renderer: Renderer;

  beforeAll(() => {
    const n = SIZE_PRESETS.XL;
    expect(n).toBeGreaterThanOrEqual(AGGREGATED_RENDER_MIN_N);

    const buildT0 = performance.now();
    graph = xlChainGraph(n);
    const buildMs = performance.now() - buildT0;

    state = fullySettledState(graph.n, graph.m);

    const target = createFakeSurface(CANVAS_SIZE, CANVAS_SIZE);
    renderer = new Renderer({
      target,
      createSurface: createFakeSurface,
      graph,
    });

    console.log(
      `render-perf-xl: n=${String(n)} m=${String(graph.m)} buildMs=${buildMs.toFixed(2)}`,
    );
  }, 300_000);

  it("stub-canvas draw of a fully settled XL lane stays under the 30fps budget (best of 3 after warmup)", () => {
    const { best, times } = bestOfTimed(() => {
      const t0 = performance.now();
      renderer.draw(state);
      return performance.now() - t0;
    });

    console.log(
      `render-perf-xl: drawMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    );

    expect(
      best,
      `drawMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    ).toBeLessThan(XL_DRAW_BUDGET_MS);
  }, 300_000);
});
