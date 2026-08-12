/**
 * Seeded mulberry32 PRNG (Tommy Ettinger).
 *
 * The only randomness source allowed in `src/core/` / `src/harness/`.
 * Same seed always yields the same stream — required for URL-reproducible races.
 */

/** 2^32 as a float; mulberry32's uint32 output is divided by this to get [0, 1). */
const UINT32_RANGE = 0x1_0000_0000;

/**
 * A deterministic stream. `next` and `nextUint32` share one advancing state:
 * each call consumes one 32-bit sample.
 */
export type Mulberry32 = {
  /** Uniform float in `[0, 1)`. */
  next: () => number;
  /** Uniform integer in `0 .. 2^32-1`. */
  nextUint32: () => number;
};

/**
 * Create a mulberry32 generator from `seed`.
 *
 * Non-integer / out-of-range seeds are coerced to Uint32 (`seed >>> 0`),
 * matching typical hash-into-seed usage from URL params.
 *
 * @param seed - Any JS number; only the low 32 bits are used.
 */
export function mulberry32(seed: number): Mulberry32 {
  let state = seed >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    nextUint32,
    next: (): number => nextUint32() / UINT32_RANGE,
  };
}
