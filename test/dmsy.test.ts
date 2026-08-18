import { describe, expect, it } from "vitest";

import { bellmanFord } from "../src/core/bellmanFord.ts";
import { degreeReduce } from "../src/core/dmsy/degreeReduce.ts";
import {
  dmsyBlockSize,
  dmsyRecursionDepth,
  dmsyWorkloadCap,
  paperDmsyParams,
  run as dmsyRun,
  runInstrumented,
} from "../src/core/dmsy/dmsy.ts";
import { compareLabels, labelAt } from "../src/core/dmsy/forest.ts";
import { generateGraph, packCsr, type CsrEdge, type Graph } from "../src/core/graph.ts";
import {
  costOf,
  decodeChunk,
  OP_COST,
  SENTINEL,
  type TraceEvent,
  TraceWriter,
} from "../src/core/trace.ts";
import { drainBmsspRun } from "./bmssp-helpers.ts";
import { drainRun } from "./dijkstra-helpers.ts";
import {
  assertDmsyBoundedSettle,
  assertDmsyLexTieBreak,
  assertDmsySettleFinality,
  auditDmsyLengthsFromTrace,
  drainDmsyInstrumented,
  drainDmsyRun,
} from "./dmsy-helpers.ts";

/** Compare Float64Arrays including Infinity entries. */
function expectDistancesEqual(a: Float64Array, b: Float64Array): void {
  expect(Array.from(a)).toEqual(Array.from(b));
}

/** Bidirected complete digraph on vertices `0 .. n-1`. */
function bidirectedComplete(n: number, weight = 1): Graph {
  const edges: CsrEdge[] = [];
  for (let u = 0; u < n; u += 1) {
    for (let v = 0; v < n; v += 1) {
      if (u !== v) {
        edges.push({ from: u, to: v, weight });
      }
    }
  }
  const coords = Array.from({ length: n }, (_, i) => i);
  return packCsr(n, edges, coords, coords);
}

describe("paperDmsyParams / helpers", () => {
  it("returns k=1, t=1 for n=1 and recursion depth 0", () => {
    expect(paperDmsyParams(1)).toEqual({ k: 1, t: 1 });
    expect(dmsyRecursionDepth(1, 1)).toBe(0);
  });

  it("matches paper-notes §1.3 gallery table at delta=3", () => {
    const cases: Array<{
      n: number;
      t: number;
      k: number;
      lTop: number;
      mTop: number;
    }> = [
      { n: 500, t: 4, k: 2, lTop: 3, mTop: 1024 },
      { n: 5000, t: 4, k: 2, lTop: 4, mTop: 16384 },
      { n: 25000, t: 5, k: 3, lTop: 3, mTop: 5120 },
      { n: 100000, t: 5, k: 3, lTop: 4, mTop: 163840 },
    ];

    for (const { n, t, k, lTop, mTop } of cases) {
      const params = paperDmsyParams(n, 3);
      expect(params).toEqual({ k, t });
      expect(dmsyRecursionDepth(n, t)).toBe(lTop);
      expect(dmsyBlockSize(lTop, t)).toBe(mTop);
    }
  });

  it("returns block size 1 at level 0 and workload cap 8 at l=0, t=2", () => {
    expect(dmsyBlockSize(0, 4)).toBe(1);
    expect(dmsyWorkloadCap(0, 2)).toBe(8);
  });

  it("throws on invalid n", () => {
    expect(() => paperDmsyParams(0)).toThrow(/n must be an integer/);
    expect(() => paperDmsyParams(1.5)).toThrow(/n must be an integer/);
    expect(() => dmsyRecursionDepth(0, 1)).toThrow(/n must be an integer/);
    expect(() => dmsyBlockSize(-1, 1)).toThrow(/l must be a non-negative integer/);
    expect(() => dmsyWorkloadCap(0, 0)).toThrow(/t must be an integer/);
  });
});

describe("dmsy run", () => {
  it("on n=1 isolated vertex returns distance 0 with recurse in/out", () => {
    const graph = packCsr(1, [], [0], [0]);
    const { events, result } = drainDmsyRun(graph, 0);

    expectDistancesEqual(result.distances, new Float64Array([0]));
    expect(events.some((e) => e.k === "recurse" && e.dir === "in")).toBe(true);
    expect(events.some((e) => e.k === "recurse" && e.dir === "out")).toBe(true);
    expect(events.some((e) => e.k === "settle" && e.v !== 0)).toBe(false);
  });

  it("rejects invalid source", () => {
    const graph = packCsr(1, [], [0], [0]);

    expect(() => dmsyRun(graph, -1).next()).toThrow(/source must be an integer/);
    expect(() => dmsyRun(graph, 0.5).next()).toThrow(/source must be an integer/);
    expect(() => dmsyRun(graph, 1).next()).toThrow(/source must be an integer/);
  });
});

