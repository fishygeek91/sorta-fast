/**
 * BMSSP recursion parameters k and t (issues #9/#10); design.md §2.2.
 *
 * arXiv 2504.17033 §3.1: k = ⌊log^{1/3} n⌋, t = ⌊log^{2/3} n⌋ (natural log).
 * Degenerate small-n graphs use k = t = 1 so batch sizes stay well-defined.
 */

/** BMSSP level/block parameters derived from vertex count n. */
export type BmsspParams = {
  k: number;
  t: number;
};

/**
 * Compute BMSSP parameters for a graph with `n` vertices (arXiv 2504.17033 §3.1).
 *
 * For `n < 2`, returns `{ k: 1, t: 1 }` because ln(n) ≤ 0 and the paper formulas
 * are undefined at degenerate sizes. Otherwise:
 * - `k = max(1, ⌊(ln n)^{1/3}⌋)`
 * - `t = max(1, ⌊(ln n)^{2/3}⌋)`
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

  const ln = Math.log(n);
  // arXiv 2504.17033 §3.1
  const k = Math.max(1, Math.floor(Math.pow(ln, 1 / 3)));
  // arXiv 2504.17033 §3.1
  const t = Math.max(1, Math.floor(Math.pow(ln, 2 / 3)));

  return { k, t };
}
