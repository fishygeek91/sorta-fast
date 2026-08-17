/**
 * DMSY bounded multi-source shortest paths — arXiv 2602.07868 (issue #26).
 *
 * Algorithms 3–4 with spanning-forest FindPivots, partial-sort structure D,
 * and degree-reduction emission boundary on the public {@link run} lane.
 */

import { type Graph, type VertexId } from "../graph.ts";
import { OP_COST, SENTINEL, type TraceEvent } from "../trace.ts";
import {
  createTraceUnmapper,
  degreeReduce,
  mapBackDistances,
  reducedSource,
} from "./degreeReduce.ts";
import {
  B_INFINITY,
  compareLabels,
  createDistanceStore,
  findPivotsForest,
  labelAt,
  relax,
  type DistanceLabel,
  type DistanceStore,
} from "./forest.ts";
import { PartialSortD } from "./partialSort.ts";

/** Per-event relax/settle costs come from {@link OP_COST}; literals satisfy the trace union. */
const RELAX_EVENT_COST = OP_COST.relax satisfies 1;
const SETTLE_EVENT_COST = OP_COST.settle satisfies 1;

/**
 * Shortest-path distances and predecessor tree from a DMSY run on the original graph.
 *
 * `distances[v]` is `Infinity` when `v` is unreachable from the source.
 * `predecessors[v]` is {@link SENTINEL} for the source and for unreachable vertices.
 */
export type DmsyResult = {
  distances: Float64Array;
  predecessors: Int32Array;
};

/**
 * Result of {@link runInstrumented} on the graph passed in (reduced or identity).
 */
export type DmsyInstrumentedResult = DmsyResult & {
  dist: DistanceStore;
};

/** Paper-level parameters k and t (§1.2 / Lemma 3.9). */
export type DmsyParams = {
  k: number;
  t: number;
};

/** Global settle order and per-vertex settled flag shared across recursion. */
type SettleState = {
  order: number;
  settled: Uint8Array;
};

/** Result of an internal {@link dmsy} call (arXiv 2602.07868 Algorithm 3). */
type DmsyCallResult = {
  Bprime: DistanceLabel;
  U: VertexId[];
  D: PartialSortD;
};

/**
 * 2^exp with overflow guard. `exp` must be an integer >= 0.
 */
function pow2(exp: number): number {
  if (!Number.isInteger(exp) || exp < 0) {
    throw new Error(`pow2 exp must be an integer >= 0, got ${String(exp)}`);
  }
  if (exp === 0) {
    return 1;
  }
  if (exp < 31) {
    return 1 << exp;
  }
  if (exp < 53) {
    return 2 ** exp;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Paper parameters k and t (paper-notes §1.2, Lemma 3.9).
 *
 * @param n - Vertex count; must be an integer >= 1.
 * @param delta - Degree bound used in the t formula; defaults to 3.
 */
export function paperDmsyParams(n: number, delta = 3): DmsyParams {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(n)}`);
  }
  if (!Number.isInteger(delta) || delta < 1) {
    throw new Error(`delta must be an integer >= 1, got ${String(delta)}`);
  }
  if (n < 2) {
    return { k: 1, t: 1 };
  }

  const log2n = Math.log2(n);
  let tProduct = 0;
  if (log2n > 1) {
    const log2log2n = Math.log2(log2n);
    if (log2log2n > 0) {
      tProduct = (log2n * log2log2n) / delta;
    }
  }
  const t = Math.max(1, Math.ceil(Math.sqrt(tProduct)));
  const k = t < 2 ? 1 : Math.ceil(t / Math.log2(t));
  return { k, t };
}

/**
 * Top recursion depth l_top = ⌈log₂ n / t⌉ (Lemma 3.1).
 *
 * @param n - Vertex count.
 * @param t - Block parameter; must be an integer >= 1.
 */
export function dmsyRecursionDepth(n: number, t: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(n)}`);
  }
  if (!Number.isInteger(t) || t < 1) {
    throw new Error(`t must be an integer >= 1, got ${String(t)}`);
  }
  if (n < 2) {
    return 0;
  }
  return Math.max(0, Math.ceil(Math.log2(n) / t));
}

/**
 * Partial-sort block size M = t · 2^{(l−1)·t} at level l (Lemma 3.1).
 *
 * @param l - Recursion level; non-negative integer.
 * @param t - Block parameter; integer >= 1.
 */
