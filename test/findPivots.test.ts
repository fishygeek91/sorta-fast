import { describe, expect, it } from "vitest";

import { findPivots, type FindPivotsResult } from "../src/core/bmssp/findPivots.ts";
import { packCsr, type Graph, type VertexId } from "../src/core/graph.ts";
import {
  costOf,
  decodeChunk,
  OP_COST,
  scanCosts,
  tally,
  type TraceEvent,
  TraceWriter,
} from "../src/core/trace.ts";

/** Initialize a distance array with Infinity except for sources at `sourceDist`. */
function makeDist(n: number, S: number[], sourceDist = 0): Float64Array {
  const dist = new Float64Array(n);
  dist.fill(Number.POSITIVE_INFINITY);
  for (const s of S) {
    dist[s] = sourceDist;
  }
  return dist;
}

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
): { events: TraceEvent[]; result: FindPivotsResult } {
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

/**
 * Trace audit for findPivots: pivot vertices match P, relax edge ids are valid,
 * and batch start/end events nest properly.
 */
function auditFindPivotsTrace(
  graph: Graph,
  events: readonly TraceEvent[],
  expectedP: readonly VertexId[],
): void {
  const pivots: VertexId[] = [];
  let batchDepth = 0;

  for (const event of events) {
    switch (event.k) {
      case "relax":
        expect(event.e).toBeGreaterThanOrEqual(0);
        expect(event.e).toBeLessThan(graph.m);
        break;
      case "batch":
        if (event.phase === "start") {
          batchDepth += 1;
        } else {
          batchDepth -= 1;
          expect(batchDepth).toBeGreaterThanOrEqual(0);
        }
        break;
      case "pivot":
        pivots.push(event.v);
        break;
      default:
        break;
    }
  }

  expect(batchDepth).toBe(0);
  pivots.sort((a, b) => a - b);
  const sortedExpected = [...expectedP].sort((a, b) => a - b);
  expect(pivots).toEqual(sortedExpected);
}

describe("findPivots validation", () => {
  const tiny = packCsr(1, [], [0], [0]);
  const dist = makeDist(1, [0]);

  it("rejects k=0, k=-1, and non-integer k", () => {
    expect(() => findPivots(tiny, Infinity, [0], 0, dist, 0).next()).toThrow(
      /k must be an integer/,
    );
    expect(() => findPivots(tiny, Infinity, [0], -1, dist, 0).next()).toThrow(
      /k must be an integer/,
    );
    expect(() => findPivots(tiny, Infinity, [0], 1.5, dist, 0).next()).toThrow(
      /k must be an integer/,
    );
  });

  it("rejects negative level", () => {
    expect(() => findPivots(tiny, Infinity, [0], 1, dist, -1).next()).toThrow(
      /level must be a non-negative integer/,
    );
  });

  it("rejects NaN and -Infinity B", () => {
    expect(() => findPivots(tiny, Number.NaN, [0], 1, dist, 0).next()).toThrow(
      /B must be finite or \+Infinity/,
    );
    expect(() => findPivots(tiny, Number.NEGATIVE_INFINITY, [0], 1, dist, 0).next()).toThrow(
      /B must be finite or \+Infinity/,
    );
  });

  it("rejects dist.length !== n", () => {
    const wrongLen = new Float64Array(2);
    expect(() => findPivots(tiny, Infinity, [0], 1, wrongLen, 0).next()).toThrow(
      /dist.length must equal graph.n/,
    );
  });

  it("rejects out-of-range sources", () => {
    expect(() => findPivots(tiny, Infinity, [-1], 1, dist, 0).next()).toThrow(
      /every source must be an integer/,
    );
    expect(() => findPivots(tiny, Infinity, [1], 1, dist, 0).next()).toThrow(
      /every source must be an integer/,
    );
  });
});

describe("findPivots empty S", () => {
  it("runs k rounds with empty frontier and returns empty P and W", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const dist = makeDist(3, []);
    const { events, result } = drainFindPivots(graph, Infinity, [], 2, dist, 0);

    expect(result).toEqual({ P: [], W: [], aborted: false });
    expect(events).toEqual([
      { k: "batch", phase: "start", level: 0, size: 0 },
      { k: "batch", phase: "end", level: 0, size: 0 },
      { k: "batch", phase: "start", level: 0, size: 0 },
      { k: "batch", phase: "end", level: 0, size: 0 },
    ]);
    expect(events.some((e) => e.k === "relax")).toBe(false);
    expect(events.some((e) => e.k === "pivot")).toBe(false);
  });
});