describe("dmsy 3-node chain", () => {
  const graph = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  it("computes distances [0, 1, 2] with audit and invariants", () => {
    const { events, result } = drainDmsyRun(graph, 0);

    expectDistancesEqual(result.distances, new Float64Array([0, 1, 2]));
    expectDistancesEqual(auditDmsyLengthsFromTrace(graph, events, 0), result.distances);
    expect(assertDmsyBoundedSettle(events, result.distances)).toEqual([]);
    expect(assertDmsyLexTieBreak(graph, 0)).toEqual([]);
    expect(assertDmsySettleFinality(graph, events, 0).messages).toEqual([]);
    expect(Array.from(result.predecessors)).toEqual([SENTINEL, 0, 1]);
  });

  it("public run predecessors match runInstrumented on identity graph", () => {
    const { result: publicResult } = drainDmsyRun(graph, 0);
    const { result: instrumentedResult } = drainDmsyInstrumented(graph, 0);
    expect(Array.from(publicResult.predecessors)).toEqual(
      Array.from(instrumentedResult.predecessors),
    );
  });
});

describe("dmsy paper-notes §2.4 diamond", () => {
  const graph = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 1, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  it("settles equal lengths with lex tie-break and predecessors [SENTINEL, 0, 0]", () => {
    const { events, result } = drainDmsyRun(graph, 0);

    expectDistancesEqual(result.distances, new Float64Array([0, 1, 1]));
    expect(Array.from(result.predecessors)).toEqual([SENTINEL, 0, 0]);
    expect(assertDmsyBoundedSettle(events, result.distances)).toEqual([]);
    expect(assertDmsySettleFinality(graph, events, 0).messages).toEqual([]);
    expect(assertDmsyLexTieBreak(graph, 0)).toEqual([]);

    const inst = drainDmsyInstrumented(graph, 0);
    expect(Array.from(result.predecessors)).toEqual(Array.from(inst.result.predecessors));
  });

  it("public run predecessors match runInstrumented on identity graph", () => {
    const { result: publicResult } = drainDmsyRun(graph, 0);
    const { result: instrumentedResult } = drainDmsyInstrumented(graph, 0);
    expect(Array.from(publicResult.predecessors)).toEqual(
      Array.from(instrumentedResult.predecessors),
    );
  });

  it("labels d[1] ≺ d[2] by curr under runInstrumented", () => {
    const gen = runInstrumented(graph, 0);
    let step = gen.next();
    while (!step.done) {
      step = gen.next();
    }
    const result = step.value;
    if (result === undefined) {
      throw new Error("runInstrumented finished without result");
    }

    const d1 = labelAt(result.dist, 1);
    const d2 = labelAt(result.dist, 2);
    expect(d1).toEqual({ length: 1, nEdges: 1, curr: 1, pred: 0 });
    expect(d2).toEqual({ length: 1, nEdges: 1, curr: 2, pred: 0 });
    expect(compareLabels(d1, d2)).toBe("<");
  });
});

describe("dmsy equal-weight diamond vs Dijkstra", () => {
  it("matches Dijkstra, BMSSP, and Bellman-Ford on an all-unit-weight diamond with ties", () => {
    const graph = packCsr(
      4,
      [
        { from: 0, to: 1, weight: 1 },
        { from: 0, to: 2, weight: 1 },
        { from: 1, to: 2, weight: 1 },
        { from: 1, to: 3, weight: 1 },
        { from: 2, to: 3, weight: 1 },
      ],
      [0, 1, 2, 3],
      [0, 0, 0, 0],
    );

    const { result: dmsyResult } = drainDmsyRun(graph, 0);
    const { result: dijkstraResult } = drainRun(graph, 0);
    const { result: bmsspResult } = drainBmsspRun(graph, 0);
    const bf = bellmanFord(graph, 0);

    expectDistancesEqual(dmsyResult.distances, dijkstraResult.distances);
    expectDistancesEqual(dmsyResult.distances, bmsspResult.distances);
    expectDistancesEqual(dmsyResult.distances, bf);
  });
});

describe("dmsy unreachable vertices", () => {
  it("leaves unreachable vertices at Infinity with SENTINEL predecessors", () => {
    const graph = packCsr(3, [{ from: 0, to: 1, weight: 1 }], [0, 1, 2], [0, 0, 0]);
    const { result } = drainDmsyRun(graph, 0);

    expect(result.distances[2]).toBe(Infinity);
    expect(result.predecessors[2]).toBe(SENTINEL);
  });
});

