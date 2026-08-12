/**
 * Node bench: 5k-node maze Dijkstra trace replay (issues #6, #7).
 *
 * Issue #6 AC targets 5k Dijkstra replay; maze SIZE_PRESETS.M is 5000 nodes.
 * City M uses Bowyer–Watson Delaunay (O(n²), issue #32) and can time out CI —
 * this bench uses maze (linear generation) instead.
 *
 * Run: npm run bench:replay
 */

import { run } from "../src/core/dijkstra.ts";
import { generateGraph, SIZE_PRESETS, type Graph } from "../src/core/graph.ts";
import { scanCosts, TraceWriter, type TraceChunk } from "../src/core/trace.ts";
import { Playback } from "../src/harness/playback.ts";
import { TraceBuffer } from "../src/harness/traceBuffer.ts";

const SEED = 1729;
const SOURCE = 0;
const PLAY_SPEED = 8;
const FRAME_DT_SECONDS = 1 / 60;

/** Timings from one harness replay pass (no renderer). */
export type Replay5kBenchResult = {
  events: number;
  work: number;
  applyEndMs: number;
  seekBackMs: number;
  frameMs: number;
};

/**
 * Drain Dijkstra into TraceWriter chunks and sum billed work via scanCosts.
 */
function drainToChunks(graph: Graph): {
  chunks: readonly TraceChunk[];
  events: number;
  work: number;
} {
  const writer = new TraceWriter();
  let events = 0;
  const gen = run(graph, SOURCE);

  for (;;) {
    const step = gen.next();
    if (step.done) {
      break;
    }
    const event = step.value;
    writer.append(event);
    events += 1;
  }

  const chunks = writer.takeChunks();
  let work = 0;
  for (const chunk of chunks) {
    work += scanCosts(chunk).work;
  }

  return { chunks, events, work };
}

/**
 * Build a 5k maze graph, drain Dijkstra, and time TraceBuffer / Playback ops.
 *
 * TraceBuffer construction (keyframe apply) is outside the timed seeks; each
 * measurement uses a fresh buffer or playback instance.
 */
export function runReplay5kBench(): Replay5kBenchResult {
  const graph = generateGraph("maze", SIZE_PRESETS.M, SEED);
  const { chunks, events, work } = drainToChunks(graph);

  const bufForward = new TraceBuffer(graph, chunks);
  const applyT0 = performance.now();
  bufForward.seekWork(bufForward.totalWork);
  const applyEndMs = performance.now() - applyT0;

  const bufBack = new TraceBuffer(graph, chunks);
  bufBack.seekWork(bufBack.totalWork);
  const seekBackT0 = performance.now();
  bufBack.seekWork(0);
  const seekBackMs = performance.now() - seekBackT0;

  const playback = new Playback(graph, chunks);
  playback.seek(0);
  playback.setSpeed(PLAY_SPEED);
  playback.play();
  const frameT0 = performance.now();
  playback.advance(FRAME_DT_SECONDS);
  const frameMs = performance.now() - frameT0;

  return { events, work, applyEndMs, seekBackMs, frameMs };
}

if (process.argv[1]?.includes("replay-5k")) {
  const result = runReplay5kBench();
  console.log(
    `replay-5k: events=${String(result.events)} work=${String(result.work)} ` +
      `applyEndMs=${result.applyEndMs.toFixed(2)} seekBackMs=${result.seekBackMs.toFixed(2)} ` +
      `frameMs=${result.frameMs.toFixed(2)}`,
  );
}