describe("findPivots k=1", () => {
  it("aborts when one round grows W beyond k*|S| on a single edge", () => {
    const graph = packCsr(2, [{ from: 0, to: 1, weight: 1 }], [0, 1], [0, 0]);
    const dist = makeDist(2, [0]);
    const { events, result } = drainFindPivots(graph, Infinity, [0], 1, dist, 0);

    expect(result.P).toEqual([0]);
    expect(result.W).toEqual([0, 1]);
    expect(result.aborted).toBe(true);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBe(1);
    expect(events.some((e) => e.k === "relax" && e.e === 0 && e.improved)).toBe(true);
    expect(events.filter((e) => e.k === "pivot")).toEqual([{ k: "pivot", v: 0, level: 0 }]);
  });

  it("does not abort on an edgeless single vertex with k=1", () => {
    const graph = packCsr(1, [], [0], [0]);
    const dist = makeDist(1, [0]);
    const { events, result } = drainFindPivots(graph, Infinity, [0], 1, dist, 0);

    expect(result.P).toEqual([0]);
    expect(result.W).toEqual([0]);
    expect(result.aborted).toBe(false);
    expect(events.some((e) => e.k === "relax")).toBe(false);
    expect(events.filter((e) => e.k === "pivot")).toEqual([{ k: "pivot", v: 0, level: 0 }]);
  });
});

describe("findPivots finite B", () => {
  it("updates dist beyond B but does not add vertices with cand >= B to W", () => {
    const graph = packCsr(
      3,
      [
        { from: 0, to: 1, weight: 1 },
        { from: 1, to: 2, weight: 1 },
      ],
      [0, 1, 2],
      [0, 0, 0],
    );
    const dist = makeDist(3, [0]);
    const { result } = drainFindPivots(graph, 1.5, [0], 3, dist, 0);

    expect(result.P).toEqual([]);
    expect(result.W).toEqual([0, 1]);
    expect(result.aborted).toBe(false);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBe(1);
    expect(dist[2]).toBe(2);
    expect(result.W.includes(2)).toBe(false);
  });
});

describe("findPivots abort diamond", () => {
  const graph = packCsr(
    4,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 3, weight: 1 },
      { from: 2, to: 3, weight: 1 },
    ],
    [0, 1, 2, 3],
    [0, 0, 0, 0],
  );

  it("aborts after round 1 when |W| exceeds k*|S|", () => {
    const dist = makeDist(4, [0]);
    const { result } = drainFindPivots(graph, Infinity, [0], 2, dist, 0);

    expect(result.P).toEqual([0]);
    expect(result.W).toEqual([0, 1, 2]);
    expect(result.aborted).toBe(true);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBe(1);
    expect(dist[2]).toBe(1);
  });
});

describe("findPivots golden non-abort path", () => {
  const graph = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  const expectedEvents: TraceEvent[] = [
    { k: "batch", phase: "start", level: 0, size: 1 },
    { k: "relax", e: 0, improved: true, cost: 1 },
    { k: "batch", phase: "end", level: 0, size: 1 },
    { k: "batch", phase: "start", level: 0, size: 1 },
    { k: "relax", e: 1, improved: true, cost: 1 },
    { k: "batch", phase: "end", level: 0, size: 1 },
    { k: "batch", phase: "start", level: 0, size: 1 },
    { k: "batch", phase: "end", level: 0, size: 0 },
    { k: "pivot", v: 0, level: 0 },
  ];

  it("emits the hand-verified trace on a 0→1→2 chain with k=3", () => {
    const dist = makeDist(3, [0]);
    const { events, result } = drainFindPivots(graph, Infinity, [0], 3, dist, 0);

    expect(events).toEqual(expectedEvents);
    expect(result).toEqual({ P: [0], W: [0, 1, 2], aborted: false });
    expect(Array.from(dist)).toEqual([0, 1, 2]);
  });
});

