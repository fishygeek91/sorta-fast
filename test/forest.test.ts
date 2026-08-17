import { describe, expect, it } from "vitest";

import {
  B_INFINITY,
  compareLabels,
  createDistanceStore,
  findPivotsForest,
  partitionTree,
  relax,
  type DistanceLabel,
  type DistanceStore,
  type PartitionGroup,
} from "../src/core/dmsy/forest.ts";
import { packCsr, type Graph, type VertexId } from "../src/core/graph.ts";
import {
  costOf,
  decodeChunk,
  OP_COST,
  SENTINEL,
  scanCosts,
  tally,
  type TraceEvent,
  TraceWriter,
} from "../src/core/trace.ts";
import { auditForestTrace, drainFindPivotsForest, makeLabels, setLabel } from "./forest-helpers.ts";

/** Read the four-tuple label at vertex `v` from a distance store. */
function readLabel(dist: DistanceStore, v: VertexId): DistanceLabel {
  const length = dist.length[v];
  const nEdges = dist.nEdges[v];
  const curr = dist.curr[v];
  const pred = dist.pred[v];
  if (length === undefined || nEdges === undefined || curr === undefined || pred === undefined) {
    throw new Error(`missing label at vertex ${v}`);
  }
  return { length, nEdges, curr, pred };
}

/** Drain {@link partitionTree} to completion, collecting cut events and groups. */
function drainPartitionTree(
  graph: Graph,
  vertices: readonly VertexId[],
  treeEdges: readonly number[],
  s: number,
  firstTreeId: number,
): { events: TraceEvent[]; groups: PartitionGroup[] } {
  const events: TraceEvent[] = [];
  const gen = partitionTree(graph, vertices, treeEdges, s, firstTreeId);
  let groups: PartitionGroup[] = [];

  for (;;) {
    const step = gen.next();
    if (step.done) {
      if (step.value === undefined) {
        throw new Error("partitionTree finished without returning a result");
      }
      groups = step.value.groups;
      break;
    }
    events.push(step.value);
  }

  return { events, groups };
}

/** Assert pairwise edge-disjointness across partition groups. */
function expectEdgeDisjointGroups(groups: readonly PartitionGroup[]): void {
  for (let i = 0; i < groups.length; i += 1) {
    const edgesI = new Set(groups[i]?.edges ?? []);
    for (let j = i + 1; j < groups.length; j += 1) {
      for (const e of groups[j]?.edges ?? []) {
        expect(edgesI.has(e)).toBe(false);
      }
    }
  }
}

describe("distance labels (paper-notes §2.4)", () => {
  it("createDistanceStore initializes non-sources to ⟨∞, 0, v, SENTINEL⟩", () => {
    const dist = createDistanceStore(3);

    expect(readLabel(dist, 0)).toEqual({
      length: Number.POSITIVE_INFINITY,
      nEdges: 0,
      curr: 0,
      pred: SENTINEL,
    });
    expect(readLabel(dist, 1)).toEqual({
      length: Number.POSITIVE_INFINITY,
      nEdges: 0,
      curr: 1,
      pred: SENTINEL,
    });
    expect(readLabel(dist, 2)).toEqual({
      length: Number.POSITIVE_INFINITY,
      nEdges: 0,
      curr: 2,
      pred: SENTINEL,
    });
  });

  it("makeLabels initializes source 0 to ⟨0, 0, 0, SENTINEL⟩", () => {
    const dist = makeLabels(3, [0]);

    expect(readLabel(dist, 0)).toEqual({
      length: 0,
      nEdges: 0,
      curr: 0,
      pred: SENTINEL,
    });
    expect(readLabel(dist, 1)).toEqual({
      length: Number.POSITIVE_INFINITY,
      nEdges: 0,
      curr: 1,
      pred: SENTINEL,
    });
    expect(readLabel(dist, 2)).toEqual({
      length: Number.POSITIVE_INFINITY,
      nEdges: 0,
      curr: 2,
      pred: SENTINEL,
    });
  });

  it("relax from source accepts equal-weight paths and rejects longer ones", () => {
    const dist = makeLabels(3, [0]);

    expect(relax(dist, 0, 1, 1, B_INFINITY)).toBe(true);
    expect(readLabel(dist, 1)).toEqual({
      length: 1,
      nEdges: 1,
      curr: 1,
      pred: 0,
    });

    expect(relax(dist, 0, 2, 1, B_INFINITY)).toBe(true);
    expect(readLabel(dist, 2)).toEqual({
      length: 1,
      nEdges: 1,
      curr: 2,
      pred: 0,
    });

    expect(compareLabels(readLabel(dist, 1), readLabel(dist, 2))).toBe("<");

    expect(relax(dist, 1, 2, 1, B_INFINITY)).toBe(false);
    expect(relax(dist, 2, 1, 1, B_INFINITY)).toBe(false);
  });

  it("compareLabels breaks pred ties on length, nEdges, and curr", () => {
    const a: DistanceLabel = { length: 1, nEdges: 2, curr: 2, pred: 0 };
    const b: DistanceLabel = { length: 1, nEdges: 2, curr: 2, pred: 1 };
    expect(compareLabels(a, b)).toBe("<");
  });

  it("setLabel writes all four fields", () => {
    const dist = createDistanceStore(3);
    const label: DistanceLabel = { length: 5, nEdges: 2, curr: 2, pred: 1 };
    setLabel(dist, 2, label);
    expect(readLabel(dist, 2)).toEqual(label);
  });
});

