/**
 * Headless multi-lane race scheduler (issue #13, design.md §4.3).
 *
 * One shared {@link WorkClock} drives {@link TraceBuffer} seeks per lane so
 * all lanes share the same billed-op cursor during a race. Supports
 * stream-while-generating: applied playback clamps to generated work on
 * incomplete lanes. No DOM, `Date.now()`, or `Math.random()`.
 */

import { type Graph } from "../core/graph.ts";
import { type TraceChunk } from "../core/trace.ts";
import { LaneState, UNSETTLED } from "./laneState.ts";
import { TraceBuffer } from "./traceBuffer.ts";
import { WorkClock } from "./workClock.ts";

/**
 * Multi-lane race playback: shared clock, per-lane trace buffers.
 *
 * Lanes start in streaming mode (incomplete). {@link appliedCursor} is
 * `min(clock.cursor, streamCap)` so playback stays aligned on billed ops
 * until every lane has finished generating.
 */
export class RaceScheduler {
  readonly clock: WorkClock;
  readonly graph: Graph;
  /** SSSP source vertex shared by all lane trace buffers. */
  readonly source: number;

  private readonly buffers: TraceBuffer[];
  private readonly laneCompleteFlags: boolean[];
  private readonly _laneCount: number;
  /** Photo-finish target vertex, or `null` until {@link setFinishVertex}. */
  private _finishVertex: number | null = null;

  /**
   * Build a paused scheduler at T = 0 with empty trace buffers per lane.
   *
   * @param graph - CSR graph shared by all lanes.
   * @param laneCount - Number of race lanes; must be 2 or 3.
   * @param source - SSSP source vertex for every lane buffer (default 0).
   * @throws If `laneCount` is not 2 or 3, `source` is out of range, or graph validation fails.
   */
  constructor(graph: Graph, laneCount: number, source: number = 0) {
    if (!Number.isInteger(laneCount) || (laneCount !== 2 && laneCount !== 3)) {
      throw new Error(`laneCount must be 2 or 3, got ${String(laneCount)}`);
    }

    const n = graph.n;
    if (n > 0) {
      if (!Number.isInteger(source) || source < 0 || source >= n) {
        throw new Error(`source must be an integer in [0, ${String(n)}), got ${String(source)}`);
      }
    }

    this.graph = graph;
    this.source = source;
    this._laneCount = laneCount;
    this.clock = new WorkClock();
    this.buffers = [];
    this.laneCompleteFlags = [];

    for (let lane = 0; lane < laneCount; lane += 1) {
      this.buffers.push(new TraceBuffer(graph, [], source));
      this.laneCompleteFlags.push(false);
    }
  }

  /** Number of race lanes (2 or 3). */
  get laneCount(): number {
    return this._laneCount;
  }

  /**
   * Billed ops actually applied to all lanes.
   *
   * `min(clock.cursor, streamCap)` — may trail `clock.cursor` while lanes
   * are still generating.
   */
  get appliedCursor(): number {
    return Math.min(this.clock.cursor, this.streamCap);
  }

  /** Whether every lane has been marked complete via {@link markLaneComplete}. */
  get allComplete(): boolean {
    for (let lane = 0; lane < this._laneCount; lane += 1) {
      if (!this.laneCompleteFlags[lane]) {
        return false;
      }
    }
    return true;
  }

  /** Maximum {@link TraceBuffer.totalWork} across all lanes. */
  get maxTotalWork(): number {
    let max = 0;
    for (const buffer of this.buffers) {
      if (buffer.totalWork > max) {
        max = buffer.totalWork;
      }
    }
    return max;
  }

  /**
   * Upper bound on applied playback while racing.
   *
   * When any lane is incomplete: minimum `totalWork` among incomplete lanes.
   * When all lanes are complete: {@link maxTotalWork}.
   */
  get streamCap(): number {
    if (this.allComplete) {
      return this.maxTotalWork;
    }

    let min = Infinity;
    for (let lane = 0; lane < this._laneCount; lane += 1) {
      if (!this.laneCompleteFlags[lane]) {
        const buffer = this.buffers[lane];
        if (buffer === undefined) {
          throw new Error(`missing buffer for lane ${String(lane)}`);
        }
        if (buffer.totalWork < min) {
          min = buffer.totalWork;
        }
      }
    }

    if (!Number.isFinite(min)) {
      return 0;
    }
    return min;
  }