describe("findPivots trace audit", () => {
  const goldenGraph = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  const diamondGraph = packCsr(
    4,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 3, weight: 1 },
      { from: 2, to: 3, weight: 1 },
    ],
    [0, 1, 2, 3],
    [0, 0, 0, 0],
  );

  it("audits golden path events", () => {
    const dist = makeDist(3, [0]);
    const { events, result } = drainFindPivots(goldenGraph, Infinity, [0], 3, dist, 0);
    auditFindPivotsTrace(goldenGraph, events, result.P);
  });

  it("audits abort diamond events", () => {
    const dist = makeDist(4, [0]);
    const { events, result } = drainFindPivots(diamondGraph, Infinity, [0], 2, dist, 0);
    auditFindPivotsTrace(diamondGraph, events, result.P);
  });
});

describe("findPivots comparison accounting", () => {
  const goldenEvents: TraceEvent[] = [
    { k: "batch", phase: "start", level: 0, size: 1 },
    { k: "relax", e: 0, improved: true, cost: 1 },
    { k: "batch", phase: "end", level: 0, size: 1 },
    { k: "batch", phase: "start", level: 0, size: 1 },
    { k: "relax", e: 1, improved: true, cost: 1 },
    { k: "batch", phase: "end", level: 0, size: 1 },
    { k: "batch", phase: "start", level: 0, size: 1 },
    { k: "batch", phase: "end", level: 0, size: 0 },
    { k: "pivot", v: 0, level: 0 },
  ];

  it("tallies relax work and zero-cost structure events on golden trace", () => {
    const relaxCount = goldenEvents.filter((e) => e.k === "relax").length;
    const billedRelax = relaxCount * OP_COST.relax;

    for (const event of goldenEvents) {
      if (event.k === "pivot") {
        expect(costOf(event)).toBe(0);
      }
      if (event.k === "batch") {
        expect(costOf(event)).toBe(0);
      }
    }

    const writer = new TraceWriter();
    for (const event of goldenEvents) {
      writer.append(event);
    }
    const chunks = writer.takeChunks();
    expect(chunks.length).toBeGreaterThan(0);

    let work = 0;
    let relaxations = 0;
    let pivots = 0;
    let batches = 0;
    for (const chunk of chunks) {
      const t = tally(chunk);
      work += t.work;
      relaxations += t.relaxations;
      pivots += t.pivots;
      batches += t.batches;
      expect(scanCosts(chunk)).toEqual(t);
    }

    expect(work).toBe(billedRelax);
    expect(work).toBe(relaxCount);
    expect(relaxations).toBe(2);
    expect(pivots).toBe(1);
    expect(batches).toBe(6);

    const decoded: TraceEvent[] = [];
    for (const chunk of chunks) {
      decoded.push(...decodeChunk(chunk));
    }
    expect(decoded).toEqual(goldenEvents);
  });
});

describe("findPivots duplicate sources", () => {
  it("deduplicates repeated sources like a single S=[0]", () => {
    const graph = packCsr(1, [], [0], [0]);
    const distSingle = makeDist(1, [0]);
    const distDup = makeDist(1, [0]);

    const single = drainFindPivots(graph, Infinity, [0], 1, distSingle, 0);
    const dup = drainFindPivots(graph, Infinity, [0, 0, 0], 1, distDup, 0);

    expect(dup.result).toEqual(single.result);
    expect(dup.events).toEqual(single.events);
  });
});