describe("findPivotsForest validation", () => {
  const tiny = packCsr(1, [], [0], [0]);
  const dist = makeLabels(1, [0]);

  it("rejects k=0, k=-1, and non-integer k", () => {
    expect(() => findPivotsForest(tiny, B_INFINITY, [0], 0, dist, 0).next()).toThrow(
      /k must be an integer/,
    );
    expect(() => findPivotsForest(tiny, B_INFINITY, [0], -1, dist, 0).next()).toThrow(
      /k must be an integer/,
    );
    expect(() => findPivotsForest(tiny, B_INFINITY, [0], 1.5, dist, 0).next()).toThrow(
      /k must be an integer/,
    );
  });

  it("rejects negative level", () => {
    expect(() => findPivotsForest(tiny, B_INFINITY, [0], 1, dist, -1).next()).toThrow(
      /level must be a non-negative integer/,
    );
  });

  it("rejects NaN and -Infinity B.length", () => {
    const nanB: DistanceLabel = {
      length: Number.NaN,
      nEdges: 0,
      curr: SENTINEL,
      pred: SENTINEL,
    };
    const negInfB: DistanceLabel = {
      length: Number.NEGATIVE_INFINITY,
      nEdges: 0,
      curr: SENTINEL,
      pred: SENTINEL,
    };
    expect(() => findPivotsForest(tiny, nanB, [0], 1, dist, 0).next()).toThrow(
      /B\.length must be finite or \+Infinity/,
    );
    expect(() => findPivotsForest(tiny, negInfB, [0], 1, dist, 0).next()).toThrow(
      /B\.length must be finite or \+Infinity/,
    );
  });

  it("rejects out-of-range sources", () => {
    expect(() => findPivotsForest(tiny, B_INFINITY, [-1], 1, dist, 0).next()).toThrow(
      /every source must be an integer/,
    );
    expect(() => findPivotsForest(tiny, B_INFINITY, [1], 1, dist, 0).next()).toThrow(
      /every source must be an integer/,
    );
  });
});

describe("partitionTree (Algorithm 5)", () => {
  const pathGraph = packCsr(
    6,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 3, weight: 1 },
      { from: 3, to: 4, weight: 1 },
      { from: 4, to: 5, weight: 1 },
    ],
    [0, 1, 2, 3, 4, 5],
    [0, 0, 0, 0, 0, 0],
  );

  it("partitions a 6-vertex path into edge-disjoint groups in [s, 3s)", () => {
    const vertices: VertexId[] = [0, 1, 2, 3, 4, 5];
    const treeEdges = [0, 1, 2, 3, 4];
    const s = 2;

    const { events, groups } = drainPartitionTree(pathGraph, vertices, treeEdges, s, 0);

    expectEdgeDisjointGroups(groups);

    for (const group of groups) {
      expect(group.vertices.length).toBeGreaterThanOrEqual(s);
      expect(group.vertices.length).toBeLessThan(3 * s);
    }

    const covered = new Set<VertexId>();
    for (const group of groups) {
      for (const v of group.vertices) {
        covered.add(v);
      }
    }
    expect(covered.size).toBe(6);

    for (const event of events) {
      if (event.k === "forest" && event.op === "cut") {
        expect(event.e).toBeGreaterThanOrEqual(0);
        expect(event.tree).toBeGreaterThanOrEqual(0);
        const inGroup = groups.some((g) => g.edges.includes(event.e));
        expect(inGroup).toBe(true);
      }
    }
  });

  it("returns a singleton group with no cut events on one vertex", () => {
    const singletonGraph = packCsr(1, [], [0], [0]);
    const { events, groups } = drainPartitionTree(singletonGraph, [0], [], 1, 0);

    expect(groups).toEqual([{ vertices: [0], edges: [] }]);
    expect(events).toEqual([]);
  });
});

