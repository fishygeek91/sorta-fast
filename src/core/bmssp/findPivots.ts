/**
 * BMSSP FindPivots — arXiv 2504.17033 Algorithm 1 / Lemma 3.2 (issue #10; design.md §2.2).
 *
 * k rounds of bounded Bellman-Ford relaxation from frontier S identify pivot vertices
 * whose tight shortest-path subtrees reach size ≥ k. Mutates the caller-owned distance
 * array (paper global d̂); forest construction after k rounds is not billed.
 */

import { type Graph, type VertexId } from "../graph.ts";
import { SENTINEL, type TraceEvent } from "../trace.ts";

/**
 * Pivot set P, discovered frontier W, and whether Algorithm 1 aborted early.
 *
 * When `aborted` is true, `P` is all sources (sorted); otherwise `P` comes from the
 * tight forest (Lemma 3.2). `W` is always sorted by vertex id.
 */
export type FindPivotsResult = {
  P: VertexId[];
  W: VertexId[];
  aborted: boolean;
};

/**
 * Deduplicate source vertices preserving first-occurrence order.
 */
function dedupeSources(S: readonly VertexId[], n: number): VertexId[] {
  const seen = new Uint8Array(n);
  const sources: VertexId[] = [];
  for (const s of S) {
    if (seen[s] === 0) {
      seen[s] = 1;
      sources.push(s);
    }
  }
  return sources;
}

/**
 * Sort a copy of vertex ids in ascending order.
 */
function sortedCopy(members: readonly VertexId[]): VertexId[] {
  const copy = [...members];
  copy.sort((a, b) => a - b);
  return copy;
}

/**
 * BMSSP FindPivots (arXiv 2504.17033 Algorithm 1).
 *
 * Mutates `dist` in place (paper global d̂). The caller must initialize distances
 * for vertices in S before calling; other entries are read and may be updated.
 * Parameter `k` is passed in explicitly (use {@link bmsspParams} at call sites / tests).
 *
 * Yields relax and batch trace events during k relaxation rounds, then pivot events
 * for the computed pivot set. Returns P, W, and an abort flag.
 *
 * @param graph - CSR directed graph with non-negative weights.
 * @param B - Distance upper bound for frontier growth (may be `Infinity`).
 * @param S - Multi-source frontier; deduplicated internally.
 * @param k - Number of relaxation rounds (≥ 1).
 * @param dist - Shared distance array of length `graph.n`; mutated in place.
 * @param level - Recursion depth label for trace events (≥ 0).
 */
