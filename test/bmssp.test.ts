import { describe, expect, it } from "vitest";

import { run as bmsspRun } from "../src/core/bmssp/bmssp.ts";
import { bmsspParams } from "../src/core/bmssp/params.ts";
import { generateGraph, packCsr } from "../src/core/graph.ts";
import { costOf, decodeChunk, OP_COST, type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import {
  assertBoundedSettleInvariant,
  auditBmsspDistancesFromTrace,
  drainBmsspRun,
  hasPartialRecurseExit,
  heapEventsOutsideLevelZero,
  pullSizeViolations,
} from "./bmssp-helpers.ts";
import { drainRun } from "./dijkstra-helpers.ts";

/** Compare Float64Arrays including Infinity entries. */
function expectDistancesEqual(a: Float64Array, b: Float64Array): void {
  expect(Array.from(a)).toEqual(Array.from(b));
}

describe("bmssp run", () => {
  it("on n=1 isolated vertex returns distance 0 with recurse in/out", () => {
    const graph = packCsr(1, [], [0], [0]);
    const { events, result } = drainBmsspRun(graph, 0);

    expectDistancesEqual(result.distances, new Float64Array([0]));
    expect(events.some((e) => e.k === "recurse" && e.dir === "in")).toBe(true);
    expect(events.some((e) => e.k === "recurse" && e.dir === "out")).toBe(true);
  });

  it("rejects invalid source", () => {
    const graph = packCsr(1, [], [0], [0]);

    expect(() => bmsspRun(graph, -1).next()).toThrow(/source must be an integer/);
    expect(() => bmsspRun(graph, 0.5).next()).toThrow(/source must be an integer/);
    expect(() => bmsspRun(graph, 1).next()).toThrow(/source must be an integer/);
  });
});

describe("bmssp 3-node chain", () => {
  const graph = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  it("computes distances [0, 1, 2] with audit and bounded-settle invariant", () => {
    const { events, result } = drainBmsspRun(graph, 0);

    expectDistancesEqual(result.distances, new Float64Array([0, 1, 2]));
    expectDistancesEqual(auditBmsspDistancesFromTrace(graph, events, 0), result.distances);
    expect(assertBoundedSettleInvariant(events, result.distances)).toEqual([]);
  });
});

describe("bmssp equal-weight diamond vs Dijkstra", () => {
  it("matches Dijkstra distances on an all-unit-weight diamond with ties", () => {
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

    const { result: bmsspResult } = drainBmsspRun(graph, 0);
    const { result: dijkstraResult } = drainRun(graph, 0);

    expectDistancesEqual(bmsspResult.distances, dijkstraResult.distances);
  });
});

describe("bmssp golden shape", () => {
  const graph = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  it("emits well-formed recurse/settle/dstruct trace on a 0→1→2 chain", () => {
    const { events } = drainBmsspRun(graph, 0);

    const first = events[0];
    const last = events[events.length - 1];
    expect(first).toEqual({ k: "recurse", dir: "in", level: expect.any(Number), bound: Infinity });
    expect(last).toEqual({ k: "recurse", dir: "out", level: expect.any(Number), bound: Infinity });

    expect(events.some((e) => e.k === "settle" && e.v === 0)).toBe(true);

    const recurseIn = events.filter((e) => e.k === "recurse" && e.dir === "in");
    const recurseOut = events.filter((e) => e.k === "recurse" && e.dir === "out");
    expect(recurseIn.length).toBe(recurseOut.length);

    for (const event of events) {
      if (event.k !== "dstruct") {
        continue;
      }
      expect(Number.isFinite(event.n)).toBe(true);
      expect(Number.isFinite(event.cmps)).toBe(true);
    }
  });
});

describe("bmssp TraceWriter round-trip", () => {
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
    const { events } = drainBmsspRun(graph, 0);

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

describe("bmssp bounded-settle invariant", () => {
  it("holds on a small mixed-weight graph", () => {
    const graph = packCsr(
      5,
      [
        { from: 0, to: 1, weight: 3 },
        { from: 0, to: 2, weight: 1 },
        { from: 1, to: 3, weight: 2 },
        { from: 2, to: 3, weight: 4 },
        { from: 3, to: 4, weight: 1 },
      ],
      [0, 1, 2, 3, 4],
      [0, 0, 0, 0, 0],
    );

    const { events, result } = drainBmsspRun(graph, 0);
    expect(assertBoundedSettleInvariant(events, result.distances)).toEqual([]);
  });
});

/** Build a directed chain 0 → 1 → … → n-1 with unit weights. */
function packChain(n: number): ReturnType<typeof packCsr> {
  const arcs: { from: number; to: number; weight: number }[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    arcs.push({ from: i, to: i + 1, weight: 1 });
  }
  const layoutX = new Float64Array(n);
  const layoutY = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    layoutX[i] = i;
    layoutY[i] = 0;
  }
  return packCsr(n, arcs, layoutX, layoutY);
}

describe("bmssp Algorithm 3 structure", () => {
  const sparseGraph = generateGraph("sparse", 64, 7);
  const chain3 = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  it("emits heap events only inside level-0 base mini-Dijkstra", () => {
    for (const graph of [sparseGraph, chain3]) {
      const { events } = drainBmsspRun(graph, 0);
      expect(heapEventsOutsideLevelZero(events)).toEqual([]);
    }
  });

  it("keeps dstruct pull operand size n <= 2^{(l-1)t}", () => {
    const { events } = drainBmsspRun(sparseGraph, 0);
    const { t } = bmsspParams(sparseGraph.n);
    expect(pullSizeViolations(events, t)).toEqual([]);
  });

  it("has no post-loop Dijkstra sweep (heap only at l=0) and settles reachable vertices", () => {
    const { events, result } = drainBmsspRun(sparseGraph, 0);

    expect(heapEventsOutsideLevelZero(events)).toEqual([]);
    expect(events.filter((e) => e.k === "heap").length).toBeGreaterThan(0);

    const settleCount = events.filter((e) => e.k === "settle").length;
    expect(settleCount).toBeGreaterThan(0);

    const reachable = Array.from(result.distances).filter((d) => Number.isFinite(d)).length;
    expect(settleCount).toBeLessThanOrEqual(reachable);
    expect(reachable).toBeGreaterThan(1);
  });

  it("performs partial exit (recurse out bound < matching in bound) on a long chain", () => {
    const graphs = [packChain(80), packChain(200), generateGraph("maze", 80, 42)];

    let foundPartial = false;
    for (const graph of graphs) {
      const { events } = drainBmsspRun(graph, 0);
      if (!hasPartialRecurseExit(events)) {
        continue;
      }

      foundPartial = true;
      const { result: bmsspResult } = drainBmsspRun(graph, 0);
      const { result: dijkstraResult } = drainRun(graph, 0);
      expectDistancesEqual(bmsspResult.distances, dijkstraResult.distances);
      break;
    }

    expect(
      foundPartial,
      "expected at least one partial recurse exit (out.bound < in.bound) on chain n=80, n=200, or maze n=80",
    ).toBe(true);
  });

  it("implies singleton base-case sources via heap-only-at-l=0 and pull caps", () => {
    // baseMiniDijkstra rejects |S| > 1 but is not exported; heap events confined to
    // level 0 plus pull-size caps at l >= 1 together enforce Algorithm 3 structure.
    const { events } = drainBmsspRun(sparseGraph, 0);
    expect(heapEventsOutsideLevelZero(events)).toEqual([]);
    expect(pullSizeViolations(events, bmsspParams(sparseGraph.n).t)).toEqual([]);
    expect(() => drainBmsspRun(sparseGraph, 0)).not.toThrow();
  });
});

describe("bmssp tie-heavy generators", () => {
  it("matches Dijkstra on maze seed 37 (unit-weight corridor through a tied D layer)", () => {
    const graph = generateGraph("maze", 45, 37);
    const { result: bmsspResult } = drainBmsspRun(graph, 37);
    const { result: dijkstraResult } = drainRun(graph, 37);
    expectDistancesEqual(bmsspResult.distances, dijkstraResult.distances);
  });

  it("matches Dijkstra on clusters seed 110 (near-tie Euclidean weights)", () => {
    const graph = generateGraph("clusters", 38, 110);
    const { result: bmsspResult } = drainBmsspRun(graph, 34);
    const { result: dijkstraResult } = drainRun(graph, 34);
    expectDistancesEqual(bmsspResult.distances, dijkstraResult.distances);
  });
});