describe("findPivotsForest golden chain k=2", () => {
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
    { k: "relax", e: 0, improved: true, cost: 1 },
    { k: "forest", op: "grow", e: 0, tree: 0 },
    { k: "heap", op: "push", cmps: 0 },
    { k: "forest", op: "cut", e: 0, tree: 0 },
    { k: "pivot", v: 0, level: 0 },
  ];

  it("emits heap, relax, forest, and pivot events in hand-verified order", () => {
    const dist = makeLabels(3, [0]);
    const { events } = drainFindPivotsForest(graph, B_INFINITY, [0], 2, dist, 0);

    expect(
      events.map((e) => {
        if (e.k === "heap") {
          return `heap:${e.op}`;
        }
        if (e.k === "forest") {
          return `forest:${e.op}`;
        }
        return e.k;
      }),
    ).toEqual([
      "heap:push",
      "heap:popmin",
      "relax",
      "forest:grow",
      "heap:push",
      "forest:cut",
      "pivot",
    ]);
  });

  it("emits the exact hand-verified trace on 0→1→2 with k=2", () => {
    const dist = makeLabels(3, [0]);
    const { events, result } = drainFindPivotsForest(graph, B_INFINITY, [0], 2, dist, 0);

    expect(events).toEqual(expectedEvents);
    expect(result).toEqual({
      groups: [[0]],
      P: [0],
      Q: [],
      W: [],
    });
    auditForestTrace(graph, events, result);
  });

  it("round-trips golden events through TraceWriter and bills costs correctly", () => {
    const billedWork = expectedEvents.reduce((sum, event) => sum + costOf(event), 0);
    const relaxCount = expectedEvents.filter((e) => e.k === "relax").length;

    for (const event of expectedEvents) {
      if (event.k === "pivot" || event.k === "forest") {
        expect(costOf(event)).toBe(0);
      }
      if (event.k === "relax") {
        expect(costOf(event)).toBe(OP_COST.relax);
      }
    }

    const writer = new TraceWriter();
    for (const event of expectedEvents) {
      writer.append(event);
    }
    const chunks = writer.takeChunks();
    expect(chunks.length).toBeGreaterThan(0);

    let work = 0;
    let relaxations = 0;
    let pivots = 0;
    for (const chunk of chunks) {
      const t = tally(chunk);
      work += t.work;
      relaxations += t.relaxations;
      pivots += t.pivots;
      expect(scanCosts(chunk)).toEqual(t);
    }

    expect(work).toBe(billedWork);
    expect(work).toBe(relaxCount * OP_COST.relax);
    expect(relaxations).toBe(1);
    expect(pivots).toBe(1);

    const decoded: TraceEvent[] = [];
    for (const chunk of chunks) {
      decoded.push(...decodeChunk(chunk));
    }
    expect(decoded).toEqual(expectedEvents);
  });
});

describe("findPivotsForest determinism", () => {
  const graph = packCsr(
    3,
    [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
    ],
    [0, 1, 2],
    [0, 0, 0],
  );

  it("produces identical events and results on repeated drains", () => {
    const dist1 = makeLabels(3, [0]);
    const dist2 = makeLabels(3, [0]);
    const run1 = drainFindPivotsForest(graph, B_INFINITY, [0], 2, dist1, 0);
    const run2 = drainFindPivotsForest(graph, B_INFINITY, [0], 2, dist2, 0);

    expect(run1.events).toEqual(run2.events);
    expect(run1.result).toEqual(run2.result);
  });
});

describe("findPivotsForest k=1 singleton", () => {
  it("returns F̄={0}, pivot 0, and empty Q and W on an isolated vertex", () => {
    const graph = packCsr(1, [], [0], [0]);
    const dist = makeLabels(1, [0]);
    const { events, result } = drainFindPivotsForest(graph, B_INFINITY, [0], 1, dist, 0);

    expect(result).toEqual({
      groups: [[0]],
      P: [0],
      Q: [],
      W: [],
    });
    expect(events.some((e) => e.k === "forest" && e.op === "grow")).toBe(false);
    expect(events.some((e) => e.k === "forest" && e.op === "cut")).toBe(false);
    expect(events.filter((e) => e.k === "pivot")).toEqual([{ k: "pivot", v: 0, level: 0 }]);
    auditForestTrace(graph, events, result);
  });
});

describe("findPivotsForest infinity source skipped", () => {
  it("emits no events when the sole source still has length Infinity", () => {
    const graph = packCsr(2, [{ from: 0, to: 1, weight: 1 }], [0, 1], [0, 0]);
    const dist = makeLabels(2, []);
    const { events, result } = drainFindPivotsForest(graph, B_INFINITY, [1], 2, dist, 0);

    expect(events).toEqual([]);
    expect(result).toEqual({
      groups: [],
      P: [],
      Q: [],
      W: [],
    });
  });
});

describe("findPivotsForest duplicate sources", () => {
  it("deduplicates repeated sources like a single S=[0]", () => {
    const graph = packCsr(
      3,
      [
        { from: 0, to: 1, weight: 1 },
        { from: 1, to: 2, weight: 1 },
      ],
      [0, 1, 2],
      [0, 0, 0],
    );
    const distSingle = makeLabels(3, [0]);
    const distDup = makeLabels(3, [0]);

    const single = drainFindPivotsForest(graph, B_INFINITY, [0], 2, distSingle, 0);
    const dup = drainFindPivotsForest(graph, B_INFINITY, [0, 0, 0], 2, distDup, 0);

    expect(dup.result).toEqual(single.result);
    expect(dup.events).toEqual(single.events);
  });
});
