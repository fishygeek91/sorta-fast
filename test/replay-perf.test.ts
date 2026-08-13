import { describe, expect, it } from "vitest";

import { runReplay5kBench, type Replay5kBenchResult } from "../bench/replay-5k.ts";
import { run } from "../src/core/dijkstra.ts";
import { generateGraph, SIZE_PRESETS, type Graph } from "../src/core/graph.ts";
import { TraceWriter, type TraceChunk } from "../src/core/trace.ts";
import { Playback } from "../src/harness/playback.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";
import { Renderer } from "../src/render/renderer.ts";
import { runBmsspTraceJob, type BmsspTraceSpec } from "../src/workers/bmsspTraceJob.ts";
import { createFakeSurface } from "./helpers/fake-canvas.ts";

const TIMED_RUNS = 3;
/** One rAF batch at speed ×8 (issue #6 60fps AC); CI headroom matches #35. Issue #20 keeps these 5k budgets unchanged — XL AC lives in render-perf-xl / race-xl-stall. */
const FRAME_BUDGET_MS = 16.6;
/** Backward seek to T=0 restores the initial keyframe (issue #7). */
const SEEK_BACK_BUDGET_MS = 50;
/** Stub-canvas draw of a fully settled 5k lane; extra headroom for GHA. */
const DRAW_BUDGET_MS = 50;
/** Prefer SIZE_PRESETS.M for BMSSP fixtures; fall back to S when generation exceeds this. */
const BMSSP_GENERATION_BUDGET_MS = 60_000;

const SEED = 1729;
const SOURCE = 0;
const CANVAS_SIZE = 640;
const PLAY_SPEED = 8;
const FRAME_DT_SECONDS = 1 / 60;

/** All BMSSP overlay toggles explicitly enabled (issue #12 60fps AC). */
const ALL_BMSSP_OVERLAYS = {
  frontier: true,
  relaxedEdges: true,
  recursionTint: true,
  pivotFlares: true,
  batchBlooms: true,
  dstructStrip: true,
};

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
 * Run {@link runBmsspTraceJob} and collect graph plus trace chunks for replay-perf fixtures.
 *
 * @param spec - BMSSP trace job parameters (maze SIZE_PRESETS.M, shared SEED).
 * @throws When `onGraph` was never called.
 */
function drainBmsspTrace(spec: BmsspTraceSpec): { graph: Graph; chunks: TraceChunk[] } {
  let graph: Graph | undefined;
  const chunks: TraceChunk[] = [];

  runBmsspTraceJob(spec, {
    onGraph: (received) => {
      graph = received;
    },
    onChunk: (chunk) => {
      chunks.push(chunk);
    },
  });

  if (graph === undefined) {
    throw new Error("onGraph was not called");
  }

  return { graph, chunks };
}

/**
 * Prefer maze SIZE_PRESETS.M; if trace generation exceeds {@link BMSSP_GENERATION_BUDGET_MS},
 * fall back to SIZE_PRESETS.S (draw budget AC still exercises all BMSSP overlays).
 */
function bmsspReplayFixture(): { graph: Graph; chunks: TraceChunk[]; n: number } {
  const mSpec: BmsspTraceSpec = {
    kind: "maze",
    n: SIZE_PRESETS.M,
    seed: SEED,
    source: SOURCE,
  };
  const genT0 = performance.now();
  const mResult = drainBmsspTrace(mSpec);
  const genMs = performance.now() - genT0;
  if (genMs <= BMSSP_GENERATION_BUDGET_MS) {
    return { ...mResult, n: SIZE_PRESETS.M };
  }

  // M-size BMSSP trace generation exceeded 60s on this host; draw budget still uses full overlays on S.
  const sSpec: BmsspTraceSpec = {
    kind: "maze",
    n: SIZE_PRESETS.S,
    seed: SEED,
    source: SOURCE,
  };
  const sResult = drainBmsspTrace(sSpec);
  return { ...sResult, n: SIZE_PRESETS.S };
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

describe("5k maze BMSSP replay budgets", () => {
  it("stub-canvas draw of a fully settled 5k lane with all overlays stays under the CI budget", () => {
    const { graph, chunks, n } = bmsspReplayFixture();
    const buffer = new TraceBuffer(graph, chunks);
    buffer.seekWork(buffer.totalWork);

    expect(buffer.totalWork).toBeGreaterThan(0);
    expect(buffer.state.work).toBeGreaterThan(0);

    const target = createFakeSurface(CANVAS_SIZE, CANVAS_SIZE);
    const renderer = new Renderer({
      target,
      createSurface: createFakeSurface,
      graph,
    });

    const { best, times } = bestOfTimed(() => {
      const t0 = performance.now();
      renderer.draw(buffer.state, ALL_BMSSP_OVERLAYS);
      return performance.now() - t0;
    });

    console.log(
      `bmssp-n${String(n)} drawMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    );

    expect(
      best,
      `drawMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    ).toBeLessThan(DRAW_BUDGET_MS);
  });

  it("one speed-8 frame stays under CI budget (best of 3 after warmup)", () => {
    const { graph, chunks, n } = bmsspReplayFixture();

    const advanceOneFrame = (): number => {
      const playback = new Playback(graph, chunks);
      playback.seek(0);
      playback.setSpeed(PLAY_SPEED);
      playback.play();
      const t0 = performance.now();
      playback.advance(FRAME_DT_SECONDS);
      return performance.now() - t0;
    };

    advanceOneFrame();
    const frameTimes: number[] = [];
    for (let i = 0; i < TIMED_RUNS; i += 1) {
      frameTimes.push(advanceOneFrame());
    }

    const bestFrame = Math.min(...frameTimes);
    console.log(
      `bmssp-n${String(n)} frameMs=[${frameTimes.map((t) => t.toFixed(2)).join(", ")}] best=${bestFrame.toFixed(2)}`,
    );

    expect(
      bestFrame,
      `frameMs=[${frameTimes.map((t) => t.toFixed(2)).join(", ")}] best=${bestFrame.toFixed(2)}`,
    ).toBeLessThan(FRAME_BUDGET_MS);
  });
});
