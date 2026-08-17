import { describe, expect, it } from "vitest";

import {
  B_INFINITY,
  compareLabels,
  type DistanceLabel,
  type DistanceStore,
  type ForestFindPivotsResult,
} from "../src/core/dmsy/forest.ts";
import {
  generateGraph,
  GRAPH_KINDS,
  packCsr,
  type CsrEdge,
  type EdgeId,
  type Graph,
  type VertexId,
} from "../src/core/graph.ts";
import { SENTINEL, type TraceEvent } from "../src/core/trace.ts";
import { auditForestTrace, drainFindPivotsForest, makeLabels } from "./forest-helpers.ts";

function uniqueSorted(vertices: readonly number[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const v of vertices) {
    if (!seen.has(v)) {
      seen.add(v);
      unique.push(v);
    }
  }
  unique.sort((a, b) => a - b);
  return unique;
}

function isSortedAscendingUnique(arr: readonly number[]): boolean {
  for (let i = 1; i < arr.length; i += 1) {
    const prev = arr[i - 1];
    const cur = arr[i];
    if (prev === undefined || cur === undefined || cur <= prev) {
      return false;
    }
  }
  return true;
}

function setsEqual(a: readonly number[], b: readonly number[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) {
    return false;
  }
  for (const v of setA) {
    if (!setB.has(v)) {
      return false;
    }
  }
  return true;
}

function labelAt(dist: DistanceStore, v: VertexId): DistanceLabel {
  const length = dist.length[v];
  const nEdges = dist.nEdges[v];
  const curr = dist.curr[v];
  const pred = dist.pred[v];
  if (length === undefined || nEdges === undefined || curr === undefined || pred === undefined) {
    throw new Error(`dist label at vertex ${v} missing`);
  }
  return { length, nEdges, curr, pred };
}

function edgeSource(graph: Graph, e: EdgeId): VertexId {
  const { offsets, n } = graph;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const start = offsets[mid];
    if (start === undefined) {
      throw new Error(`offsets for vertex ${mid} missing`);
    }
    if (start <= e) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const u = lo - 1;
  const start = offsets[u];
  const end = offsets[u + 1];
  if (u < 0 || start === undefined || end === undefined || e < start || e >= end) {
    throw new Error(`edge ${e} not found in graph CSR`);
  }
  return u;
}

function formatCtx(
  seed: number,
  kind: string,
  n: number,
  k: number,
  S: readonly number[],
  B: DistanceLabel,
): string {
  return `seed=${seed} kind=${kind} n=${n} k=${k} S=[${S.join(",")}] B.length=${String(B.length)}`;
}

function traceEventsEqual(a: readonly TraceEvent[], b: readonly TraceEvent[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const ea = a[i];
    const eb = b[i];
    if (ea === undefined || eb === undefined) {
      return false;
    }
    if (ea.k !== eb.k) {
      return false;
    }
    switch (ea.k) {
      case "relax":
        if (
          eb.k !== "relax" ||
          ea.e !== eb.e ||
          ea.improved !== eb.improved ||
          ea.cost !== eb.cost
        ) {
          return false;
        }
        break;
      case "heap":
        if (eb.k !== "heap" || ea.op !== eb.op || ea.cmps !== eb.cmps) {
          return false;
        }
        break;
      case "pivot":
        if (eb.k !== "pivot" || ea.v !== eb.v || ea.level !== eb.level) {
          return false;
        }
        break;
      case "forest":
        if (eb.k !== "forest" || ea.op !== eb.op || ea.e !== eb.e || ea.tree !== eb.tree) {
          return false;
        }
        break;
      default:
        return false;
    }
  }
  return true;
}

/**
 * Remark 3.3 / Lemma A.1 / §5.2 invariants for spanning-forest FindPivots.
 */