export function dmsyBlockSize(l: number, t: number): number {
  if (!Number.isInteger(l) || l < 0) {
    throw new Error(`l must be a non-negative integer, got ${String(l)}`);
  }
  if (!Number.isInteger(t) || t < 1) {
    throw new Error(`t must be an integer >= 1, got ${String(t)}`);
  }
  if (l === 0) {
    return 1;
  }
  const p = pow2((l - 1) * t);
  if (!Number.isFinite(p)) {
    return Number.POSITIVE_INFINITY;
  }
  return t * p;
}

/**
 * Workload cap t³ · 2^{l·t} for Algorithm 3 (Lemma 3.8).
 *
 * @param l - Recursion level; non-negative integer.
 * @param t - Block parameter; integer >= 1.
 */
export function dmsyWorkloadCap(l: number, t: number): number {
  if (!Number.isInteger(l) || l < 0) {
    throw new Error(`l must be a non-negative integer, got ${String(l)}`);
  }
  if (!Number.isInteger(t) || t < 1) {
    throw new Error(`t must be an integer >= 1, got ${String(t)}`);
  }
  const p = pow2(l * t);
  if (!Number.isFinite(p)) {
    return Number.POSITIVE_INFINITY;
  }
  return t * t * t * p;
}

/**
 * Validate caller-supplied parameters or derive paper defaults.
 */
function resolveParams(
  n: number,
  params: DmsyParams | undefined,
  delta: number,
): { k: number; t: number } {
  if (params === undefined) {
    return paperDmsyParams(n, delta);
  }
  if (!Number.isInteger(params.k) || params.k < 1) {
    throw new Error(`k must be an integer >= 1, got ${String(params.k)}`);
  }
  if (!Number.isInteger(params.t) || params.t < 1) {
    throw new Error(`t must be an integer >= 1, got ${String(params.t)}`);
  }
  return { k: params.k, t: params.t };
}

/**
 * Deduplicate sources preserving first occurrence, then sort ascending (DMSY-P08).
 */
function dedupeSourcesAscending(S: readonly VertexId[], n: number): VertexId[] {
  const seen = new Uint8Array(n);
  const sources: VertexId[] = [];
  for (const s of S) {
    if (seen[s] === 0) {
      seen[s] = 1;
      sources.push(s);
    }
  }
  sources.sort((a, b) => a - b);
  return sources;
}

/**
 * Copy length column from a distance store.
 */
function distancesFromStore(dist: DistanceStore): Float64Array {
  const out = new Float64Array(dist.length.length);
  for (let v = 0; v < out.length; v += 1) {
    const length = dist.length[v];
    out[v] = length === undefined ? Number.POSITIVE_INFINITY : length;
  }
  return out;
}

/**
 * Snapshot predecessor column from a distance store.
 */
function predecessorsFromStore(dist: DistanceStore): Int32Array {
  const out = new Int32Array(dist.pred.length);
  for (let v = 0; v < out.length; v += 1) {
    const pred = dist.pred[v];
    out[v] = pred === undefined ? SENTINEL : pred;
  }
  return out;
}

/**
 * CSR tail vertex for each directed arc index.
 */
function buildEdgeTails(graph: Graph): Int32Array {
  const tails = new Int32Array(graph.m);
  for (let u = 0; u < graph.n; u += 1) {
    const start = graph.offsets[u];
    const end = graph.offsets[u + 1];
    if (start === undefined || end === undefined) {
      throw new Error(`offsets for vertex ${u} missing`);
    }
    for (let e = start; e < end; e += 1) {
      tails[e] = u;
    }
  }
  return tails;
}

/**
 * Settle vertex `v` once globally; throws if the label is not strictly below `B`.
 */
function* emitSettle(
  v: VertexId,
  B: DistanceLabel,
  dist: DistanceStore,
  settleState: SettleState,
): Generator<TraceEvent, void, undefined> {
  if (settleState.settled[v] === 1) {
    return;
  }

  const label = labelAt(dist, v);
  if (label.length === Number.POSITIVE_INFINITY) {
    throw new Error(`DMSY invariant: cannot settle unreachable vertex ${v}`);
  }
  if (compareLabels(label, B) !== "<") {
    throw new Error(
      `DMSY invariant: cannot settle vertex ${v} with label not strictly below bound`,
    );
  }

  settleState.settled[v] = 1;
  yield { k: "settle", v, order: settleState.order, cost: SETTLE_EVENT_COST };
  settleState.order += 1;
}

