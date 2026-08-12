import { describe, expect, it } from "vitest";

import { bellmanFord } from "../src/core/bellmanFord.ts";
import { run } from "../src/core/dijkstra.ts";
import { packCsr } from "../src/core/graph.ts";
import { decodeChunk, SENTINEL, type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import { auditDistancesFromTrace, drainRun } from "./dijkstra-helpers.ts";

/** Compare Float64Arrays including Infinity entries. */
function expectDistancesEqual(a: Float64Array, b: Float64Array): void {
  expect(Array.from(a)).toEqual(Array.from(b));
}

describe("dijkstra run", () => {
  const singleVertex = packCsr(1, [], [0], [0]);

  it("rejects source -1", () => {
    expect(() => run(singleVertex, -1).next()).toThrow(/source must be an integer/);
  });

  it("rejects non-integer source 0.5", () => {
    expect(() => run(singleVertex, 0.5).next()).toThrow(/source must be an integer/);
  });

  it("rejects source equal to n", () => {
    expect(() => run(singleVertex, 1).next()).toThrow(/source must be an integer/);
  });

  it("on an edgeless n=3 graph settles only the source with no relax events", () => {
    const graph = packCsr(3, [], [0, 0, 0], [0, 0, 0]);
    const { events, result } = drainRun(graph, 0);

    expectDistancesEqual(result.distances, new Float64Array([0, Infinity, Infinity]));
    expect(Array.from(result.predecessors)).toEqual([SENTINEL, SENTINEL, SENTINEL]);
    expect(events).toEqual([
      { k: "heap", op: "push", cmps: 0 },
      { k: "heap", op: "popmin", cmps: 0 },
      { k: "settle", v: 0, order: 0, cost: 1 },
    ]);
    expect(events.some((e) => e.k === "relax")).toBe(false);
  });

  it("leaves unreachable vertices at Infinity with SENTINEL predecessors", () => {
    const graph = packCsr(3, [{ from: 0, to: 1, weight: 1 }], [0, 1, 2], [0, 0, 0]);
    const { result } = drainRun(graph, 0);

    expect(result.distances[2]).toBe(Infinity);
    expect(result.predecessors[2]).toBe(SENTINEL);
  });

  it("accepts zero-weight edges", () => {
    const graph = packCsr(2, [{ from: 0, to: 1, weight: 0 }], [0, 1], [0, 0]);
    const { result } = drainRun(graph, 0);

    expectDistancesEqual(result.distances, new Float64Array([0, 0]));
    expect(result.predecessors[1]).toBe(0);
  });
});

describe("dijkstra settle-order invariant", () => {
  it("settles vertices in nondecreasing distance order on a mixed-weight graph", () => {
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
    const { events, result } = drainRun(graph, 0);

    let previousDist = -Infinity;
    for (const event of events) {
      if (event.k !== "settle") {
        continue;
      }
      const v = event.v;
      const distV = result.distances[v];
      if (distV === undefined) {
        throw new Error(`distances[${v}] missing`);
      }
      expect(previousDist).toBeLessThanOrEqual(distV);
      previousDist = distV;
    }
  });
});

describe("dijkstra golden path", () => {
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
    { k: "heap", op: "push", cmps: 0 },
    { k: "heap", op: "popmin", cmps: 0 },
    { k: "settle", v: 0, order: 0, cost: 1 },
    { k: "relax", e: 0, improved: true, cost: 1 },
    { k: "heap", op: "push", cmps: 0 },
    { k: "heap", op: "popmin", cmps: 0 },
    { k: "settle", v: 1, order: 1, cost: 1 },
    { k: "relax", e: 1, improved: true, cost: 1 },
    { k: "heap", op: "push", cmps: 0 },
    { k: "heap", op: "popmin", cmps: 0 },
    { k: "settle", v: 2, order: 2, cost: 1 },
  ];

  it("emits the hand-verified trace on a 0→1→2 chain", () => {
    const { events, result } = drainRun(graph, 0);

    expect(events).toEqual(expectedEvents);
    expectDistancesEqual(result.distances, new Float64Array([0, 1, 2]));
    expect(Array.from(result.predecessors)).toEqual([SENTINEL, 0, 1]);
    expectDistancesEqual(auditDistancesFromTrace(graph, events, 0), result.distances);
  });
});

describe("dijkstra golden diamond with stale pop", () => {
  const graph = packCsr(
    4,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 4 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 1, weight: 1 },
      { from: 2, to: 3, weight: 1 },
    ],
    [0, 1, 2, 3],
    [0, 0, 0, 0],
  );

  const expectedEvents: TraceEvent[] = [
    { k: "heap", op: "push", cmps: 0 },
    { k: "heap", op: "popmin", cmps: 0 },
    { k: "settle", v: 0, order: 0, cost: 1 },
    { k: "relax", e: 0, improved: true, cost: 1 },
    { k: "heap", op: "push", cmps: 0 },
    { k: "relax", e: 1, improved: true, cost: 1 },
    { k: "heap", op: "push", cmps: 1 },
    { k: "heap", op: "popmin", cmps: 0 },
    { k: "settle", v: 1, order: 1, cost: 1 },
    { k: "relax", e: 2, improved: true, cost: 1 },
    { k: "heap", op: "push", cmps: 1 },
    { k: "heap", op: "popmin", cmps: 0 },
    { k: "settle", v: 2, order: 2, cost: 1 },
    { k: "relax", e: 3, improved: false, cost: 1 },
    { k: "relax", e: 4, improved: true, cost: 1 },
    { k: "heap", op: "push", cmps: 1 },
    { k: "heap", op: "popmin", cmps: 0 },
    { k: "settle", v: 3, order: 3, cost: 1 },
    { k: "heap", op: "popmin", cmps: 0 },
  ];

  it("emits stale popmin and non-improving relax on the hand-verified diamond", () => {
    const { events, result } = drainRun(graph, 0);

    expect(events).toEqual(expectedEvents);
    expectDistancesEqual(result.distances, new Float64Array([0, 1, 2, 3]));
    expect(Array.from(result.predecessors)).toEqual([SENTINEL, 0, 1, 2]);
    expectDistancesEqual(auditDistancesFromTrace(graph, events, 0), result.distances);

    // Last popmin is the stale 2@4 heap snapshot; relax e=3 is the non-improving 2→1 edge.
    const last = events[events.length - 1];
    expect(last).toEqual({ k: "heap", op: "popmin", cmps: 0 });
    const nonImproving = events.find((e) => e.k === "relax" && e.e === 3);
    expect(nonImproving).toEqual({ k: "relax", e: 3, improved: false, cost: 1 });
  });
});

describe("dijkstra equal-weight diamond vs Bellman-Ford", () => {
  it("matches Bellman-Ford distances on an all-unit-weight diamond with ties", () => {
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

    const { result } = drainRun(graph, 0);
    const bf = bellmanFord(graph, 0);
    expectDistancesEqual(result.distances, bf);
  });
});

describe("dijkstra TraceWriter round-trip", () => {
  it("round-trips golden path events through TraceWriter and decodeChunk", () => {
    const graph = packCsr(
      3,
      [
        { from: 0, to: 1, weight: 1 },
        { from: 1, to: 2, weight: 1 },
      ],
      [0, 1, 2],
      [0, 0, 0],
    );
    const { events } = drainRun(graph, 0);

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
  });
});