  /**
   * Append a trace slab to one lane and resync all lanes to {@link appliedCursor}.
   *
   * @param lane - Lane index in `[0, laneCount)`.
   * @param chunk - Completed trace slab from a worker stream.
   * @throws If `lane` is out of range or chunk validation fails.
   */
  appendChunk(lane: number, chunk: TraceChunk): void {
    const buffer = this.bufferForLane(lane);
    buffer.appendChunk(chunk);
    this.syncLanes();
  }

  /**
   * Mark one lane's trace as fully received.
   *
   * When all lanes are complete and the clock cursor is at or past
   * {@link maxTotalWork}, pauses playback (same rule as {@link Playback.markComplete}).
   *
   * @param lane - Lane index in `[0, laneCount)`.
   * @throws If `lane` is out of range.
   */
  markLaneComplete(lane: number): void {
    this.validateLane(lane);
    this.laneCompleteFlags[lane] = true;
    if (this.allComplete && this.clock.cursor >= this.maxTotalWork) {
      this.pause();
    }
  }

  /** Begin advancing the shared work clock on each {@link advance} call. */
  play(): void {
    this.clock.play();
  }

  /** Stop advancing the shared work clock. */
  pause(): void {
    this.clock.pause();
  }

  /**
   * Set the dimensionless play-speed multiplier on the shared work clock.
   *
   * @param speed - Must be finite and >= 0.
   * @throws If `speed` is not finite or is negative.
   */
  setSpeed(speed: number): void {
    this.clock.setSpeed(speed);
  }

  /**
   * Advance the shared work clock by `dtSeconds` and resync all lanes.
   *
   * Does not pause when {@link appliedCursor} hits {@link streamCap} while
   * any lane is still incomplete.
   *
   * @param dtSeconds - Elapsed seconds since the last frame; must be finite and >= 0.
   * @throws If `dtSeconds` is not finite or is negative.
   */
  advance(dtSeconds: number): void {
    this.clock.advance(dtSeconds);
    this.syncLanes();
  }

  /**
   * Jump the shared clock to billed op position `t` and resync all lanes.
   *
   * When all lanes are complete, `t` is clamped to `[0, maxTotalWork]` on
   * the clock. Otherwise the clock is not clamped to {@link streamCap}
   * (applied playback uses {@link appliedCursor}).
   *
   * @param t - Target billed ops; must be finite and >= 0.
   * @throws If `t` is not finite or is negative.
   */
  seek(t: number): void {
    if (!Number.isFinite(t)) {
      throw new Error(`t must be finite, got ${String(t)}`);
    }
    if (t < 0) {
      throw new Error(`t must be >= 0, got ${String(t)}`);
    }

    if (this.allComplete) {
      const clamped = Math.min(t, this.maxTotalWork);
      this.clock.seek(clamped);
    } else {
      this.clock.seek(t);
    }
    this.syncLanes();
  }

  /**
   * Advance the shared clock by one billed op, capped at available work.
   *
   * Cannot step past {@link streamCap} while lanes are generating; when all
   * lanes are complete, also caps at {@link maxTotalWork}.
   */
  stepOp(): void {
    const cap = this.allComplete ? this.maxTotalWork : this.streamCap;
    const target = Math.min(this.clock.cursor + 1, cap);
    this.seek(target);
  }

  /**
   * Seek to the earliest next event boundary among lanes with remaining events.
   *
   * No-op when every lane has applied all indexed events at the current
   * {@link appliedCursor}.
   */
  stepEvent(): void {
    this.syncLanes();

    let next = Infinity;
    for (const buffer of this.buffers) {
      const work = buffer.nextEventWork();
      if (work !== null && work < next) {
        next = work;
      }
    }

    if (Number.isFinite(next)) {
      this.seek(next);
    }
  }

  /**
   * Live lane state for `lane` at the current {@link appliedCursor}.
   *
   * @param lane - Lane index in `[0, laneCount)`.
   * @returns Mutable playback snapshot for the lane.
   * @throws If `lane` is out of range.
   */
  laneState(lane: number): LaneState {
    return this.bufferForLane(lane).state;
  }

  /**
   * Trace buffer for `lane`.
   *
   * @param lane - Lane index in `[0, laneCount)`.
   * @throws If `lane` is out of range.
   */
  laneBuffer(lane: number): TraceBuffer {
    return this.bufferForLane(lane);
  }

  /**
   * Whether lane `lane` is complete and fully played through at {@link appliedCursor}.
   *
   * @param lane - Lane index in `[0, laneCount)`.
   * @throws If `lane` is out of range.
   */
  laneFinished(lane: number): boolean {
    return this.laneComplete(lane) && this.appliedCursor >= this.laneTotalWork(lane);
  }