export function* findPivots(
  graph: Graph,
  B: number,
  S: readonly VertexId[],
  k: number,
  dist: Float64Array,
  level: number,
): Generator<TraceEvent, FindPivotsResult, undefined> {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`k must be an integer >= 1, got ${String(k)}`);
  }
  if (!Number.isInteger(level) || level < 0) {
    throw new Error(`level must be a non-negative integer, got ${String(level)}`);
  }
  if (!(Number.isFinite(B) || B === Number.POSITIVE_INFINITY)) {
    throw new Error(`B must be finite or +Infinity, got ${String(B)}`);
  }
  if (dist.length !== graph.n) {
    throw new Error(`dist.length must equal graph.n (${graph.n}), got ${dist.length}`);
  }

  for (const s of S) {
    if (!Number.isInteger(s) || s < 0 || s >= graph.n) {
      throw new Error(`every source must be an integer in [0, ${graph.n}), got ${String(s)}`);
    }
  }

  const sources = dedupeSources(S, graph.n);
  const sourceCount = sources.length;

  const inW = new Uint8Array(graph.n);
  const wMembers: VertexId[] = [];
  for (const s of sources) {
    if (inW[s] === 0) {
      inW[s] = 1;
      wMembers.push(s);
    }
  }

  let prevLayer: VertexId[] = [...sources];
  const { offsets, targets, weights } = graph;

  for (let round = 1; round <= k; round += 1) {
    yield { k: "batch", phase: "start", level, size: prevLayer.length };

    const wi: VertexId[] = [];
    const inWi = new Uint8Array(graph.n);

    // arXiv 2504.17033 Algorithm 1
    for (const u of prevLayer) {
      const arcStart = offsets[u];
      const arcEnd = offsets[u + 1];
      if (arcStart === undefined || arcEnd === undefined) {
        throw new Error(`offsets for vertex ${u} missing`);
      }

      const distU = dist[u];
      if (distU === undefined) {
        throw new Error(`dist[${u}] missing`);
      }

      for (let e = arcStart; e < arcEnd; e += 1) {
        const to = targets[e];
        const w = weights[e];
        if (to === undefined || w === undefined) {
          throw new Error(`CSR arc ${e} missing`);
        }

        const cand = distU + w;
        const distTo = dist[to];
        if (distTo === undefined) {
          throw new Error(`dist[${to}] missing`);
        }

        const improved = cand < distTo;
        yield { k: "relax", e, improved, cost: 1 };

        // Algorithm 1: W_i membership is nested inside a successful relax.
        if (cand <= distTo) {
          dist[to] = cand;
          if (cand < B && inWi[to] === 0) {
            inWi[to] = 1;
            wi.push(to);
          }
        }
      }
    }

    for (const v of wi) {
      if (inW[v] === 0) {
        inW[v] = 1;
        wMembers.push(v);
      }
    }

    yield { k: "batch", phase: "end", level, size: wi.length };

    if (wMembers.length > k * sourceCount) {
      const P = sortedCopy(sources);
      for (const v of P) {
        yield { k: "pivot", v, level };
      }
      return { P, W: sortedCopy(wMembers), aborted: true };
    }

    prevLayer = wi;
  }

  // Lemma 3.2 / Assumption 2.1 — tight forest over W (not billed).
  const wSorted = sortedCopy(wMembers);
  const parent = new Int32Array(graph.n);
  parent.fill(SENTINEL);

  for (const u of wSorted) {
    const arcStart = offsets[u];
    const arcEnd = offsets[u + 1];
    if (arcStart === undefined || arcEnd === undefined) {
      throw new Error(`offsets for vertex ${u} missing`);
    }

    const distU = dist[u];
    if (distU === undefined) {
      throw new Error(`dist[${u}] missing`);
    }

    for (let e = arcStart; e < arcEnd; e += 1) {
      const v = targets[e];
      const w = weights[e];
      if (v === undefined || w === undefined) {
        throw new Error(`CSR arc ${e} missing`);
      }
      if (inW[v] === 0) {
        continue;
      }

      const distV = dist[v];
      if (distV === undefined) {
        throw new Error(`dist[${v}] missing`);
      }

      if (distV === distU + w) {
        if (u === v) {
          continue;
        }
        // Assumption 2.1: keep F a forest. Equal-distance (e.g. 0-weight)
        // bidirectional tight edges would otherwise parent each other.
        const distULess = distU < distV;
        const equalDistTowardChild = distU === distV && u < v;
        if (!distULess && !equalDistTowardChild) {
          continue;
        }
        const curParent = parent[v];
        if (curParent === SENTINEL || u < curParent) {
          parent[v] = u;
        }
      }
    }
  }

  const children: VertexId[][] = Array.from({ length: graph.n }, () => []);
  for (const u of wSorted) {
    const p = parent[u];
    if (p !== SENTINEL) {
      const slot = children[p];
      if (slot !== undefined) {
        slot.push(u);
      }
    }
  }

  const size = new Int32Array(graph.n);
  const visiting = new Uint8Array(graph.n);

  const computeSubtreeSize = (root: VertexId): number => {
    if (visiting[root] === 1) {
      throw new Error(`findPivots: cycle in tight forest at vertex ${root}`);
    }
    visiting[root] = 1;
    const kids = children[root];
    let total = 1;
    if (kids !== undefined) {
      for (const child of kids) {
        total += computeSubtreeSize(child);
      }
    }
    visiting[root] = 0;
    size[root] = total;
    return total;
  };

  for (const u of wSorted) {
    if (parent[u] === SENTINEL) {
      computeSubtreeSize(u);
    }
  }

  const P: VertexId[] = [];
  for (const s of sources) {
    if (parent[s] === SENTINEL && size[s] >= k) {
      P.push(s);
    }
  }
  P.sort((a, b) => a - b);

  for (const v of P) {
    yield { k: "pivot", v, level };
  }

  return { P, W: wSorted, aborted: false };
}