describe("dmsy identity vs reduced", () => {
  it("matches Dijkstra on sparse identity graphs", () => {
    const graph = generateGraph("sparse", 20, 1);
    expect(degreeReduce(graph).identity).toBe(true);

    const { result: dmsyResult } = drainDmsyRun(graph, 0);
    const { result: dijkstraResult } = drainRun(graph, 0);
    expectDistancesEqual(dmsyResult.distances, dijkstraResult.distances);
  });

  it("matches Dijkstra when degree reduction runs on a dense K4", () => {
    const graph = bidirectedComplete(4);
    expect(degreeReduce(graph).identity).toBe(false);

    const { result: dmsyResult } = drainDmsyRun(graph, 0);
    const { result: dijkstraResult } = drainRun(graph, 0);
    expectDistancesEqual(dmsyResult.distances, dijkstraResult.distances);
  });
});

describe("dmsy golden shape", () => {
  const chain = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  const diamond = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 1, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  function assertStructuralGolden(events: TraceEvent[]): void {
    const first = events[0];
    const last = events[events.length - 1];
    expect(first).toEqual({
      k: "recurse",
      dir: "in",
      level: expect.any(Number),
      bound: Infinity,
    });
    expect(last).toEqual({
      k: "recurse",
      dir: "out",
      level: expect.any(Number),
      bound: Infinity,
    });

    expect(events.some((e) => e.k === "settle" && e.v === 0)).toBe(true);

    const recurseIn = events.filter((e) => e.k === "recurse" && e.dir === "in");
    const recurseOut = events.filter((e) => e.k === "recurse" && e.dir === "out");
    expect(recurseIn.length).toBe(recurseOut.length);

    for (const event of events) {
      if (event.k === "dstruct" && event.op === "batchPrepend") {
        throw new Error("forbidden dstruct batchPrepend in trace");
      }
      if (event.k !== "dstruct") {
        continue;
      }
      expect(Number.isFinite(event.n)).toBe(true);
      expect(Number.isFinite(event.cmps)).toBe(true);
    }
  }

  it("emits well-formed recurse/settle/dstruct trace on a 0→1→2 chain", () => {
    const { events } = drainDmsyRun(chain, 0);
    assertStructuralGolden(events);
  });

  it("emits well-formed recurse/settle/dstruct trace on the §2.4 diamond", () => {
    const { events } = drainDmsyRun(diamond, 0);
    assertStructuralGolden(events);
  });
});

describe("dmsy n=1 golden", () => {
  const graph = packCsr(1, [], [0], [0]);

  const expectedEvents: TraceEvent[] = [
    { k: "recurse", dir: "in", level: 0, bound: Infinity },
    { k: "dstruct", op: "insert", n: 1, cmps: 3 },
    { k: "dstruct", op: "pull", n: 1, cmps: 0 },
    { k: "settle", v: 0, order: 0, cost: 1 },
    { k: "recurse", dir: "out", level: 0, bound: Infinity },
  ];

  it("emits the hand-verified trace on an isolated vertex", () => {
    const { events, result } = drainDmsyRun(graph, 0);

    expect(events).toEqual(expectedEvents);
    expectDistancesEqual(result.distances, new Float64Array([0]));
    expectDistancesEqual(auditDmsyLengthsFromTrace(graph, events, 0), result.distances);
  });
});

describe("dmsy TraceWriter round-trip", () => {
  const graph = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  it("round-trips chain events through TraceWriter and decodeChunk", () => {
    const { events } = drainDmsyRun(graph, 0);

    const writer = new TraceWriter();
    for (const event of events) {
      writer.append(event);
    }
    const chunks = writer.takeChunks();
    const decoded: TraceEvent[] = [];
    for (const chunk of chunks) {
      decoded.push(...decodeChunk(chunk));
    }

    expect(decoded).toEqual(events);

    for (const event of events) {
      if (event.k === "dstruct") {
        expect(costOf(event)).toBe(event.cmps * OP_COST.comparison);
      }
    }
  });
});

describe("dmsy no batchPrepend", () => {
  const chain = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  const diamond = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 1, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  it("never emits dstruct batchPrepend on chain or diamond", () => {
    for (const graph of [chain, diamond]) {
      const { events } = drainDmsyRun(graph, 0);
      expect(events.some((e) => e.k === "dstruct" && e.op === "batchPrepend")).toBe(false);
    }
  });
});

describe("dmsy determinism", () => {
  it("produces identical events on repeated drains of the same graph", () => {
    const graph = generateGraph("sparse", 12, 99);
    const run1 = drainDmsyRun(graph, 3);
    const run2 = drainDmsyRun(graph, 3);
    expect(run1.events).toEqual(run2.events);
  });
});
