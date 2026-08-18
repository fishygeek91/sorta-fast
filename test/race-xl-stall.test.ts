import { beforeAll, describe, expect, it } from "vitest";

import { packCsr, SIZE_PRESETS, type Graph } from "../src/core/graph.ts";
import { OP_COST, type TraceChunk, type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { RaceScheduler } from "../src/harness/raceScheduler.ts";
import { Renderer } from "../src/render/renderer.ts";
import { createFakeSurface } from "./helpers/fake-canvas.ts";

/** Issue #20 AC: no main-thread stalls above this during XL-scale append + draw. */
const STALL_BUDGET_MS = 50;
const TIMED_RUNS = 3;
const LANE_COUNT = 3;

/** Race lane canvas size (design.md §3.4). */
const CANVAS_SIZE = 400;

/** Race lane DPR cap — the 2× HiDPI backing store is CANVAS_SIZE × this (issue #80). */
const HIDPI_PIXEL_SCALE = 2;

/** Small streamed chunk — enough events to exercise append without a 100k Dijkstra trace. */
const SETTLE_EVENT_COUNT = 1024;

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
 * Encode events into trace chunks via {@link TraceWriter}.
 */
function chunksFromEvents(events: readonly TraceEvent[]): ReturnType<TraceWriter["takeChunks"]> {
  const writer = new TraceWriter();
  for (const event of events) {
    writer.append(event);
  }
  return writer.takeChunks();
}

/**
 * Return the first chunk from encoded events.
 *
 * @throws When no chunk was produced.
 */
function firstChunk(events: readonly TraceEvent[]): TraceChunk {
  const chunks = chunksFromEvents(events);
  const chunk = chunks[0];
  if (chunk === undefined) {
    throw new Error("expected at least one chunk from events");
  }
  return chunk;
}

/**
 * Build a small settle-only trace chunk for streaming stall measurement.
 */
function settleChunk(count: number): TraceChunk {
  const events: TraceEvent[] = [];
  for (let v = 0; v < count; v += 1) {
    events.push({ k: "settle", v, order: v, cost: OP_COST.settle });
  }
  return firstChunk(events);
}

describe("XL 3-lane append + draw stall budget (issue #20)", () => {
  let graph: Graph;
  let chunk: TraceChunk;
  let renderer: Renderer;
  let hidpiRenderer: Renderer;

  beforeAll(() => {
    const n = SIZE_PRESETS.XL;

    const buildT0 = performance.now();
    graph = xlChainGraph(n);
    const buildMs = performance.now() - buildT0;

    chunk = settleChunk(SETTLE_EVENT_COUNT);
    expect(chunk.count).toBe(SETTLE_EVENT_COUNT);

    const target = createFakeSurface(CANVAS_SIZE, CANVAS_SIZE);
    renderer = new Renderer({
      target,
      createSurface: createFakeSurface,
      graph,
    });

    const hidpiTarget = createFakeSurface(
      CANVAS_SIZE * HIDPI_PIXEL_SCALE,
      CANVAS_SIZE * HIDPI_PIXEL_SCALE,
    );
    hidpiRenderer = new Renderer({
      target: hidpiTarget,
      createSurface: createFakeSurface,
      graph,
      pixelScale: HIDPI_PIXEL_SCALE,
    });

    console.log(
      `race-xl-stall: n=${String(n)} m=${String(graph.m)} events=${String(chunk.count)} buildMs=${buildMs.toFixed(2)}`,
    );
  }, 300_000);

  it("appendChunk on all lanes plus lane-0 draw stays under the 50ms stall budget (best of 3 after warmup)", () => {
    const measureAppendAndDraw = (): number => {
      const race = new RaceScheduler(graph, LANE_COUNT);
      const t0 = performance.now();
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        race.appendChunk(lane, chunk);
      }
      renderer.draw(race.laneState(0));
      return performance.now() - t0;
    };

    const { best, times } = bestOfTimed(measureAppendAndDraw);

    console.log(
      `race-xl-stall: stallMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    );

    expect(
      best,
      `stallMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    ).toBeLessThan(STALL_BUDGET_MS);
  }, 300_000);

  /** Issue #80 HiDPI datapoint — 50ms stall claim is load-bearing at 2× DPR (800×800 backing store). */
  it("appendChunk on all lanes plus lane-0 draw stays under the 50ms stall budget at pixelScale 2 (800×800 backing store)", () => {
    const measureAppendAndDraw = (): number => {
      const race = new RaceScheduler(graph, LANE_COUNT);
      const t0 = performance.now();
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        race.appendChunk(lane, chunk);
      }
      hidpiRenderer.draw(race.laneState(0));
      return performance.now() - t0;
    };

    const { best, times } = bestOfTimed(measureAppendAndDraw);

    console.log(
      `race-xl-stall: pixelScale=2 stallMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    );

    expect(
      best,
      `stallMs=[${times.map((t) => t.toFixed(2)).join(", ")}] best=${best.toFixed(2)}`,
    ).toBeLessThan(STALL_BUDGET_MS);
  }, 300_000);
});
