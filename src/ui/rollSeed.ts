/**
 * Roll a fresh integer seed for the gallery dice button (issue #15).
 *
 * Uses crypto.getRandomValues — intentionally non-deterministic. Not for
 * core/harness; those must keep using mulberry32 with the chosen seed.
 *
 * @param fill - Optional CSPRNG fill; defaults to crypto.getRandomValues.
 * @returns Integer in 0 .. 2^32-1 (Uint32).
 */
export function rollSeed(fill?: (out: Uint32Array) => void | Uint32Array): number {
  const out = new Uint32Array(1);

  if (fill !== undefined) {
    fill(out);
  } else {
    if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
      throw new Error("rollSeed: crypto.getRandomValues is not available in this environment");
    }
    crypto.getRandomValues(out);
  }

  if (out.length === 0) {
    throw new Error("rollSeed: CSPRNG fill produced an empty Uint32Array");
  }

  const value = out[0];
  if (value === undefined) {
    throw new Error("rollSeed: CSPRNG fill left seed value undefined");
  }

  return value;
}
