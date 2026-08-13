import { describe, expect, it } from "vitest";

import { generateGraph, packCsr, pickFinishVertex, type CsrEdge } from "../src/core/graph.ts";

describe("pickFinishVertex", () => {
  it("picks the farthest reachable vertex on a 3-node line", () => {
    const edges: CsrEdge[] = [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ];
    const graph = packCsr(3, edges, [0, 1, 3], [0, 0, 0]);

    expect(pickFinishVertex(graph, 0)).toBe(2);
  });

  it("breaks ties toward the lowest vertex id at equal distance", () => {
    const edges: CsrEdge[] = [
      { from: 0, to: 1, weight: 1 },
      { from: 0, to: 2, weight: 1 },
    ];
    const graph = packCsr(3, edges, [0, 1, 0], [0, 0, 1]);

    expect(pickFinishVertex(graph, 0)).toBe(1);
  });

  it("ignores geometrically farther but unreachable vertices", () => {
    const edges: CsrEdge[] = [{ from: 0, to: 1, weight: 1 }];
    const graph = packCsr(3, edges, [0, 1, 100], [0, 0, 0]);

    expect(pickFinishVertex(graph, 0)).toBe(1);
  });

  it("returns a vertex other than source for a connected maze", () => {
    const graph = generateGraph("maze", 25, 42);
    const source = 0;
    const finish = pickFinishVertex(graph, source);

    expect(finish).not.toBe(source);
    expect(finish).toBeGreaterThanOrEqual(0);
    expect(finish).toBeLessThan(graph.n);
  });

  it("throws when only the source is reachable", () => {
    const graph = packCsr(2, [], [0, 10], [0, 0]);

    expect(() => pickFinishVertex(graph, 0)).toThrow(/no finish vertex/);
  });

  it("throws for n = 1", () => {
    const graph = packCsr(1, [], [0], [0]);

    expect(() => pickFinishVertex(graph, 0)).toThrow(/no finish vertex/);
  });

  it("throws for an out-of-range source", () => {
    const graph = packCsr(2, [{ from: 0, to: 1, weight: 1 }], [0, 1], [0, 0]);

    expect(() => pickFinishVertex(graph, -1)).toThrow(/source must be an integer/);
    expect(() => pickFinishVertex(graph, 2)).toThrow(/source must be an integer/);
  });
});
