import { describe, expect, it } from "vitest";

import { findPivots, type FindPivotsResult } from "../src/core/bmssp/findPivots.ts";
import { bmsspParams } from "../src/core/bmssp/params.ts";
import {
  generateGraph,
  GRAPH_KINDS,
  packCsr,
  type CsrEdge,
  type Graph,
  type VertexId,
} from "../src/core/graph.ts";
import { type TraceEvent } from "../src/core/trace.ts";

/**
 * Run findPivots to completion, collecting trace events and the final result.
 *
 * @throws If the generator finishes without returning a result object.
 */
function drainFindPivots(
  graph: Graph,
  B: number,
  S: readonly VertexId[],
  k: number,
  dist: Float64Array,
  level: number,
): {
  events: TraceEvent[];
  result: FindPivotsResult;
} {
  const events: TraceEvent[] = [];
  const gen = findPivots(graph, B, S, k, dist, level);

  for (;;) {
    const step = gen.next();
    if (step.done) {
      if (step.value === undefined) {
        throw new Error("findPivots finished without returning a result");
      }
      return { events, result: step.value };
    }
    events.push(step.value);
  }
}

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

function numberArraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function isSortedAscending(arr: readonly number[]): boolean {
  for (let i = 1; i < arr.length; i += 1) {
    const prev = arr[i - 1];
    const cur = arr[i];
    if (prev === undefined || cur === undefined || cur < prev) {
      return false;
    }
  }
  return true;
}

function isSubset(subset: readonly number[], superset: readonly number[]): boolean {
  let j = 0;
  for (const v of subset) {
    while (j < superset.length) {
      const w = superset[j];
      if (w === undefined || w >= v) {
        break;
      }
      j += 1;
    }
    const w = superset[j];
    if (w !== v) {
      return false;
    }
    j += 1;
  }
  return true;
}

function formatCtx(
  seed: number,
  kind: string,
  n: number,
  k: number,
  S: readonly number[],
  B: number,
): string {
  return `seed=${seed} kind=${kind} n=${n} k=${k} S=[${S.join(",")}] B=${String(B)}`;
}

/**
 * Check Lemma 3.2 / Algorithm 1 abort invariants and trace consistency.
 */
function collectFindPivotsViolations(
  ctx: string,
  k: number,
  S: readonly number[],
  snapshot: Float64Array,
  dist: Float64Array,
  events: readonly TraceEvent[],
  result: FindPivotsResult,
): string[] {
  const violations: string[] = [];
  const uniqueS = uniqueSorted(S);

  if (!isSortedAscending(result.P)) {
    violations.push(`${ctx}: result.P is not sorted ascending`);
  }
  if (!isSortedAscending(result.W)) {
    violations.push(`${ctx}: result.W is not sorted ascending`);
  }

  if (!isSubset(result.P, result.W)) {
    violations.push(`${ctx}: P is not a subset of W`);
  }
  if (!isSubset(result.P, uniqueS)) {
    violations.push(`${ctx}: P is not a subset of unique S`);
  }

  for (let v = 0; v < dist.length; v += 1) {
    const after = dist[v];
    const before = snapshot[v];
    if (after === undefined || before === undefined) {
      violations.push(`${ctx}: dist[${v}] or snapshot[${v}] missing`);
      continue;
    }
    if (after > before) {
      violations.push(`${ctx}: dist[${v}] increased ${before} -> ${after}`);
    }
  }

  const pivotVerts: number[] = [];
  let batchStarts = 0;
  let batchEnds = 0;
  for (const event of events) {
    if (event.k === "pivot") {
      pivotVerts.push(event.v);
    }
    if (event.k === "batch") {
      if (event.phase === "start") {
        batchStarts += 1;
      } else {
        batchEnds += 1;
      }
    }
  }
  pivotVerts.sort((a, b) => a - b);

  if (!numberArraysEqual(pivotVerts, result.P)) {
    violations.push(
      `${ctx}: pivot events [${pivotVerts.join(",")}] != result.P [${result.P.join(",")}]`,
    );
  }
  if (batchStarts !== batchEnds) {
    violations.push(`${ctx}: batch start count ${batchStarts} != end count ${batchEnds}`);
  }

  if (!result.aborted) {
    if (result.P.length * k > result.W.length) {
      violations.push(
        `${ctx}: lemma violation |P|*k=${result.P.length * k} > |W|=${result.W.length}`,
      );
    }
    for (const p of result.P) {
      if (!uniqueS.includes(p)) {
        violations.push(`${ctx}: pivot ${p} not in unique S`);
      }
    }
  } else {
    if (!numberArraysEqual(result.P, uniqueS)) {
      violations.push(
        `${ctx}: aborted P [${result.P.join(",")}] != unique S [${uniqueS.join(",")}]`,
      );
    }
    if (result.W.length <= k * uniqueS.length) {
      violations.push(`${ctx}: aborted but |W|=${result.W.length} <= k*|S|=${k * uniqueS.length}`);
    }
  }

  return violations;
}

