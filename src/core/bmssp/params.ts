/**
 * BMSSP recursion parameters k and t (issues #9/#10, #52); design.md §2.2.
 *
 * arXiv 2504.17033 §3.1: k = ⌊log^{1/3} n⌋, t = ⌊log^{2/3} n⌋. The paper's log
 * is base 2 (standard in the comparison-addition model / DMMSY). Natural log
 * leaves k = 1 for every n < e^8 ≈ 2981 — all Lens demo sizes — so we use
 * Math.log2. Degenerate n < 2 uses k = t = 1 because log2(1) = 0.
 *
 * Default {@link bmsspParams} mode is `"demo"` ({@link demoBmsspParams}): k/t
 * sweep in bench/bmssp-kt-sweep.md shows paper k=2 loses on sparse n=25000;
 * demo k=4 wins. Paper §3.1 formula via {@link paperBmsspParams} or
 * `bmsspParams(n, { mode: "paper" })`.
 */

/** BMSSP level/block parameters derived from vertex count n. */
export type BmsspParams = {
  k: number;
  t: number;
};

/** Parameter source for {@link bmsspParams}; default is `"demo"`. */
export type BmsspParamMode = "demo" | "paper";

/** Optional overrides for {@link bmsspParams}; omitted fields keep base values. */
export type BmsspParamOptions = {
  mode?: BmsspParamMode;
  k?: number;
  t?: number;
};

/**
 * Compute BMSSP parameters for a graph with `n` vertices (arXiv 2504.17033 §3.1).
 *
 * For `n < 2`, returns `{ k: 1, t: 1 }` because log₂(n) ≤ 0. Otherwise:
 * - `k = max(1, ⌊(log₂ n)^{1/3}⌋)`
 * - `t = max(1, ⌊(log₂ n)^{2/3}⌋)`
 *
 * @param n - Vertex count; must be an integer ≥ 1.
 */
export function paperBmsspParams(n: number): BmsspParams {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(n)}`);
  }

  if (n < 2) {
    return { k: 1, t: 1 };
  }

  const log2n = Math.log2(n);
  // arXiv 2504.17033 §3.1 (log base 2)
  const k = Math.max(1, Math.floor(Math.pow(log2n, 1 / 3)));
  // arXiv 2504.17033 §3.1 (log base 2)
  const t = Math.max(1, Math.floor(Math.pow(log2n, 2 / 3)));

  return { k, t };
}

/**
 * Demo-scale BMSSP parameters for browser races (issue #52).
 *
 * Starts from {@link paperBmsspParams} then raises `k` to at least 4 so
 * FindPivots abort stays tractable at gallery sizes; `t` follows the paper.
 * Sweep evidence: bench/bmssp-kt-sweep.md (sparse n=25000, paper k=2 loses).
 *
 * @param n - Vertex count; must be an integer ≥ 1.
 */
export function demoBmsspParams(n: number): BmsspParams {
  const paper = paperBmsspParams(n);
  return { k: Math.max(4, paper.k), t: paper.t };
}

/**
 * BMSSP parameters for `n` vertices, optionally overriding demo or paper defaults.
 *
 * Default mode is `"demo"` ({@link demoBmsspParams}). Use `mode: "paper"` for
 * {@link paperBmsspParams}. Replaces `k` and/or `t` when provided in `options`;
 * each override must be an integer ≥ 1.
 *
 * @param n - Vertex count; must be an integer ≥ 1.
 * @param options - Optional mode and `k` / `t` overrides.
 */
export function bmsspParams(n: number, options?: BmsspParamOptions): BmsspParams {
  const mode = options?.mode ?? "demo";

  if (mode !== "demo" && mode !== "paper") {
    throw new Error(`mode must be "demo" or "paper"`);
  }

  const params = mode === "paper" ? paperBmsspParams(n) : demoBmsspParams(n);

  if (options === undefined) {
    return params;
  }

  if (options.k !== undefined) {
    if (!Number.isInteger(options.k) || options.k < 1) {
      throw new Error(`k must be an integer >= 1, got ${String(options.k)}`);
    }
    params.k = options.k;
  }

  if (options.t !== undefined) {
    if (!Number.isInteger(options.t) || options.t < 1) {
      throw new Error(`t must be an integer >= 1, got ${String(options.t)}`);
    }
    params.t = options.t;
  }

  return params;
}

/**
 * Recursion depth L from BMSSP Algorithm 3 (arXiv 2504.17033).
 *
 * `L = max(1, ⌈log₂(max(2, n)) / t⌉)`.
 *
 * @param n - Vertex count; must be an integer ≥ 1.
 * @param t - Block parameter; must be an integer ≥ 1.
 */
export function bmsspRecursionDepth(n: number, t: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(n)}`);
  }
  if (!Number.isInteger(t) || t < 1) {
    throw new Error(`t must be an integer >= 1, got ${String(t)}`);
  }

  return Math.max(1, Math.ceil(Math.log2(Math.max(2, n)) / t));
}
