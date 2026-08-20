import { describe, expect, it } from "vitest";

import { packCsr, type CsrEdge } from "../src/core/graph.ts";
import { resolveRaceFinishVertex } from "../src/ui/raceFinish.ts";

/** 3-node line 0 → 1 → 2 used by finish-vertex tests. */
function lineGraph3(): ReturnType<typeof packCsr> {
  const edges: CsrEdge[] = [
    { from: 0, to: 1, weight: 1 },
    { from: 1, to: 2, weight: 1 },
  ];
  return packCsr(3, edges, [0, 1, 3], [0, 0, 0]);
}

describe("resolveRaceFinishVertex", () => {
  it('target "none" disables photo-finish with no status', () => {
    const graph = lineGraph3();

    expect(resolveRaceFinishVertex(graph, 0, "none")).toEqual({
      finish: null,
      status: null,
    });
  });

  it("null target picks farthest reachable vertex with no status", () => {
    const graph = lineGraph3();

    expect(resolveRaceFinishVertex(graph, 0, null)).toEqual({
      finish: 2,
      status: null,
    });
  });

  it("target equal to source auto-picks with a source warning", () => {
    const graph = lineGraph3();

    const result = resolveRaceFinishVertex(graph, 0, 0);
    expect(result.finish).toBe(2);
    expect(result.status).toMatch(/source/);
  });

  it("out-of-range target auto-picks with an out-of-range warning", () => {
    const graph = lineGraph3();

    const result = resolveRaceFinishVertex(graph, 0, 3);
    expect(result.finish).toBe(2);
    expect(result.status).toMatch(/out of range/);
  });

  it("in-range reachable target uses that vertex with no status", () => {
    const graph = lineGraph3();

    expect(resolveRaceFinishVertex(graph, 0, 2)).toEqual({
      finish: 2,
      status: null,
    });
  });

  it("in-range unreachable target keeps explicit finish with unreachable warning", () => {
    const edges: CsrEdge[] = [{ from: 0, to: 1, weight: 1 }];
    const graph = packCsr(3, edges, [0, 1, 2], [0, 0, 0]);

    const result = resolveRaceFinishVertex(graph, 0, 2);
    expect(result.finish).toBe(2);
    expect(result.status).toMatch(/unreachable/);
  });
});
