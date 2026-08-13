/**
 * Headless playback facade (issue #7, design.md §4.3).
 *
 * Wires {@link WorkClock} (op-unit cursor, play/pause/speed) to
 * {@link TraceBuffer} (scrub-safe lane state). No DOM, `Date.now()`, or
 * `Math.random()`.
 */

import { type Graph } from "../core/graph.ts";
import { type TraceChunk } from "../core/trace.ts";
import { LaneState } from "./laneState.ts";
import { TraceBuffer } from "./traceBuffer.ts";
import { WorkClock } from "./workClock.ts";

/**
 * Single-lane race playback: clock cursor drives buffer seeks.
 *
 * All mutation methods return the live {@link TraceBuffer.state} so callers
 * can paint without an extra lookup. Call {@link beginStreaming} before
 * {@link appendChunk} so playback can continue past the current trace end.
 */
export class Playback {
  readonly clock: WorkClock;
  readonly buffer: TraceBuffer;
  /** When false, {@link advance} stays playing at the trace end until {@link markComplete}. */
  private complete = true;

  /**
   * Build a paused playback at T = 0 over one lane's trace chunks.
   *
   * @param graph - CSR graph for relax target lookup in the buffer.
   * @param chunks - Completed trace slabs for this lane (may be `[]` for streaming).
   * @param findPivotsK - Optional FindPivots k forwarded to {@link TraceBuffer}
   *   (default `bmsspParams(n).k`). Needed so paper/override races narrate the
   *   k that the worker actually ran.
   * @throws If graph or chunk validation fails in {@link TraceBuffer}.
   */
  constructor(graph: Graph, chunks: readonly TraceChunk[], findPivotsK?: number) {
    this.clock = new WorkClock();
    this.buffer = new TraceBuffer(graph, chunks, 0, findPivotsK);
  }

  /**
   * Mark the trace as still growing so {@link advance} does not pause at the end.
   *
   * Call before appending chunks from a worker while playback is running.
   */
  beginStreaming(): void {
    this.complete = false;
  }

  /**
   * Mark the trace as fully received.
   *
   * If the clock cursor is already at or past {@link totalWork}, pauses playback.
   */
  markComplete(): void {
    this.complete = true;
    if (this.clock.cursor >= this.totalWork) {
      this.pause();
    }
  }

  /**
   * Append a completed trace slab without moving the live playback cursor.
   *
   * @param chunk - New slab from the worker stream.
   * @returns Live lane state (unchanged cursor; totals and keyframes grow).
   * @throws If chunk validation fails in {@link TraceBuffer.appendChunk}.
   */
  appendChunk(chunk: TraceChunk): LaneState {
    this.buffer.appendChunk(chunk);
    return this.buffer.state;
  }

  /** Begin advancing the work clock on each {@link advance} call. */
  play(): void {
    this.clock.play();
  }

  /** Stop advancing the work clock; {@link advance} leaves the cursor unchanged. */
  pause(): void {
    this.clock.pause();
  }

  /**
   * Set the dimensionless play-speed multiplier on the work clock.
   *
   * @param speed - Must be finite and >= 0.
   * @throws If `speed` is not finite or is negative.
   */
  setSpeed(speed: number): void {
    this.clock.setSpeed(speed);
  }

  /**
   * Jump to billed op position `t` on both clock and buffer.
   *
   * `t` is clamped to `[0, totalWork]` before seeking. Does not change
   * play/pause state.
   *
   * @param t - Target billed ops; must be finite and >= 0.
   * @returns Live lane state after the seek.
   * @throws If `t` is not finite or is negative.
   */
  seek(t: number): LaneState {
    if (!Number.isFinite(t)) {
      throw new Error(`t must be finite, got ${String(t)}`);
    }
    if (t < 0) {
      throw new Error(`t must be >= 0, got ${String(t)}`);
    }

    const clamped = Math.min(t, this.totalWork);
    this.clock.seek(clamped);
    this.buffer.seekWork(clamped);
    return this.buffer.state;
  }

  /**
   * Advance the work clock by `dtSeconds`, sync the buffer, and clamp at end.
   *
   * When the cursor moves past {@link totalWork}, seeks to the end and pauses
   * only if the trace is {@link markComplete complete}.
   *
   * @param dtSeconds - Elapsed seconds since the last frame; must be finite and >= 0.
   * @returns Live lane state after the advance.
   * @throws If `dtSeconds` is not finite or is negative.
   */
  advance(dtSeconds: number): LaneState {
    this.clock.advance(dtSeconds);

    if (this.clock.cursor > this.totalWork) {
      this.seek(this.totalWork);
      if (this.complete) {
        this.pause();
      }
    } else {
      this.buffer.seekWork(this.clock.cursor);
    }

    return this.buffer.state;
  }

  /**
   * Apply exactly one trace event, then align the clock to billed work.
   *
   * No-op when all events are already applied.
   *
   * @returns Live lane state after the step (unchanged at end of trace).
   */
  stepEvent(): LaneState {
    this.buffer.stepEvent();
    this.clock.seek(this.buffer.state.work);
    return this.buffer.state;
  }

  /**
   * Advance the work-clock cursor by one billed op, then sync the buffer.
   *
   * {@link TraceBuffer.seekWork} applies every event whose cumulative work is
   * ≤ the cursor; a cost-k event is fully crossed only after k successive
   * stepOp calls (e.g. a heap push with `cmps: 3` needs three clicks).
   *
   * @returns Live lane state after the step.
   */
  stepOp(): LaneState {
    const nextWork = Math.min(this.clock.cursor + 1, this.totalWork);
    return this.seek(nextWork);
  }

  /** Live lane state at the current playback cursor. */
  get state(): LaneState {
    return this.buffer.state;
  }

  /** Total billed ops across all trace events in this lane. */
  get totalWork(): number {
    return this.buffer.totalWork;
  }

  /** Total trace event count in this lane. */
  get totalEvents(): number {
    return this.buffer.totalEvents;
  }
}
