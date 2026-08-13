/**
 * Shared BMSSP URL field helpers for Race and Lens codecs (issue #52).
 *
 * Query keys: `bmssp=demo|paper` (omit when demo), `bk` / `bt` for k/t
 * overrides. Race work-clock scrub stays on `t` — never reuse that key here.
 */

/** BMSSP parameter mode encoded in the `bmssp` query param. */
export type BmsspUrlMode = "demo" | "paper";

/**
 * @param value - Candidate BMSSP mode from a query param or select option.
 * @returns Whether `value` is `"demo"` or `"paper"`.
 */
export function isBmsspUrlMode(value: string): value is BmsspUrlMode {
  return value === "demo" || value === "paper";
}

/**
 * @param raw - `bmssp` query value, or null when absent.
 * @returns `paper` only when `raw` is exactly `paper`; otherwise `demo`.
 */
export function parseBmsspMode(raw: string | null): BmsspUrlMode {
  if (raw === "paper") {
    return "paper";
  }
  return "demo";
}

/**
 * @param raw - `bk` or `bt` query value, or null when absent.
 * @returns A positive integer block parameter, or `null` when unset/invalid.
 */
export function parseOptionalBlockParam(raw: string | null): number | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}