function runSeededCase(seed: number, k: number): string[] {
  const kind = GRAPH_KINDS[seed % 4];
  const n = 8 + (seed % 40);
  const graph = generateGraph(kind, n, seed);
  const sourceCount = 1 + (seed % Math.min(4, n));
  const S: number[] = [];
  for (let i = 0; i < sourceCount; i += 1) {
    S.push((seed + i * 3) % n);
  }
  const dist = new Float64Array(n);
  dist.fill(Number.POSITIVE_INFINITY);
  for (const s of S) {
    dist[s] = 0;
  }
  const snapshot = Float64Array.from(dist);
  const B = seed % 3 === 0 ? Number.POSITIVE_INFINITY : 20 + (seed % 50);
  const ctx = formatCtx(seed, kind, n, k, S, B);

  const { events, result } = drainFindPivots(graph, B, S, k, dist, 0);
  return collectFindPivotsViolations(ctx, k, S, snapshot, dist, events, result);
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

describe("findPivots differential fuzz", () => {
  it("satisfies Lemma 3.2 invariants on 200 seeded generateGraph cases", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 200; seed += 1) {
      const kind = GRAPH_KINDS[seed % 4];
      const n = 8 + (seed % 40);
      const graph = generateGraph(kind, n, seed);
      const { k } = bmsspParams(n);
      const sourceCount = 1 + (seed % Math.min(4, n));
      const S: number[] = [];
      for (let i = 0; i < sourceCount; i += 1) {
        S.push((seed + i * 3) % n);
      }
      const dist = new Float64Array(n);
      dist.fill(Number.POSITIVE_INFINITY);
      for (const s of S) {
        dist[s] = 0;
      }
      const snapshot = Float64Array.from(dist);
      const B = seed % 3 === 0 ? Number.POSITIVE_INFINITY : 20 + (seed % 50);
      const ctx = formatCtx(seed, kind, n, k, S, B);

      const { events, result } = drainFindPivots(graph, B, S, k, dist, 0);
      violations.push(...collectFindPivotsViolations(ctx, k, S, snapshot, dist, events, result));
    }

    expect(violations).toEqual([]);
  }, 30_000);

  it("satisfies Lemma 3.2 with explicit k=1 on first 50 seeded graphs", () => {
    const violations: string[] = [];

    for (let seed = 0; seed < 50; seed += 1) {
      violations.push(...runSeededCase(seed, 1));
    }

    expect(violations).toEqual([]);
  }, 30_000);

  it("handles equal-weight tie graphs without throwing", () => {
    const n = 12;
    const graph = buildEqualWeightCycleGraph(n);
    const S = [0, 1];
    const k = 2;
    const B = Number.POSITIVE_INFINITY;
    const dist = new Float64Array(n);
    dist.fill(Number.POSITIVE_INFINITY);
    dist[0] = 0;
    dist[1] = 0;
    const snapshot = Float64Array.from(dist);
    const ctx = formatCtx(0, "ties", n, k, S, B);

    const { events, result } = drainFindPivots(graph, B, S, k, dist, 0);
    const violations = collectFindPivotsViolations(ctx, k, S, snapshot, dist, events, result);

    expect(violations).toEqual([]);
  }, 30_000);
});
