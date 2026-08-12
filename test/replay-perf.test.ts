import { describe, expect, it } from "vitest";

import { runReplay5kBench, type Replay5kBenchResult } from "../bench/replay-5k.ts";
import { run } from "../src/core/dijkstra.ts";
import { generateGraph, SIZE_PRESETS } from "../src/core/graph.ts";
import { TraceWriter } from "../src/core/trace.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";
import { Renderer } from "../src/render/renderer.ts";
import { createFakeSurface } from "./helpers/fake-canvas.ts";

const TIMED_RUNS = 3;
/** One rAF batch at speed ×8 (issue #6 60fps AC); CI headroom matches #35. */
const FRAME_BUDGET_MS = 16.6;
/** Backward seek to T=0 restores the initial keyframe (issue #7). */
const SEEK_BACK_BUDGET_MS = 50;
/** Stub-canvas draw of a fully settled 5k lane; extra headroom for GHA. */
const DRAW_BUDGET_MS = 50;

const SEED = 1729;
const SOURCE = 0;
const CANVAS_SIZE = 640;

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

describe("5k maze Dijkstra replay budgets", () => {
  it("one speed-8 frame and backward seek stay under CI budgets (best of 3 after warmup)", () => {
    runReplay5kBench();

    const frames: Replay5kBenchResult[] = [];
    for (let i = 0; i < TIMED_RUNS; i += 1) {
      frames.push(runReplay5kBench());
    }

    const last = frames[frames.length - 1];
    if (last === undefined) {
      throw new Error("timed runs produced no result");
    }

    const bestFrame = Math.min(...frames.map((row) => row.frameMs));
    const bestSeekBack = Math.min(...frames.map((row) => row.seekBackMs));

    expect(last.events).toBeGreaterThan(0);
    expect(last.work).toBeGreaterThan(0);
    expect(
      bestFrame,
      `frameMs=[${frames.map((row) => row.frameMs.toFixed(2)).join(", ")}] best=${bestFrame.toFixed(2)}`,
    ).toBeLessThan(FRAME_BUDGET_MS);
    expect(
      bestSeekBack,
      `seekBackMs=[${frames.map((row) => row.seekBackMs.toFixed(2)).join(", ")}] best=${bestSeekBack.toFixed(2)}`,
    ).toBeLessThan(SEEK_BACK_BUDGET_MS);
  });

  it("stub-canvas draw of a fully settled 5k lane stays under the CI budget", () => {
    const graph = generateGraph("maze", SIZE_PRESETS.M, SEED);
    const writer = new TraceWriter();
    const gen = run(graph, SOURCE);
    for (;;) {
      const step = gen.next();
      if (step.done) {
        break;
      }
      writer.append(step.value);
    }
    const chunks = writer.takeChunks();
    const buffer = new TraceBuffer(graph, chunks);
    buffer.seekWork(buffer.totalWork);

    const target = createFakeSurface(CANVAS_SIZE, CANVAS_SIZE);
    const renderer = new Renderer({
      target,
      createSurface: createFakeSurface,
      graph,
    });

    const { best, times } = bestOfTimed(() => {
      const t0 = performance.now();
      renderer.draw(buffer.state);
      return performance.now() - t0;
    });

    expect(
      best,
      `drawMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    ).toBeLessThan(DRAW_BUDGET_MS);
  });
});
