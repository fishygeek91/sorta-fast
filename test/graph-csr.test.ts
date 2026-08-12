import { describe, expect, it } from "vitest";

import { packCsr, type CsrEdge } from "../src/core/graph.ts";

describe("packCsr", () => {
  it("builds typed-array CSR with coordinates", () => {
    const edges: CsrEdge[] = [
      { from: 0, to: 1, weight: 2.5 },
      { from: 1, to: 2, weight: 0 },
    ];
    const graph = packCsr(3, edges, [0, 1, 2], [3, 4, 5]);

    expect(graph.n).toBe(3);
    expect(graph.m).toBe(2);
    expect(graph.offsets).toBeInstanceOf(Uint32Array);
    expect(graph.targets).toBeInstanceOf(Uint32Array);
    expect(graph.weights).toBeInstanceOf(Float64Array);
    expect(graph.x).toBeInstanceOf(Float64Array);
    expect(graph.y).toBeInstanceOf(Float64Array);
    expect(Array.from(graph.offsets)).toEqual([0, 1, 2, 2]);
    expect(Array.from(graph.targets)).toEqual([1, 2]);
    expect(Array.from(graph.weights)).toEqual([2.5, 0]);
    expect(Array.from(graph.x)).toEqual([0, 1, 2]);
    expect(Array.from(graph.y)).toEqual([3, 4, 5]);
  });

  it("sorts neighbors by target id and keeps offsets nondecreasing", () => {
    const edges: CsrEdge[] = [
      { from: 0, to: 2, weight: 1 },
      { from: 0, to: 1, weight: 3 },
      { from: 2, to: 0, weight: 4 },
    ];
    const graph = packCsr(3, edges, [0, 0, 0], [0, 0, 0]);

    expect(Array.from(graph.offsets)).toEqual([0, 2, 2, 3]);
    expect(Array.from(graph.targets)).toEqual([1, 2, 0]);
    expect(Array.from(graph.weights)).toEqual([3, 1, 4]);
    for (let v = 0; v < graph.n; v += 1) {
      const start = graph.offsets[v];
      const end = graph.offsets[v + 1];
      if (start === undefined || end === undefined) {
        throw new Error("missing offset");
      }
      expect(start).toBeLessThanOrEqual(end);
    }
    expect(graph.offsets[graph.n]).toBe(graph.m);
  });

  it("copies coordinates so the caller cannot mutate the graph", () => {
    const x = [1, 2];
    const y = [3, 4];
    const graph = packCsr(2, [{ from: 0, to: 1, weight: 1 }], x, y);
    x[0] = 99;
    y[0] = 99;
    expect(graph.x[0]).toBe(1);
    expect(graph.y[0]).toBe(3);
  });

  it("rejects self-loops", () => {
    expect(() => packCsr(1, [{ from: 0, to: 0, weight: 1 }], [0], [0])).toThrow(/self-loop/);
  });

  it("rejects duplicate parallel arcs", () => {
    expect(() =>
      packCsr(
        2,
        [
          { from: 0, to: 1, weight: 1 },
          { from: 0, to: 1, weight: 2 },
        ],
        [0, 1],
        [0, 1],
      ),
    ).toThrow(/duplicate arc/);
  });

  it("rejects negative weights", () => {
    expect(() => packCsr(2, [{ from: 0, to: 1, weight: -0.1 }], [0, 1], [0, 1])).toThrow(
      /weight must be finite/,
    );
  });

  it("rejects out-of-range endpoints", () => {
    expect(() => packCsr(2, [{ from: 0, to: 2, weight: 1 }], [0, 1], [0, 1])).toThrow(
      /out of range/,
    );
  });

  it("rejects coordinate length mismatches", () => {
    expect(() => packCsr(2, [], [0], [0, 1])).toThrow(/coordinate arrays/);
  });
});
