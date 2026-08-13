/**
 * Resolve BMSSP k/t for harness and UI without importing algorithm modules.
 *
 * UI (`src/ui/`) must not import `src/core/bmssp/`; this wrapper is the allowed
 * path so Race/Lens can pass FindPivots k into {@link TraceBuffer} / Playback.
 */

import { bmsspParams, type BmsspParamMode, type BmsspParams } from "../core/bmssp/params.ts";

/**
 * Resolve demo or paper BMSSP parameters, then apply optional k/t overrides.
 *
 * `null` overrides are treated as omitted (URL codecs use `null` when `bk`/`bt`
 * are absent). Default mode is `"demo"`, matching {@link bmsspParams}.
 *
 * @param n - Vertex count; must be an integer ≥ 1.
 * @param mode - `"demo"` or `"paper"`; omitted → demo.
 * @param k - Optional block-size override; `null` or omitted keeps the mode default.
 * @param t - Optional block-count override; `null` or omitted keeps the mode default.
 */
export function resolveBmsspRunParams(
  n: number,
  mode?: BmsspParamMode,
  k?: number | null,
  t?: number | null,
): BmsspParams {
  return bmsspParams(n, {
    mode,
    k: k === null ? undefined : k,
    t: t === null ? undefined : t,
  });
}
