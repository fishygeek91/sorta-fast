/**
 * Resolve DMSY k/t for harness and UI without importing algorithm modules.
 *
 * UI (`src/ui/`) must not import `src/core/dmsy/`; this wrapper is the allowed
 * path so Race/Lens can pass resolved parameters into trace jobs and playback.
 * Default mode is `"demo"`. `null` k/t overrides are treated as omitted (URL
 * codecs use `null` when `dk`/`dt` are absent).
 */

import { dmsyParams, type DmsyParamMode, type DmsyParams } from "../core/dmsy/dmsy.ts";

/**
 * Resolve demo or paper DMSY parameters, then apply optional k/t overrides.
 *
 * `null` overrides are treated as omitted (URL codecs use `null` when `dk`/`dt`
 * are absent). Default mode is `"demo"`, matching {@link dmsyParams}.
 *
 * @param n - Vertex count; must be an integer ≥ 1.
 * @param mode - `"demo"` or `"paper"`; omitted → demo.
 * @param k - Optional block-size override; `null` or omitted keeps the mode default.
 * @param t - Optional block-count override; `null` or omitted keeps the mode default.
 * @param delta - Degree bound for the paper/demo formulas; defaults to 3.
 */
export function resolveDmsyRunParams(
  n: number,
  mode?: DmsyParamMode,
  k?: number | null,
  t?: number | null,
  delta?: number,
): DmsyParams {
  return dmsyParams(n, {
    mode,
    k: k === null ? undefined : k,
    t: t === null ? undefined : t,
    delta,
  });
}