/**
 * Argmin of `members` under {@link compareLabels}.
 */
function argminLabel(dist: DistanceStore, members: readonly VertexId[]): VertexId {
  if (members.length === 0) {
    throw new Error("argminLabel: empty members");
  }
  let best = members[0];
  if (best === undefined) {
    throw new Error("argminLabel: missing first member");
  }
  let bestLabel = labelAt(dist, best);
  for (let i = 1; i < members.length; i += 1) {
    const candidate = members[i];
    if (candidate === undefined) {
      throw new Error(`argminLabel: missing member at index ${i}`);
    }
    const candidateLabel = labelAt(dist, candidate);
    if (compareLabels(candidateLabel, bestLabel) === "<") {
      best = candidate;
      bestLabel = candidateLabel;
    }
  }
  return best;
}

/**
 * Merge child D into parent D, or absorb leftovers when block capacities forbid merge.
 */
function* absorbChildD(
  parent: PartialSortD,
  child: PartialSortD,
  dist: DistanceStore,
): Generator<TraceEvent, void, undefined> {
  if (child.size === 0) {
    return;
  }
  if (child.blockCapacity < parent.blockCapacity) {
    const mergeResult = parent.merge(child);
    yield {
      k: "dstruct",
      op: "merge",
      n: mergeResult.n,
      cmps: mergeResult.cmps,
    };
    return;
  }

  let totalN = 0;
  let totalCmps = 0;
  while (child.size > 0) {
    const drained = child.pull();
    for (const key of drained.keys) {
      const ins = parent.insert(key, labelAt(dist, key));
      totalN += ins.n;
      totalCmps += ins.cmps;
    }
  }
  if (totalN > 0) {
    yield {
      k: "dstruct",
      op: "merge",
      n: totalN,
      cmps: totalCmps,
    };
  }
}

/**
 * arXiv 2602.07868 Algorithm 4 base case: partial-sort mini-Dijkstra with M = 1.
 */
function* basePartialSort(
  graph: Graph,
  B: DistanceLabel,
  S: readonly VertexId[],
  t: number,
  dist: DistanceStore,
  settleState: SettleState,
): Generator<TraceEvent, DmsyCallResult, undefined> {
  const cap = t * t * t;
  const D = new PartialSortD(1, B);
  const sources = dedupeSourcesAscending(S, graph.n);

  for (const x of sources) {
    const labelX = labelAt(dist, x);
    if (compareLabels(labelX, B) === "<") {
      const insertResult = D.insert(x, labelX);
      yield {
        k: "dstruct",
        op: "insert",
        n: insertResult.n,
        cmps: insertResult.cmps,
      };
    }
  }

  const U: VertexId[] = [];
  const inU = new Uint8Array(graph.n);
  let Bprime = B;
  const { offsets, targets, weights } = graph;

  // arXiv 2602.07868 Algorithm 4
  while (D.size > 0 && U.length <= cap) {
    const pullResult = D.pull();
    yield {
      k: "dstruct",
      op: "pull",
      n: pullResult.n,
      cmps: pullResult.cmps,
    };

    if (pullResult.keys.length === 0) {
      break;
    }

    const u = pullResult.keys[0];
    if (u === undefined) {
      throw new Error("Algorithm 4 pull: missing key with M = 1");
    }
    Bprime = pullResult.bound;

    if (inU[u] === 1) {
      continue;
    }
    inU[u] = 1;
    U.push(u);
    yield* emitSettle(u, B, dist, settleState);

    const arcStart = offsets[u];
    const arcEnd = offsets[u + 1];
    if (arcStart === undefined || arcEnd === undefined) {
      throw new Error(`offsets for vertex ${u} missing`);
    }

    for (let e = arcStart; e < arcEnd; e += 1) {
      const v = targets[e];
      const w = weights[e];
      if (v === undefined || w === undefined) {
        throw new Error(`CSR arc ${e} missing`);
      }

      const accepted = relax(dist, u, v, w, B);
      yield { k: "relax", e, improved: accepted, cost: RELAX_EVENT_COST };

      if (accepted) {
        const insertResult = D.insert(v, labelAt(dist, v));
        yield {
          k: "dstruct",
          op: "insert",
          n: insertResult.n,
          cmps: insertResult.cmps,
        };
      }
    }
  }

  return { Bprime, U, D };
}

