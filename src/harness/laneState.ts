/**
 * Typed-array visual state for one race lane (issue #7, design.md §4.3).
 *
 * Headless playback snapshot: settle order, frontier flags, event cursor, and
 * billed work. No DOM, `Date.now()`, or `Math.random()`.
 */

import { SENTINEL } from "../core/trace.ts";

/** Matches trace SENTINEL: vertex has not settled. Renderer imports this, not trace.ts. */
export const UNSETTLED = SENTINEL;

/**
 * Per-lane playback state derived from trace events.
 *
 * `settleOrder[v]` is {@link UNSETTLED} until vertex `v` settles, then its
 * 0-based settle index. `frontier[v]` is 1 when `v` is improved but not yet
 * settled. Scalars track how far playback has advanced through the trace.
 */
export class LaneState {
  readonly n: number;
  /** Per-vertex settle index, or {@link UNSETTLED} if not yet settled. */
  readonly settleOrder: Int32Array;
  /** 1 if vertex is on the open frontier (improved, not settled); else 0. */
  readonly frontier: Uint8Array;
  /** Count of vertices with a settled order assigned. */
  settledCount: number;
  /** Next trace event index to apply (0..totalEvents). */
  eventIndex: number;
  /** Billed ops applied so far (sum of chunk costs). */
  work: number;

  /**
   * Allocate lane state for a graph with `n` vertices.
   *
   * @param n - Vertex count; must be an integer >= 0.
   * @throws If `n` is not an integer or is negative.
   */
  constructor(n: number) {
    if (!Number.isInteger(n)) {
      throw new Error(`n must be an integer >= 0, got ${String(n)}`);
    }
    if (n < 0) {
      throw new Error(`n must be >= 0, got ${String(n)}`);
    }
    this.n = n;
    this.settleOrder = new Int32Array(n);
    this.frontier = new Uint8Array(n);
    this.settledCount = 0;
    this.eventIndex = 0;
    this.work = 0;
    this.reset();
  }

  /**
   * Clear playback state: unsettled vertices, empty frontier, zero counters.
   */
  reset(): void {
    this.settleOrder.fill(UNSETTLED);
    this.frontier.fill(0);
    this.settledCount = 0;
    this.eventIndex = 0;
    this.work = 0;
  }

  /**
   * Deep copy of typed arrays and scalar fields.
   *
   * @returns A new lane with the same vertex count and identical contents.
   */
  clone(): LaneState {
    const copy = new LaneState(this.n);
    copy.copyFrom(this);
    return copy;
  }

  /**
   * Overwrite this lane from `other` (arrays and scalars).
   *
   * @param other - Source lane; must have the same `n` as this lane.
   * @throws If `other.n !== this.n`.
   */
  copyFrom(other: LaneState): void {
    if (other.n !== this.n) {
      throw new Error(
        `lane vertex count mismatch: expected ${String(this.n)}, got ${String(other.n)}`,
      );
    }
    this.settleOrder.set(other.settleOrder);
    this.frontier.set(other.frontier);
    this.settledCount = other.settledCount;
    this.eventIndex = other.eventIndex;
    this.work = other.work;
  }
}
