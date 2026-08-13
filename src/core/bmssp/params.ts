/**
 * BMSSP recursion parameters k and t (issues #9/#10); design.md §2.2.
 *
 * arXiv 2504.17033 §3.1: k = ⌊log^{1/3} n⌋, t = ⌊log^{2/3} n⌋. The paper's log
 * is base 2 (standard in the comparison-addition model / DMMSY). Natural log
 * leaves k = 1 for every n < e^8 ≈ 2981 — all Lens demo sizes — so we use
 * Math.log2. Degenerate n < 2 uses k = t = 1 because log2(1) = 0.
 */

/** BMSSP level/block parameters derived from vertex count n. */
export type BmsspParams = {
  k: number;
  t: number;
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
export function bmsspParams(n: number): BmsspParams {
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