  /**
   * Total billed ops indexed for lane `lane`.
   *
   * @param lane - Lane index in `[0, laneCount)`.
   * @throws If `lane` is out of range.
   */
  laneTotalWork(lane: number): number {
    return this.bufferForLane(lane).totalWork;
  }

  /**
   * Whether lane `lane` has been marked complete via {@link markLaneComplete}.
   *
   * @param lane - Lane index in `[0, laneCount)`.
   * @throws If `lane` is out of range.
   */
  laneComplete(lane: number): boolean {
    this.validateLane(lane);
    const flag = this.laneCompleteFlags[lane];
    if (flag === undefined) {
      throw new Error(`missing complete flag for lane ${String(lane)}`);
    }
    return flag;
  }

  /**
   * Photo-finish target vertex, or `null` until {@link setFinishVertex}.
   */
  get finishVertex(): number | null {
    return this._finishVertex;
  }

  /**
   * Set the shared finish vertex for photo-finish freeze (#14).
   *
   * Resyncs all lanes so the current cursor re-caps at each lane's
   * `settleWork[finishVertex]` when that settle is already known.
   *
   * @param v - Vertex index in `[0, graph.n)`.
   * @throws If `v` is not an integer in range.
   */
  setFinishVertex(v: number): void {
    this.validateFinishVertex(v);
    this._finishVertex = v;
    this.syncLanes();
  }

  /**
   * Whether lane `lane` has settled {@link finishVertex} at the current capped seek.
   *
   * False when no finish vertex is set or the finish has not been reached yet
   * (e.g. after scrubbing before the settle event).
   *
   * @param lane - Lane index in `[0, laneCount)`.
   * @throws If `lane` is out of range.
   */
  lanePhotoFrozen(lane: number): boolean {
    const finish = this._finishVertex;
    if (finish === null) {
      return false;
    }
    const state = this.laneState(lane);
    return state.settleOrder[finish] !== UNSETTLED;
  }

  /**
   * Whether a finish vertex is set and every lane has photo-frozen at it.
   */
  allPhotoFrozen(): boolean {
    if (this._finishVertex === null) {
      return false;
    }
    for (let lane = 0; lane < this._laneCount; lane += 1) {
      if (!this.lanePhotoFrozen(lane)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Seek every lane to the photo-finish-capped applied cursor (#14).
   *
   * When the finish settle is already known, clamp `target` to
   * `settleWork[finishVertex]` before the forward seek so frozen lanes avoid
   * replaying past the settle every frame. When the cursor first crosses the
   * settle this frame, a second seek recaps at `settleWork[finishVertex]`;
   * later syncs hit {@link TraceBuffer.seekWork}'s early return when
   * `desiredEventIndex === state.eventIndex`.
   *
   * Pauses playback when all lanes are photo-frozen (same rule as end-of-trace).
   */
  private syncLanes(): void {
    const appliedT = this.appliedCursor;
    const finish = this._finishVertex;
    for (const buffer of this.buffers) {
      let target = Math.min(appliedT, buffer.totalWork);
      if (finish !== null) {
        const swBefore = buffer.state.settleWork[finish];
        if (swBefore !== UNSETTLED) {
          target = Math.min(target, swBefore);
        }
      }
      buffer.seekWork(target);
      if (finish !== null) {
        const sw = buffer.state.settleWork[finish];
        if (sw !== UNSETTLED && buffer.state.work > sw) {
          buffer.seekWork(sw);
        }
      }
    }
    if (this.allPhotoFrozen() && this.clock.playing) {
      this.pause();
    }
  }

  /**
   * @param v - Finish vertex index in `[0, graph.n)`.
   * @throws If `v` is not an integer in range.
   */
  private validateFinishVertex(v: number): void {
    const n = this.graph.n;
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      throw new Error(`finish vertex must be an integer in [0, ${String(n)}), got ${String(v)}`);
    }
  }

  /**
   * @param lane - Lane index in `[0, laneCount)`.
   * @throws If `lane` is not an integer in range.
   */
  private validateLane(lane: number): void {
    if (!Number.isInteger(lane) || lane < 0 || lane >= this._laneCount) {
      throw new Error(
        `lane must be an integer in [0, ${String(this._laneCount)}), got ${String(lane)}`,
      );
    }
  }

  /**
   * @param lane - Lane index in `[0, laneCount)`.
   * @throws If `lane` is out of range.
   */
  private bufferForLane(lane: number): TraceBuffer {
    this.validateLane(lane);
    const buffer = this.buffers[lane];
    if (buffer === undefined) {
      throw new Error(`missing buffer for lane ${String(lane)}`);
    }
    return buffer;
  }
}
