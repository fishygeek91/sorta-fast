/**
 * Per-vertex settle-diff buckets from two lane snapshots (issue #68, design.md §3.2).
 *
 * Shared work clock: at tick T each lane has spent T ops. Classify vertices by
 * whether they have settled in the left lane, right lane, both, or neither —
 * derived from two {@link LaneState}s only; no new trace events.
 */

import { type LaneState, UNSETTLED } from "../harness/laneState.ts";

/** Vertex not settled in either lane. */
export const SETTLE_DIFF_NEITHER = 0;
/** Settled in the left lane only. */
export const SETTLE_DIFF_LEFT = 1;
/** Settled in the right lane only. */
export const SETTLE_DIFF_RIGHT = 2;
/** Settled in both lanes. */
export const SETTLE_DIFF_BOTH = 3;

/**
 * Write per-vertex settle-diff buckets into `out`.
 *
 * `out[v]` is {@link SETTLE_DIFF_NEITHER} / {@link SETTLE_DIFF_LEFT} /
 * {@link SETTLE_DIFF_RIGHT} / {@link SETTLE_DIFF_BOTH} from `left.settleOrder[v]`
 * and `right.settleOrder[v]` vs {@link UNSETTLED}.
 *
 * @param out - Per-vertex bucket array; length must equal `left.n`.
 * @param left - Left lane snapshot.
 * @param right - Right lane snapshot.
 * @throws If `left.n !== right.n`, or `out.length !== left.n`.
 */
export function fillSettleDiff(out: Uint8Array, left: LaneState, right: LaneState): void {
  if (left.n !== right.n) {
    throw new Error(
      `lane vertex count mismatch: expected ${String(left.n)}, got ${String(right.n)}`,
    );
  }
  if (out.length !== left.n) {
    throw new Error(
      `settle-diff output length mismatch: expected ${String(left.n)}, got ${String(out.length)}`,
    );
  }

  const n = left.n;
  const leftOrder = left.settleOrder;
  const rightOrder = right.settleOrder;

  for (let v = 0; v < n; v += 1) {
    const leftSettled = leftOrder[v] !== UNSETTLED ? 1 : 0;
    const rightSettled = rightOrder[v] !== UNSETTLED ? 2 : 0;
    out[v] = leftSettled | rightSettled;
  }
}