/**
 * Internal DMSY recursion (arXiv 2602.07868 Algorithm 3).
 *
 * @param l - Recursion level (0 = Algorithm 4 base case).
 * @param B - Distance upper bound 4-tuple for this call.
 * @param S - Multi-source frontier.
 */
function* dmsy(
  graph: Graph,
  l: number,
  B: DistanceLabel,
  S: readonly VertexId[],
  k: number,
  t: number,
  dist: DistanceStore,
  settleState: SettleState,
): Generator<TraceEvent, DmsyCallResult, undefined> {
  yield { k: "recurse", dir: "in", level: l, bound: B.length };

  let result: DmsyCallResult;

  if (l === 0) {
    result = yield* basePartialSort(graph, B, S, t, dist, settleState);
  } else {
    // arXiv 2602.07868 Algorithm 3
    const M = dmsyBlockSize(l, t);
    const D = new PartialSortD(M, B);

    const pivotResult = yield* findPivotsForest(graph, B, S, k, dist, l);
    const W = pivotResult.W;

    const groups = pivotResult.groups.map((group) => [...group]);
    const P: VertexId[] = [];
    const vertexGroup = new Int32Array(graph.n);
    vertexGroup.fill(SENTINEL);

    for (let j = 0; j < groups.length; j += 1) {
      const group = groups[j];
      if (group === undefined) {
        throw new Error(`groups[${j}] missing`);
      }
      const pj = argminLabel(dist, group);
      P.push(pj);
      for (const v of group) {
        vertexGroup[v] = j;
      }
      const labelPj = labelAt(dist, pj);
      if (compareLabels(labelPj, B) === "<") {
        const insertResult = D.insert(pj, labelPj);
        yield {
          k: "dstruct",
          op: "insert",
          n: insertResult.n,
          cmps: insertResult.cmps,
        };
      }
      yield { k: "pivot", v: pj, level: l };
    }

    const Uall: VertexId[] = [];
    const inUall = new Uint8Array(graph.n);
    let uCount = 0;
    const cap = dmsyWorkloadCap(l, t);
    let Bprime = B;
    const { offsets, targets, weights } = graph;

    while (uCount <= cap && D.size > 0) {
      const pullResult = D.pull();
      yield {
        k: "dstruct",
        op: "pull",
        n: pullResult.n,
        cmps: pullResult.cmps,
      };

      if (pullResult.keys.length === 0) {
        break;
      }

      const Bi = pullResult.bound;
      const SiSet = new Set<VertexId>(pullResult.keys);

      for (const x of pullResult.keys) {
        const labelX = labelAt(dist, x);
        if (compareLabels(labelX, Bi) !== "<") {
          throw new Error(`Lemma 3.6: vertex ${x} in pulled set is not strictly below pull bound`);
        }

        const j = vertexGroup[x];
        if (j !== SENTINEL && P[j] === x) {
          const group = groups[j];
          if (group === undefined) {
            throw new Error(`groups[${j}] missing during S_i expansion`);
          }
          for (const v of group) {
            const labelV = labelAt(dist, v);
            if (compareLabels(labelV, Bi) === "<") {
              SiSet.add(v);
            }
          }
        }
      }

      const Si = [...SiSet].sort((a, b) => a - b);

      yield { k: "batch", phase: "start", level: l, size: Si.length };

      const child = yield* dmsy(graph, l - 1, Bi, Si, k, t, dist, settleState);

      yield { k: "batch", phase: "end", level: l, size: Si.length };

      yield* absorbChildD(D, child.D, dist);

      const Ui = child.U;
      const J = new Set<number>();

      for (const u of Ui) {
        if (inUall[u] === 0) {
          inUall[u] = 1;
          Uall.push(u);
          uCount += 1;
        }

        const j = vertexGroup[u];
        if (j !== SENTINEL) {
          const group = groups[j];
          if (group === undefined) {
            throw new Error(`groups[${j}] missing during pivot maintenance`);
          }
          const idx = group.indexOf(u);
          if (idx >= 0) {
            group.splice(idx, 1);
            vertexGroup[u] = SENTINEL;
          }
          if (u === P[j] && group.length > 0) {
            J.add(j);
          }
        }
      }

      for (const u of Ui) {
        const arcStart = offsets[u];
        const arcEnd = offsets[u + 1];
        if (arcStart === undefined || arcEnd === undefined) {
          throw new Error(`offsets for vertex ${u} missing`);
        }

        for (let e = arcStart; e < arcEnd; e += 1) {
          const v = targets[e];
          const w = weights[e];
          if (v === undefined || w === undefined) {
            throw new Error(`CSR arc ${e} missing`);
          }

          const accepted = relax(dist, u, v, w, B);
          yield { k: "relax", e, improved: accepted, cost: RELAX_EVENT_COST };

          if (accepted) {
            const labelV = labelAt(dist, v);
            const vsBi = compareLabels(labelV, Bi);
            const vsB = compareLabels(labelV, B);
            if ((vsBi === "=" || vsBi === ">") && vsB === "<") {
              // Observation 3.5 is an analysis bound, not a runtime abort: nested
              // calls may both take the [B_i, B) insert path as labels move (DMSY-P30).
              const insertResult = D.insert(v, labelV);
              yield {
                k: "dstruct",
                op: "insert",
                n: insertResult.n,
                cmps: insertResult.cmps,
              };
            }

            const gj = vertexGroup[v];
            if (gj !== SENTINEL && !J.has(gj)) {
              const group = groups[gj];
              if (group !== undefined && group.includes(v)) {
                const pivotV = P[gj];
                if (pivotV !== undefined && compareLabels(labelV, labelAt(dist, pivotV)) === "<") {
                  P[gj] = v;
                }
              }
            }
          }
        }
      }

      for (const j of J) {
        const group = groups[j];
        if (group === undefined || group.length === 0) {
          continue;
        }
        const newPj = argminLabel(dist, group);
        P[j] = newPj;
        const labelPj = labelAt(dist, newPj);
        if (compareLabels(labelPj, B) === "<") {
          const insertResult = D.insert(newPj, labelPj);
          yield {
            k: "dstruct",
            op: "insert",
            n: insertResult.n,
            cmps: insertResult.cmps,
          };
        }
        yield { k: "pivot", v: newPj, level: l };
      }

      Bprime = child.Bprime;

      if (D.size === 0) {
        Bprime = B;
        break;
      }

      if (uCount > cap) {
        break;
      }
    }

    const sources = dedupeSourcesAscending(S, graph.n);
    for (const x of sources) {
      const labelX = labelAt(dist, x);
      const vsBprime = compareLabels(labelX, Bprime);
      const vsB = compareLabels(labelX, B);
      if ((vsBprime === "=" || vsBprime === ">") && vsB === "<") {
        const insertResult = D.insert(x, labelX);
        yield {
          k: "dstruct",
          op: "insert",
          n: insertResult.n,
          cmps: insertResult.cmps,
        };
      }
    }

    const Wprime: VertexId[] = [];
    for (const x of W) {
      if (inUall[x] === 0 && compareLabels(labelAt(dist, x), Bprime) === "<") {
        Wprime.push(x);
      }
    }

    for (const u of Wprime) {
      yield* emitSettle(u, B, dist, settleState);

      const arcStart = offsets[u];
      const arcEnd = offsets[u + 1];
      if (arcStart === undefined || arcEnd === undefined) {
        throw new Error(`offsets for vertex ${u} missing`);
      }

      for (let e = arcStart; e < arcEnd; e += 1) {
        const v = targets[e];
        const w = weights[e];
        if (v === undefined || w === undefined) {
          throw new Error(`CSR arc ${e} missing`);
        }

        const accepted = relax(dist, u, v, w, B);
        yield { k: "relax", e, improved: accepted, cost: RELAX_EVENT_COST };

        if (accepted) {
          const labelV = labelAt(dist, v);
          if (compareLabels(labelV, Bprime) !== "<") {
            const insertResult = D.insert(v, labelV);
            yield {
              k: "dstruct",
              op: "insert",
              n: insertResult.n,
              cmps: insertResult.cmps,
            };
          }
        }
      }
    }

    for (const u of Wprime) {
      if (inUall[u] === 0) {
        inUall[u] = 1;
        Uall.push(u);
      }
    }

    const U: VertexId[] = [];
    for (const v of Uall) {
      if (compareLabels(labelAt(dist, v), Bprime) === "<") {
        U.push(v);
      }
    }

    result = { Bprime, U, D };
  }

  yield { k: "recurse", dir: "out", level: l, bound: result.Bprime.length };
  return result;
}

