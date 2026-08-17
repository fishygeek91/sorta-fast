/**
 * Pure BMSSP narration strings from lane playback state (issue #12).
 *
 * No DOM, no trace imports, no algorithm code — reads {@link LaneState} only.
 */

import { LaneState } from "../harness/laneState.ts";

/**
 * Format a BMSSP bound for human-readable narration.
 *
 * @param bound - Active bound B from recurse-in, or `Infinity` when unset.
 * @returns `"∞"` for non-finite values; otherwise a decimal string.
 */
function formatBound(bound: number): string {
  if (!Number.isFinite(bound)) {
    return "∞";
  }
  return String(bound);
}

/**
 * One-line BMSSP narration for the lens status strip from current lane state.
 *
 * Priority: active FindPivots batch → recent D pull → recurse level → idle.
 *
 * The harness clears {@link LaneState.batchRound} on every `dstruct` event so
 * FindPivots narration ends when the D phase begins (after pivots); pull and
 * level narration can then surface. {@link LaneState.lastPullN} resets on
 * `recurse.in` so child levels do not inherit the parent's last pull.
 *
 * @param state - Lane playback snapshot after the latest trace event.
 * @returns A short status string for the BMSSP overlay narration UI.
 */
export function formatBmsspNarration(state: LaneState): string {
  const inFindPivots = state.recursionDepth > 0 && (state.batchOpen === 1 || state.batchRound > 0);

  if (inFindPivots) {
    const roundPart =
      state.findPivotsK > 0
        ? `FindPivots round ${String(state.batchRound)}/${String(state.findPivotsK)}`
        : `FindPivots round ${String(state.batchRound)}`;
    return `${roundPart}: ${String(state.lastBatchSize)} vertices relaxed, ${String(state.pivotsFoundThisCall)} pivots found`;
  }

  if (state.lastPullN > 0 && state.recursionDepth > 0) {
    return `BMSSP level ${String(state.recursionDepth)}: bound ${formatBound(state.currentBound)}, pulled ${String(state.lastPullN)}`;
  }

  if (state.recursionDepth > 0) {
    return `BMSSP level ${String(state.recursionDepth)}: bound ${formatBound(state.currentBound)}`;
  }

  return "BMSSP idle";
}

/**
 * One-line DMSY narration for the lens status strip from current lane state.
 *
 * Priority: live forest / subtree activity → recurse level → idle.
 *
 * @param state - Lane playback snapshot after the latest trace event.
 * @returns A short status string for the DMSY overlay narration UI.
 */
export function formatDmsyNarration(state: LaneState): string {
  const hasForestActivity =
    state.forestGrowCount > 0 || state.forestCutCount > 0 || state.subtreeCount > 0;

  if (hasForestActivity) {
    return `Forest ${String(state.forestGrowCount)} edges, ${String(state.subtreeCount)} subtrees cut, ${String(state.pivotsFoundThisCall)} pivots, D occupancy ${String(state.sortedRegionSize)}`;
  }

  if (state.recursionDepth > 0) {
    return `DMSY level ${String(state.recursionDepth)}: bound ${formatBound(state.currentBound)}`;
  }

  return "DMSY idle";
}