function collectForestViolations(
  ctx: string,
  graph: Graph,
  k: number,
  S: readonly number[],
  dist: DistanceStore,
  events: readonly TraceEvent[],
  result: ForestFindPivotsResult,
): string[] {
  const violations: string[] = [];
  const uniqueS = uniqueSorted(S);

  if (result.P.length !== result.groups.length) {
    violations.push(`${ctx}: |P|=${result.P.length} != |groups|=${result.groups.length}`);
  }

  if (!isSortedAscendingUnique(result.Q)) {
    violations.push(`${ctx}: result.Q is not sorted ascending unique`);
  }
  if (!isSortedAscendingUnique(result.W)) {
    violations.push(`${ctx}: result.W is not sorted ascending unique`);
  }

  for (const q of result.Q) {
    if (!result.W.includes(q)) {
      violations.push(`${ctx}: Q vertex ${q} not in W`);
    }
  }

  if (result.P.length > uniqueS.length) {
    violations.push(`${ctx}: |P|=${result.P.length} > |unique S|=${uniqueS.length}`);
  }

  const qSet = new Set(result.Q);
  const allGroupVerts: number[] = [];
  for (const group of result.groups) {
    for (const v of group) {
      allGroupVerts.push(v);
    }
  }
  const unionGroupsAndQ = uniqueSorted([...allGroupVerts, ...result.Q]);
  if (!setsEqual(unionGroupsAndQ, uniqueS)) {
    violations.push(
      `${ctx}: union(groups,Q) [${unionGroupsAndQ.join(",")}] != unique S [${uniqueS.join(",")}]`,
    );
  }

  const seenInGroups = new Set<number>();
  for (let j = 0; j < result.groups.length; j += 1) {
    const group = result.groups[j];
    for (const v of group) {
      if (qSet.has(v)) {
        violations.push(`${ctx}: group ${j} contains Q vertex ${v}`);
      }
      if (seenInGroups.has(v)) {
        violations.push(`${ctx}: vertex ${v} appears in multiple groups`);
      }
      seenInGroups.add(v);
    }
  }

  const sourcesNotInQ: number[] = [];
  for (const s of uniqueS) {
    if (!qSet.has(s)) {
      sourcesNotInQ.push(s);
    }
  }
  for (const s of sourcesNotInQ) {
    if (!seenInGroups.has(s)) {
      violations.push(`${ctx}: source ${s} in S\\Q not assigned to any group`);
    }
  }
  for (const s of sourcesNotInQ) {
    let count = 0;
    for (const group of result.groups) {
      if (group.includes(s)) {
        count += 1;
      }
    }
    if (count !== 1) {
      violations.push(`${ctx}: source ${s} in S\\Q appears in ${count} groups`);
    }
  }

  for (let j = 0; j < result.P.length; j += 1) {
    const p = result.P[j];
    const group = result.groups[j];
    if (group === undefined) {
      violations.push(`${ctx}: missing group for pivot index ${j}`);
      continue;
    }
    if (!group.includes(p)) {
      violations.push(`${ctx}: P[${j}]=${p} not in groups[${j}]`);
    }

    let best = p;
    let bestLabel = labelAt(dist, best);
    for (const v of group) {
      const candidateLabel = labelAt(dist, v);
      if (compareLabels(candidateLabel, bestLabel) === "<") {
        best = v;
        bestLabel = candidateLabel;
      }
    }
    if (best !== p) {
      violations.push(`${ctx}: P[${j}]=${p} is not compareLabels-min of group[${j}]`);
    }
  }

  try {
    auditForestTrace(graph, events, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    violations.push(`${ctx}: auditForestTrace failed: ${message}`);
  }

  const cutByTree = new Map<number, EdgeId[]>();
  for (const event of events) {
    if (event.k === "forest" && event.op === "cut") {
      if (event.e < 0) {
        violations.push(`${ctx}: cut event has negative edge id ${event.e}`);
      }
      const group = cutByTree.get(event.tree);
      if (group === undefined) {
        cutByTree.set(event.tree, [event.e]);
      } else {
        group.push(event.e);
      }
    }
  }

  const seenCutEdges = new Set<EdgeId>();
  for (const edges of cutByTree.values()) {
    for (const e of edges) {
      if (seenCutEdges.has(e)) {
        violations.push(`${ctx}: cut edge ${e} appears in multiple cut groups`);
      }
      seenCutEdges.add(e);
    }
  }

  for (const edges of cutByTree.values()) {
    if (edges.length === 0) {
      continue;
    }
    const endpoints = new Set<VertexId>();
    for (const e of edges) {
      const u = edgeSource(graph, e);
      const v = graph.targets[e];
      if (v === undefined) {
        violations.push(`${ctx}: cut edge ${e} missing target`);
        continue;
      }
      endpoints.add(u);
      endpoints.add(v);
    }
    const vertCount = endpoints.size;
    if (vertCount < k || vertCount >= 3 * k) {
      violations.push(
        `${ctx}: cut-tree with ${edges.length} edges has |V|=${vertCount} not in [${k}, ${3 * k})`,
      );
    }
  }

  for (const event of events) {
    if (
      event.k === "batch" ||
      event.k === "settle" ||
      event.k === "recurse" ||
      event.k === "dstruct"
    ) {
      violations.push(`${ctx}: forbidden ${event.k} event in forest trace`);
    }
  }

  return violations;
}

function runSeededForestCase(seed: number, k: number): string[] {
  const kind = GRAPH_KINDS[seed % GRAPH_KINDS.length];
  if (kind === undefined) {
    throw new Error(`unexpected graph kind index for seed ${String(seed)}`);
  }
  const n = 8 + (seed % 40);
  const graph = generateGraph(kind, n, seed);
  const sourceCount = 1 + (seed % Math.min(4, n));
  const S: number[] = [];
  for (let i = 0; i < sourceCount; i += 1) {
    S.push((seed + i * 3) % n);
  }
  const dist = makeLabels(n, S);
  const B =
    seed % 3 === 0
      ? B_INFINITY
      : { length: 20 + (seed % 50), nEdges: 0, curr: SENTINEL, pred: SENTINEL };
  const ctx = formatCtx(seed, kind, n, k, S, B);

  const { events, result } = drainFindPivotsForest(graph, B, S, k, dist, 0);
  const violations = collectForestViolations(ctx, graph, k, S, dist, events, result);

  if (seed % 17 === 0) {
    const dist2 = makeLabels(n, S);
    const { events: events2 } = drainFindPivotsForest(graph, B, S, k, dist2, 0);
    if (!traceEventsEqual(events, events2)) {
      violations.push(`${ctx}: two drains produced different events`);
    }
  }

  return violations;
}

function buildEqualWeightCycleGraph(n: number): Graph {
  const edges: CsrEdge[] = [];
  for (let i = 0; i < n; i += 1) {
    const to1 = (i + 1) % n;
    const to2 = (i + 2) % n;
    if (to1 !== i) {
      edges.push({ from: i, to: to1, weight: 1 });
    }
    if (to2 !== i) {
      edges.push({ from: i, to: to2, weight: 1 });
    }
  }
  const x = Array.from({ length: n }, (_, i) => i);
  const y = Array.from({ length: n }, () => 0);
  return packCsr(n, edges, x, y);
}

describe("findPivotsForest differential fuzz", () => {
  it("satisfies Remark 3.3 / Lemma A.1 invariants on 200 seeded generateGraph cases", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 200; seed += 1) {
      const k = 1 + (seed % 3);
      violations.push(...runSeededForestCase(seed, k));
    }

    expect(violations).toEqual([]);
  }, 30_000);

  it("satisfies Remark 3.3 with explicit k=1 on first 50 seeded graphs", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 50; seed += 1) {
      violations.push(...runSeededForestCase(seed, 1));
    }

    expect(violations).toEqual([]);
  }, 30_000);

  it("handles equal-weight tie graphs without throwing", () => {
    const n = 12;
    const graph = buildEqualWeightCycleGraph(n);
    const S = [0, 1];
    const k = 2;
    const B = B_INFINITY;
    const dist = makeLabels(n, S);
    const ctx = formatCtx(0, "ties", n, k, S, B);

    const { events, result } = drainFindPivotsForest(graph, B, S, k, dist, 0);
    const violations = collectForestViolations(ctx, graph, k, S, dist, events, result);

    expect(violations).toEqual([]);
  }, 30_000);
});
