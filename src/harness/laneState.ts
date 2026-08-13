/**
 * Typed-array visual state for one race lane (issue #7, design.md §4.3).
 *
 * Headless playback snapshot: settle order, frontier flags, event cursor,
 * billed work, and per-edge relax ghost data for lens mode. No DOM,
 * `Date.now()`, or `Math.random()`.
 */

import { SENTINEL } from "../core/trace.ts";

/** Matches trace SENTINEL: vertex has not settled. Renderer imports this, not trace.ts. */
export const UNSETTLED = SENTINEL;

/**
 * Per-lane playback state derived from trace events.
 *
 * `settleOrder[v]` is {@link UNSETTLED} until vertex `v` settles, then its
 * 0-based settle index. `frontier[v]` is 1 when `v` is improved but not yet
 * settled. `lastRelaxWork[e]` is {@link UNSETTLED} until edge `e` improves,
 * then the billed work after that relax event. Scalars track how far playback
 * has advanced through the trace.
 */
export class LaneState {
  readonly n: number;
  /** Edge count for the graph this lane mirrors. */
  readonly m: number;
  /** Per-vertex settle index, or {@link UNSETTLED} if not yet settled. */
  readonly settleOrder: Int32Array;
  /** 1 if vertex is on the open frontier (improved, not settled); else 0. */
  readonly frontier: Uint8Array;
  /**
   * Per-edge billed work after the latest improving relax on that edge, or
   * {@link UNSETTLED} if the edge has not yet improved.
   */
  readonly lastRelaxWork: Int32Array;
  /** Count of vertices with a settled order assigned. */
  settledCount: number;
  /** Next trace event index to apply (0..totalEvents). */
  eventIndex: number;
  /** Billed ops applied so far (sum of chunk costs). */
  work: number;
  /** Running count of relax trace events applied. */
  relaxations: number;
  /** Running count of heap trace events applied. */
  heapOps: number;

  /**
   * Allocate lane state for a graph with `n` vertices and `m` edges.
   *
   * @param n - Vertex count; must be an integer >= 0.
   * @param m - Edge count; must be an integer >= 0.
   * @throws If `n` or `m` is not an integer or is negative.
   */
  constructor(n: number, m: number) {
    if (!Number.isInteger(n)) {
      throw new Error(`n must be an integer >= 0, got ${String(n)}`);
    }
    if (n < 0) {
      throw new Error(`n must be >= 0, got ${String(n)}`);
    }
    if (!Number.isInteger(m)) {
      throw new Error(`m must be an integer >= 0, got ${String(m)}`);
    }
    if (m < 0) {
      throw new Error(`m must be >= 0, got ${String(m)}`);
    }
    this.n = n;
    this.m = m;
    this.settleOrder = new Int32Array(n);
    this.frontier = new Uint8Array(n);
    this.lastRelaxWork = new Int32Array(m);
    this.settledCount = 0;
    this.eventIndex = 0;
    this.work = 0;
    this.relaxations = 0;
    this.heapOps = 0;
    this.reset();
  }

  /**
   * Clear playback state: unsettled vertices, empty frontier, zero counters.
   */
  reset(): void {
    this.settleOrder.fill(UNSETTLED);
    this.frontier.fill(0);
    this.lastRelaxWork.fill(UNSETTLED);
    this.settledCount = 0;
    this.eventIndex = 0;
    this.work = 0;
    this.relaxations = 0;
    this.heapOps = 0;
  }

  /**
   * Deep copy of typed arrays and scalar fields.
   *
   * @returns A new lane with the same vertex and edge counts and identical contents.
   */
  clone(): LaneState {
    const copy = new LaneState(this.n, this.m);
    copy.copyFrom(this);
    return copy;
  }

  /**
   * Overwrite this lane from `other` (arrays and scalars).
   *
   * @param other - Source lane; must have the same `n` and `m` as this lane.
   * @throws If `other.n !== this.n` or `other.m !== this.m`.
   */
  copyFrom(other: LaneState): void {
    if (other.n !== this.n) {
      throw new Error(
        `lane vertex count mismatch: expected ${String(this.n)}, got ${String(other.n)}`,
      );
    }
    if (other.m !== this.m) {
      throw new Error(
        `lane edge count mismatch: expected ${String(this.m)}, got ${String(other.m)}`,
      );
    }
    this.settleOrder.set(other.settleOrder);
    this.frontier.set(other.frontier);
    this.lastRelaxWork.set(other.lastRelaxWork);
    this.settledCount = other.settledCount;
    this.eventIndex = other.eventIndex;
    this.work = other.work;
    this.relaxations = other.relaxations;
    this.heapOps = other.heapOps;
  }
}
