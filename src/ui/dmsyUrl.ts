/**
 * Shared DMSY URL field helpers for Race and Lens codecs (issue #54).
 *
 * Query keys: `dmsy=demo|paper` (omit when demo), `dk` / `dt` for k/t
 * overrides. Race work-clock scrub stays on `t` — never reuse that key here.
 * Never reuse `bmssp` / `bk` / `bt`.
 */

import { parseOptionalBlockParam } from "./bmsspUrl.ts";

export { parseOptionalBlockParam };

/** DMSY parameter mode encoded in the `dmsy` query param. */
export type DmsyUrlMode = "demo" | "paper";

/**
 * @param value - Candidate DMSY mode from a query param or select option.
 * @returns Whether `value` is `"demo"` or `"paper"`.
 */
export function isDmsyUrlMode(value: string): value is DmsyUrlMode {
  return value === "demo" || value === "paper";
}

/**
 * @param raw - `dmsy` query value, or null when absent.
 * @returns `paper` only when `raw` is exactly `paper`; otherwise `demo`.
 */
export function parseDmsyMode(raw: string | null): DmsyUrlMode {
  if (raw === "paper") {
    return "paper";
  }
  return "demo";
}