/**
 * Instrumented DMSY generator on the graph it is given (already reduced or identity).
 *
 * Yields {@link TraceEvent}s for recursion, pivots, data-structure ops, settlements,
 * and relaxations. Returns distances, predecessors, and the live {@link DistanceStore}.
 *
 * @param graph - CSR directed graph with non-negative weights.
 * @param source - Source vertex in `0 .. graph.n - 1`.
 * @param params - Optional k/t parameters; defaults to {@link paperDmsyParams}(n).
 */
export function* runInstrumented(
  graph: Graph,
  source: VertexId,
  params?: DmsyParams,
): Generator<TraceEvent, DmsyInstrumentedResult, undefined> {
  if (!Number.isInteger(source) || source < 0 || source >= graph.n) {
    throw new Error(`source must be an integer in [0, ${graph.n}), got ${String(source)}`);
  }

  const n = graph.n;
  const { k, t } = resolveParams(n, params, 3);

  const dist = createDistanceStore(n);
  dist.length[source] = 0;
  dist.nEdges[source] = 0;
  dist.curr[source] = source;
  dist.pred[source] = SENTINEL;

  const settleState: SettleState = {
    order: 0,
    settled: new Uint8Array(n),
  };

  const lTop = dmsyRecursionDepth(n, t);
  yield* dmsy(graph, lTop, B_INFINITY, [source], k, t, dist, settleState);

  return {
    distances: distancesFromStore(dist),
    predecessors: predecessorsFromStore(dist),
    dist,
  };
}

