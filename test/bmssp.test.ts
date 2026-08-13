import { describe, expect, it } from "vitest";

import { run as bmsspRun } from "../src/core/bmssp/bmssp.ts";
import { packCsr } from "../src/core/graph.ts";
import { costOf, decodeChunk, OP_COST, type TraceEvent, TraceWriter } from "../src/core/trace.ts";
import {
  assertBoundedSettleInvariant,
  auditBmsspDistancesFromTrace,
  drainBmsspRun,
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