/**
 * Public DMSY lane: degree reduction, instrumented run on G′, and trace un-mapping.
 *
 * Returns shortest-path distances and predecessors on the **original** gallery graph.
 *
 * @param graph - Original CSR directed graph.
 * @param source - Source vertex on the original graph.
 * @param params - Optional k/t parameters; when omitted, δ for the t formula is
 *   `degreeReduce(...).delta ?? 3` evaluated on the original `graph.n`.
 */
export function* run(
  graph: Graph,
  source: VertexId,
  params?: DmsyParams,
): Generator<TraceEvent, DmsyResult, undefined> {
  if (!Number.isInteger(source) || source < 0 || source >= graph.n) {
    throw new Error(`source must be an integer in [0, ${graph.n}), got ${String(source)}`);
  }

  const reduced = degreeReduce(graph);
  const src = reducedSource(reduced.vertexMap, source);
  const unmap = createTraceUnmapper(reduced);

  const resolvedParams =
    params === undefined
      ? resolveParams(graph.n, undefined, reduced.delta ?? 3)
      : resolveParams(graph.n, params, reduced.delta ?? 3);

  const origDist = new Float64Array(graph.n);
  origDist.fill(Number.POSITIVE_INFINITY);
  origDist[source] = 0;

  const origPred = new Int32Array(graph.n);
  origPred.fill(SENTINEL);

  const edgeTails = buildEdgeTails(graph);
  const { weights, targets } = graph;

  const innerGen = runInstrumented(reduced.graph, src, resolvedParams);
  let step = innerGen.next();
  while (!step.done) {
    const mapped = unmap(step.value);
    if (mapped !== null) {
      if (mapped.k === "relax") {
        const e = mapped.e;
        const from = edgeTails[e];
        const to = targets[e];
        const w = weights[e];
        if (from === undefined || to === undefined || w === undefined) {
          throw new Error(`CSR arc ${e} missing during relax unmap`);
        }
        const distFrom = origDist[from];
        const distTo = origDist[to];
        if (distFrom === undefined || distTo === undefined) {
          throw new Error(`origDist missing for relax on edge ${e}`);
        }
        const cand = distFrom + w;
        const improved = cand < distTo;
        yield { k: "relax", e, improved, cost: RELAX_EVENT_COST };
        if (cand <= distTo) {
          if (improved) {
            origDist[to] = cand;
            origPred[to] = from;
          }
        }
      } else {
        yield mapped;
      }
    }
    step = innerGen.next();
  }

  const innerResult = step.value;
  return {
    distances: mapBackDistances(innerResult.distances, reduced.vertexMap, graph.n),
    predecessors: origPred,
  };
}
