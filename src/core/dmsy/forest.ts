/**
 * DMSY spanning-forest FindPivots and tree partition — arXiv 2602.07868 (issue #24).
 *
 * Algorithm 2 local Dijkstra builds directed trees F̄_j and arborescences W_j;
 * Algorithm 5 partitions each F̄_j into edge-disjoint subtrees F_j of size [k, 3k).
 */

import { type EdgeId, type Graph, type VertexId } from "../graph.ts";
import { SENTINEL, type TraceEvent } from "../trace.ts";

/** Initial capacity for the label heap before doubling growth. */
const INITIAL_HEAP_CAPACITY = 16;

/**
 * Four-tuple distance label ⟨length, nEdges, curr, pred⟩ (paper §2.2).
 */
export type DistanceLabel = {
  length: number;
  nEdges: number;
  curr: VertexId;
  pred: VertexId;
};

/**
 * Structure-of-arrays store for per-vertex distance labels.
 */
export type DistanceStore = {
  length: Float64Array;
  nEdges: Int32Array;
  curr: Int32Array;
  pred: Int32Array;
};

/**
 * Result of {@link findPivotsForest}: pivot groups, pivots, W roots, and W vertices.
 */
export type ForestFindPivotsResult = {
  /** Nonempty P_j sets in min-j order. */
  groups: VertexId[][];
  /** Pivot p_j aligned with {@link groups}. */
  P: VertexId[];
  /** Roots of W_j arborescences, ascending id. */
  Q: VertexId[];
  /** Union of W_j vertices, ascending id. */
  W: VertexId[];
};

/**
 * Top-level distance bound B_∞ (paper §2.3, DMSY-P15).
 */
export const B_INFINITY: DistanceLabel = {
  length: Number.POSITIVE_INFINITY,
  nEdges: 0,
  curr: SENTINEL,
  pred: SENTINEL,
};

/**
 * Partition output group: vertices and internal tree edges (Algorithm 5).
 */
export type PartitionGroup = {
  vertices: VertexId[];
  edges: EdgeId[];
};

type SubtreeAccum = {
  vertices: VertexId[];
  edges: EdgeId[];
};

type ReportEntry = {
  group: PartitionGroup;
  treeId: number;
};

type PopMinResult = {
  v: VertexId;
  cmps: number;
  snapshot: DistanceLabel;
};

/**
 * Binary min-heap keyed by 4-tuple labels via {@link compareLabels} (DMSY-P07).
 *
 * Lazy deletion: each push stores a label snapshot; no decrease-key.
 */
class LabelHeap {
  private vertices: Int32Array;
  private lengths: Float64Array;
  private nEdges: Int32Array;
  private currs: Int32Array;
  private preds: Int32Array;
  private capacity: number;
  size: number;

  constructor() {
    this.capacity = INITIAL_HEAP_CAPACITY;
    this.vertices = new Int32Array(this.capacity);
    this.lengths = new Float64Array(this.capacity);
    this.nEdges = new Int32Array(this.capacity);
    this.currs = new Int32Array(this.capacity);
    this.preds = new Int32Array(this.capacity);
    this.size = 0;
  }

  private grow(): void {
    const newCapacity = this.capacity * 2;
    const newVertices = new Int32Array(newCapacity);
    const newLengths = new Float64Array(newCapacity);
    const newNEdges = new Int32Array(newCapacity);
    const newCurrs = new Int32Array(newCapacity);
    const newPreds = new Int32Array(newCapacity);
    newVertices.set(this.vertices.subarray(0, this.size));
    newLengths.set(this.lengths.subarray(0, this.size));
    newNEdges.set(this.nEdges.subarray(0, this.size));
    newCurrs.set(this.currs.subarray(0, this.size));
    newPreds.set(this.preds.subarray(0, this.size));
    this.vertices = newVertices;
    this.lengths = newLengths;
    this.nEdges = newNEdges;
    this.currs = newCurrs;
    this.preds = newPreds;
    this.capacity = newCapacity;
  }

  private labelAt(i: number): DistanceLabel {
    const length = this.lengths[i];
    const nEdges = this.nEdges[i];
    const curr = this.currs[i];
    const pred = this.preds[i];
    if (length === undefined || nEdges === undefined || curr === undefined || pred === undefined) {
      throw new Error(`LabelHeap: missing slot at index ${i}`);
    }
    return { length, nEdges, curr, pred };
  }

  private swap(i: number, j: number): void {
    const vi = this.vertices[i];
    const li = this.lengths[i];
    const nei = this.nEdges[i];
    const ci = this.currs[i];
    const pi = this.preds[i];
    const vj = this.vertices[j];
    const lj = this.lengths[j];
    const nej = this.nEdges[j];
    const cj = this.currs[j];
    const pj = this.preds[j];
    if (
      vi === undefined ||
      li === undefined ||
      nei === undefined ||
      ci === undefined ||
      pi === undefined ||
      vj === undefined ||
      lj === undefined ||
      nej === undefined ||
      cj === undefined ||
      pj === undefined
    ) {
      throw new Error(`LabelHeap swap: missing slot at ${i} or ${j}`);
    }
    this.vertices[i] = vj;
    this.lengths[i] = lj;
    this.nEdges[i] = nej;
    this.currs[i] = cj;
    this.preds[i] = pj;
    this.vertices[j] = vi;
    this.lengths[j] = li;
    this.nEdges[j] = nei;
    this.currs[j] = ci;
    this.preds[j] = pi;
  }

  private siftUp(i: number): number {
    let cmps = 0;
    let cur = i;
    while (cur > 0) {
      const p = (cur - 1) >> 1;
      const labelCur = this.labelAt(cur);
      const labelP = this.labelAt(p);
      cmps += 1;
      if (compareLabels(labelCur, labelP) !== "<") {
        break;
      }
      this.swap(cur, p);
      cur = p;
    }
    return cmps;
  }

  private siftDown(i: number): number {
    let cmps = 0;
    let cur = i;
    for (;;) {
      const l = 2 * cur + 1;
      const r = 2 * cur + 2;
      let smallest = cur;

      if (l < this.size) {
        const labelL = this.labelAt(l);
        const labelSmallest = this.labelAt(smallest);
        cmps += 1;
        if (compareLabels(labelL, labelSmallest) === "<") {
          smallest = l;
        }
      }

      if (r < this.size) {
        const labelR = this.labelAt(r);
        const labelSmallest = this.labelAt(smallest);
        cmps += 1;
        if (compareLabels(labelR, labelSmallest) === "<") {
          smallest = r;
        }
      }

      if (smallest === cur) {
        break;
      }
      this.swap(cur, smallest);
      cur = smallest;
    }
    return cmps;
  }

  push(v: VertexId, label: DistanceLabel): number {
    if (this.size === this.capacity) {
      this.grow();
    }
    const idx = this.size;
    this.vertices[idx] = v;
    this.lengths[idx] = label.length;
    this.nEdges[idx] = label.nEdges;
    this.currs[idx] = label.curr;
    this.preds[idx] = label.pred;
    this.size += 1;
    return this.siftUp(idx);
  }

  popmin(): PopMinResult {
    if (this.size === 0) {
      throw new Error("LabelHeap popmin: empty heap");
    }

    const v = this.vertices[0];
    const snapshot = this.labelAt(0);
    if (v === undefined) {
      throw new Error("LabelHeap popmin: missing root vertex");
    }

    if (this.size === 1) {
      this.size = 0;
      return { v, cmps: 0, snapshot };
    }

    const last = this.size - 1;
    const lastV = this.vertices[last];
    const lastLength = this.lengths[last];
    const lastNEdges = this.nEdges[last];
    const lastCurr = this.currs[last];
    const lastPred = this.preds[last];
    if (
      lastV === undefined ||
      lastLength === undefined ||
      lastNEdges === undefined ||
      lastCurr === undefined ||
      lastPred === undefined
    ) {
      throw new Error(`LabelHeap popmin: missing last slot at ${last}`);
    }
    this.vertices[0] = lastV;
    this.lengths[0] = lastLength;
    this.nEdges[0] = lastNEdges;
    this.currs[0] = lastCurr;
    this.preds[0] = lastPred;
    this.size = last;
    const cmps = this.siftDown(0);
    return { v, cmps, snapshot };
  }
}

/**
 * Allocate a distance store with unreachable labels ⟨Infinity, 0, v, SENTINEL⟩.
 *
 * @param n - Vertex count; must be a non-negative integer.
 */
export function createDistanceStore(n: number): DistanceStore {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`n must be a non-negative integer, got ${String(n)}`);
  }
  const length = new Float64Array(n);
  length.fill(Number.POSITIVE_INFINITY);
  const nEdges = new Int32Array(n);
  nEdges.fill(0);
  const curr = new Int32Array(n);
  const pred = new Int32Array(n);
  pred.fill(SENTINEL);
  for (let v = 0; v < n; v += 1) {
    curr[v] = v;
  }
  return { length, nEdges, curr, pred };
}

/**
 * Lexicographic Comparison on ⟨length, nEdges, curr, pred⟩ (paper §2.2).
 */
export function compareLabels(a: DistanceLabel, b: DistanceLabel): "<" | "=" | ">" {
  if (a.length < b.length) {
    return "<";
  }
  if (a.length > b.length) {
    return ">";
  }
  if (a.nEdges < b.nEdges) {
    return "<";
  }
  if (a.nEdges > b.nEdges) {
    return ">";
  }
  if (a.curr < b.curr) {
    return "<";
  }
  if (a.curr > b.curr) {
    return ">";
  }
  if (a.pred < b.pred) {
    return "<";
  }
  if (a.pred > b.pred) {
    return ">";
  }
  return "=";
}

/**
 * Addition along edge (u, v) with weight w: ⟨length+w, nEdges+1, head, tail⟩ (§2.2).
 *
 * @param label - Label at tail u (`label.curr` is u).
 * @param weight - Edge weight w.
 * @param head - Head vertex v.
 */
export function addWeight(label: DistanceLabel, weight: number, head: VertexId): DistanceLabel {
  return {
    length: label.length + weight,
    nEdges: label.nEdges + 1,
    curr: head,
    pred: label.curr,
  };
}

/**
 * Read the ⟨length, nEdges, curr, pred⟩ 4-tuple at vertex `v` from a {@link DistanceStore}.
 *
 * @param dist - Per-vertex distance store.
 * @param v - Vertex id.
 */
export function labelAt(dist: DistanceStore, v: VertexId): DistanceLabel {
  const length = dist.length[v];
  const nEdges = dist.nEdges[v];
  const curr = dist.curr[v];
  const pred = dist.pred[v];
  if (length === undefined || nEdges === undefined || curr === undefined || pred === undefined) {
    throw new Error(`dist label at vertex ${v} missing`);
  }
  return { length, nEdges, curr, pred };
}

/**
 * Write a label into the distance store at vertex `v`.
 */
function writeLabel(dist: DistanceStore, v: VertexId, label: DistanceLabel): void {
  dist.length[v] = label.length;
  dist.nEdges[v] = label.nEdges;
  dist.curr[v] = label.curr;
  dist.pred[v] = label.pred;
}

/**
 * Whether a heap snapshot label still matches the live store entry.
 */
function labelMatchesStore(dist: DistanceStore, v: VertexId, snapshot: DistanceLabel): boolean {
  const live = labelAt(dist, v);
  return (
    live.length === snapshot.length &&
    live.nEdges === snapshot.nEdges &&
    live.curr === snapshot.curr &&
    live.pred === snapshot.pred
  );
}

/**
 * Relax(u, v, B) — arXiv 2602.07868 Algorithm 1.
 *
 * Does not emit trace events; the caller emits `relax` when appropriate.
 *
 * @returns Whether the candidate label was accepted into `dist[v]`.
 */
export function relax(
  dist: DistanceStore,
  u: VertexId,
  v: VertexId,
  weight: number,
  B: DistanceLabel,
): boolean {
  const labelU = labelAt(dist, u);
  const candidate = addWeight(labelU, weight, v);
  const labelV = labelAt(dist, v);
  const vsCandidate = compareLabels(candidate, labelV);
  if (vsCandidate !== "<" && vsCandidate !== "=") {
    return false;
  }
  if (compareLabels(candidate, B) !== "<") {
    return false;
  }
  writeLabel(dist, v, candidate);
  return true;
}

/**
 * Sort a copy of vertex ids in ascending order.
 */
function sortedCopy(members: readonly VertexId[]): VertexId[] {
  const copy = [...members];
  copy.sort((a, b) => a - b);
  return copy;
}

/**
 * Sort a copy of edge ids in ascending order.
 */
function sortedEdgeCopy(edges: readonly EdgeId[]): EdgeId[] {
  const copy = [...edges];
  copy.sort((a, b) => a - b);
  return copy;
}

/**
 * Deduplicate sources preserving first occurrence, then sort ascending (DMSY-P08).
 */
function dedupeSourcesAscending(S: readonly VertexId[], n: number): VertexId[] {
  const seen = new Uint8Array(n);
  const sources: VertexId[] = [];
  for (const s of S) {
    if (seen[s] === 0) {
      seen[s] = 1;
      sources.push(s);
    }
  }
  sources.sort((a, b) => a - b);
  return sources;
}

/**
 * Find the CSR source vertex for a directed arc index via binary search on offsets.
 */
function edgeSource(graph: Graph, e: EdgeId): VertexId {
  const { offsets, n } = graph;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const start = offsets[mid];
    if (start === undefined) {
      throw new Error(`offsets for vertex ${mid} missing`);
    }
    if (start <= e) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const u = lo - 1;
  const start = offsets[u];
  const end = offsets[u + 1];
  if (u < 0 || start === undefined || end === undefined || e < start || e >= end) {
    throw new Error(`edge ${e} not found in graph CSR`);
  }
  return u;
}

/**
 * Partition a directed tree into edge-disjoint subtrees — arXiv 2602.07868 Algorithm 5.
 *
 * Treats `treeEdges` as undirected. Emits `forest` `cut` events for each reported group.
 * Yields cut events; returns partition groups and the next available cut tree id.
 *
 * @param graph - CSR graph (for arc endpoints).
 * @param vertices - Vertices of the tree T (a F̄_j).
 * @param treeEdges - Directed tree arcs belonging to T.
 * @param s - Target subtree size (k in FindPivots).
 * @param firstTreeId - First `cut.tree` id for this partition run.
 */
export function* partitionTree(
  graph: Graph,
  vertices: readonly VertexId[],
  treeEdges: readonly EdgeId[],
  s: number,
  firstTreeId: number,
): Generator<TraceEvent, { groups: PartitionGroup[]; nextTreeId: number }, undefined> {
  if (!Number.isInteger(s) || s < 1) {
    throw new Error(`s must be an integer >= 1, got ${String(s)}`);
  }
  if (!Number.isInteger(firstTreeId) || firstTreeId < 0) {
    throw new Error(`firstTreeId must be a non-negative integer, got ${String(firstTreeId)}`);
  }

  if (vertices.length === 0) {
    return { groups: [], nextTreeId: firstTreeId };
  }

  for (const v of vertices) {
    if (!Number.isInteger(v) || v < 0 || v >= graph.n) {
      throw new Error(`vertex ${String(v)} out of range [0, ${graph.n})`);
    }
  }

  for (const e of treeEdges) {
    if (!Number.isInteger(e) || e < 0 || e >= graph.m) {
      throw new Error(`edge ${String(e)} out of range [0, ${graph.m})`);
    }
  }

  type AdjEntry = { neighbor: VertexId; edge: EdgeId };
  type PartitionFrame = {
    node: VertexId;
    parent: VertexId;
    incomingEdge: EdgeId;
    childIdx: number;
    children: AdjEntry[];
    accumVertices: VertexId[];
    accumEdges: EdgeId[];
  };

  const treeSize = vertices.length;
  const localIndex = new Map<VertexId, number>();
  for (let i = 0; i < treeSize; i += 1) {
    localIndex.set(vertices[i], i);
  }

  const adj: AdjEntry[][] = Array.from({ length: treeSize }, () => []);
  const { targets } = graph;

  const localOf = (v: VertexId): number => {
    const idx = localIndex.get(v);
    if (idx === undefined) {
      throw new Error(`vertex ${v} is not in the partition tree`);
    }
    return idx;
  };

  for (const e of treeEdges) {
    const u = edgeSource(graph, e);
    const v = targets[e];
    if (v === undefined) {
      throw new Error(`CSR arc ${e} missing target`);
    }
    if (!localIndex.has(u) || !localIndex.has(v)) {
      throw new Error(`tree edge ${e} connects vertex outside tree`);
    }
    adj[localOf(u)].push({ neighbor: v, edge: e });
    adj[localOf(v)].push({ neighbor: u, edge: e });
  }

  for (let i = 0; i < treeSize; i += 1) {
    const entries = adj[i];
    if (entries.length > 0) {
      entries.sort((a, b) => a.neighbor - b.neighbor);
    }
  }

  let root = vertices[0];
  for (const v of vertices) {
    if (v < root) {
      root = v;
    }
  }

  const childrenOf = (node: VertexId, parent: VertexId): AdjEntry[] => {
    const neighbors = adj[localOf(node)];
    const children: AdjEntry[] = [];
    for (const entry of neighbors) {
      if (entry.neighbor !== parent) {
        children.push(entry);
      }
    }
    return children;
  };

  const reports: ReportEntry[] = [];
  const cutEmitted = new Set<EdgeId>();
  let nextReportTreeId = firstTreeId;

  const emitCuts = function* (edges: readonly EdgeId[], treeId: number): Generator<TraceEvent> {
    for (const e of edges) {
      if (!cutEmitted.has(e)) {
        cutEmitted.add(e);
        yield { k: "forest", op: "cut", e, tree: treeId };
      }
    }
  };

  const maybeReport = (frame: PartitionFrame): void => {
    if (frame.accumVertices.length < s) {
      return;
    }
    const group: PartitionGroup = {
      vertices: sortedCopy(frame.accumVertices),
      edges: sortedEdgeCopy(frame.accumEdges),
    };
    const treeId = nextReportTreeId;
    nextReportTreeId += 1;
    reports.push({ group, treeId });
    frame.accumVertices = [frame.node];
    frame.accumEdges = [];
  };

  // arXiv 2602.07868 Algorithm 5 — explicit stack (path-shaped F̄ can be Ω(n)).
  const stack: PartitionFrame[] = [
    {
      node: root,
      parent: SENTINEL,
      incomingEdge: SENTINEL,
      childIdx: 0,
      children: childrenOf(root, SENTINEL),
      accumVertices: [root],
      accumEdges: [],
    },
  ];

  let leftover: SubtreeAccum = { vertices: [root], edges: [] };

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) {
      throw new Error("partitionTree: empty stack frame");
    }
    if (frame.childIdx < frame.children.length) {
      const entry = frame.children[frame.childIdx];
      frame.childIdx += 1;
      stack.push({
        node: entry.neighbor,
        parent: frame.node,
        incomingEdge: entry.edge,
        childIdx: 0,
        children: childrenOf(entry.neighbor, frame.node),
        accumVertices: [entry.neighbor],
        accumEdges: [],
      });
      continue;
    }

    stack.pop();
    if (stack.length === 0) {
      leftover = { vertices: frame.accumVertices, edges: frame.accumEdges };
      break;
    }

    const parentFrame = stack[stack.length - 1];
    if (parentFrame === undefined) {
      throw new Error("partitionTree: missing parent frame");
    }
    for (const cv of frame.accumVertices) {
      parentFrame.accumVertices.push(cv);
    }
    for (const ce of frame.accumEdges) {
      parentFrame.accumEdges.push(ce);
    }
    parentFrame.accumEdges.push(frame.incomingEdge);
    maybeReport(parentFrame);
  }

  if (reports.length === 0) {
    const soleGroup: PartitionGroup = {
      vertices: sortedCopy(leftover.vertices),
      edges: sortedEdgeCopy(leftover.edges),
    };
    const treeId = firstTreeId;
    reports.push({ group: soleGroup, treeId });
    for (const event of emitCuts(soleGroup.edges, treeId)) {
      yield event;
    }
    const groups = reports.map((r) => r.group);
    return { groups, nextTreeId: firstTreeId + 1 };
  } else {
    for (const report of reports) {
      for (const event of emitCuts(report.group.edges, report.treeId)) {
        yield event;
      }
    }

    const lastReport = reports[reports.length - 1];
    if (lastReport === undefined) {
      throw new Error("partitionTree: missing last report");
    }
    const lastGroup = lastReport.group;
    const lastTreeId = lastReport.treeId;
    const lastVertSet = new Set(lastGroup.vertices);
    const lastEdgeSet = new Set(lastGroup.edges);

    for (const v of leftover.vertices) {
      if (!lastVertSet.has(v)) {
        lastGroup.vertices.push(v);
        lastVertSet.add(v);
      }
    }
    lastGroup.vertices.sort((a, b) => a - b);

    const newLeftoverCuts: EdgeId[] = [];
    for (const e of leftover.edges) {
      if (!lastEdgeSet.has(e)) {
        lastGroup.edges.push(e);
        lastEdgeSet.add(e);
        newLeftoverCuts.push(e);
      }
    }
    lastGroup.edges.sort((a, b) => a - b);

    for (const event of emitCuts(newLeftoverCuts, lastTreeId)) {
      yield event;
    }
  }

  const groups = reports.map((r) => r.group);
  return { groups, nextTreeId: nextReportTreeId };
}

type FBarForest = {
  vertices: VertexId[];
  edges: EdgeId[];
};

type WForest = {
  root: VertexId;
  vertices: VertexId[];
  edges: EdgeId[];
};

/**
 * FindPivots spanning-forest search — arXiv 2602.07868 Algorithm 2.
 *
 * Builds F̄_j trees and W_j arborescences via local Dijkstra, partitions each F̄_j
 * (Algorithm 5), then selects pivots p_j per partition group.
 *
 * @param graph - CSR directed graph.
 * @param B - Distance upper bound 4-tuple.
 * @param S - Multi-source frontier; deduplicated then scanned ascending.
 * @param k - Subtree size threshold (≥ 1).
 * @param dist - Shared distance store; mutated in place.
 * @param level - Recursion depth label for pivot trace events.
 */
export function* findPivotsForest(
  graph: Graph,
  B: DistanceLabel,
  S: readonly VertexId[],
  k: number,
  dist: DistanceStore,
  level: number,
): Generator<TraceEvent, ForestFindPivotsResult, undefined> {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`k must be an integer >= 1, got ${String(k)}`);
  }
  if (!Number.isInteger(level) || level < 0) {
    throw new Error(`level must be a non-negative integer, got ${String(level)}`);
  }
  if (!Number.isFinite(B.length) && B.length !== Number.POSITIVE_INFINITY) {
    throw new Error(`B.length must be finite or +Infinity, got ${String(B.length)}`);
  }
  if (
    dist.length.length !== graph.n ||
    dist.nEdges.length !== graph.n ||
    dist.curr.length !== graph.n ||
    dist.pred.length !== graph.n
  ) {
    throw new Error(`dist arrays length must equal graph.n (${graph.n})`);
  }

  for (const s of S) {
    if (!Number.isInteger(s) || s < 0 || s >= graph.n) {
      throw new Error(`every source must be an integer in [0, ${graph.n}), got ${String(s)}`);
    }
  }

  const n = graph.n;
  const sources = dedupeSourcesAscending(S, n);
  const { offsets, targets, weights } = graph;

  const fBarVertexIndex = new Int32Array(n);
  fBarVertexIndex.fill(SENTINEL);
  const fBarForests: FBarForest[] = [];

  const wForests: WForest[] = [];
  const wVertexMembers: VertexId[] = [];

  let localSearchId = 0;
  let partitionTreeId = 0;

  const kInK = new Uint8Array(n);
  const kIncoming = new Int32Array(n);
  kIncoming.fill(SENTINEL);
  const kMembers: VertexId[] = [];
  let kCount = 0;

  const clearK = (): void => {
    for (const v of kMembers) {
      kInK[v] = 0;
      kIncoming[v] = SENTINEL;
    }
    kMembers.length = 0;
    kCount = 0;
  };

  const collectK = (root: VertexId): { vertices: VertexId[]; edges: EdgeId[] } => {
    const vertices: VertexId[] = [];
    const edges: EdgeId[] = [];
    for (const v of kMembers) {
      vertices.push(v);
      if (v !== root) {
        const e = kIncoming[v];
        if (e === SENTINEL) {
          throw new Error(`K vertex ${v} missing incoming edge`);
        }
        edges.push(e);
      }
    }
    return { vertices, edges };
  };

  const mergeKIntoFBar = (jPrime: number, root: VertexId): void => {
    const forest = fBarForests[jPrime];
    if (forest === undefined) {
      throw new Error(`FBar forest index ${jPrime} missing`);
    }
    const collected = collectK(root);
    for (const v of collected.vertices) {
      if (fBarVertexIndex[v] === SENTINEL) {
        forest.vertices.push(v);
        fBarVertexIndex[v] = jPrime;
      }
    }
    for (const e of collected.edges) {
      forest.edges.push(e);
    }
  };

  const addVertexToK = (v: VertexId, e: EdgeId, root: VertexId): void => {
    if (kInK[v] === 0) {
      kInK[v] = 1;
      kMembers.push(v);
      kCount += 1;
    }
    if (v !== root) {
      kIncoming[v] = e;
    }
  };

  // arXiv 2602.07868 Algorithm 2
  for (const x of sources) {
    if (fBarVertexIndex[x] !== SENTINEL) {
      continue;
    }

    const labelX = labelAt(dist, x);
    if (labelX.length === Number.POSITIVE_INFINITY) {
      continue;
    }

    const currentSearchId = localSearchId;
    localSearchId += 1;

    clearK();
    kInK[x] = 1;
    kMembers.push(x);
    kCount = 1;

    const heap = new LabelHeap();
    const pushCmps = heap.push(x, labelX);
    yield { k: "heap", op: "push", cmps: pushCmps };

    let merged = false;

    while (heap.size > 0 && kCount < k) {
      const { v: u, cmps: popCmps, snapshot } = heap.popmin();
      yield { k: "heap", op: "popmin", cmps: popCmps };

      if (!labelMatchesStore(dist, u, snapshot)) {
        continue;
      }

      const arcStart = offsets[u];
      const arcEnd = offsets[u + 1];
      if (arcStart === undefined || arcEnd === undefined) {
        throw new Error(`offsets for vertex ${u} missing`);
      }

      for (let e = arcStart; e < arcEnd; e += 1) {
        const v = targets[e];
        const w = weights[e];
        if (v === undefined || w === undefined) {
          throw new Error(`CSR arc ${e} missing`);
        }

        const improved = relax(dist, u, v, w, B);
        yield { k: "relax", e, improved, cost: 1 };

        if (!improved) {
          continue;
        }

        const overlapIndex = fBarVertexIndex[v];
        if (overlapIndex !== SENTINEL) {
          if (kInK[v] === 0) {
            addVertexToK(v, e, x);
          }
          yield { k: "forest", op: "grow", e, tree: currentSearchId };
          mergeKIntoFBar(overlapIndex, x);
          merged = true;
          break;
        }

        if (kInK[v] === 1) {
          kIncoming[v] = e;
          // DMSY-P23/P24: last grow per head vertex wins on replay.
          yield { k: "forest", op: "grow", e, tree: currentSearchId };
          const rePushCmps = heap.push(v, labelAt(dist, v));
          yield { k: "heap", op: "push", cmps: rePushCmps };
          continue;
        }

        addVertexToK(v, e, x);
        yield { k: "forest", op: "grow", e, tree: currentSearchId };
        const growPushCmps = heap.push(v, labelAt(dist, v));
        yield { k: "heap", op: "push", cmps: growPushCmps };
        if (kCount >= k) {
          break;
        }
      }

      if (merged || kCount >= k) {
        break;
      }
    }

    if (merged) {
      continue;
    }

    const kSize = kCount;
    const collected = collectK(x);

    if (kSize >= k) {
      const forestIndex = fBarForests.length;
      fBarForests.push({
        vertices: collected.vertices,
        edges: collected.edges,
      });
      for (const v of collected.vertices) {
        fBarVertexIndex[v] = forestIndex;
      }
    } else {
      wForests.push({
        root: x,
        vertices: collected.vertices,
        edges: collected.edges,
      });
      for (const v of collected.vertices) {
        wVertexMembers.push(v);
      }
    }
  }

  const Q = sortedCopy(wForests.map((w) => w.root));
  const wSeen = new Uint8Array(n);
  const wUnique: VertexId[] = [];
  for (const v of wVertexMembers) {
    if (wSeen[v] === 0) {
      wSeen[v] = 1;
      wUnique.push(v);
    }
  }
  const W = sortedCopy(wUnique);

  const qSet = new Set(Q);
  const sourcesNotInQ: VertexId[] = [];
  for (const s of sources) {
    if (!qSet.has(s)) {
      sourcesNotInQ.push(s);
    }
  }

  const allFjGroups: PartitionGroup[] = [];

  for (const fBar of fBarForests) {
    const partitionGen = partitionTree(graph, fBar.vertices, fBar.edges, k, partitionTreeId);
    let partitionResult: { groups: PartitionGroup[]; nextTreeId: number } | undefined;
    while (true) {
      const step = partitionGen.next();
      if (step.done) {
        partitionResult = step.value;
        break;
      }
      yield step.value;
    }
    if (partitionResult === undefined) {
      throw new Error("partitionTree returned no result");
    }
    for (const group of partitionResult.groups) {
      allFjGroups.push(group);
    }
    partitionTreeId = partitionResult.nextTreeId;
  }

  const assignedSources = new Set<VertexId>();
  const resultGroups: VertexId[][] = [];
  const resultP: VertexId[] = [];

  // arXiv 2602.07868 Lemma 3.2, Remark 3.3 — pivot selection per partition group
  for (const fj of allFjGroups) {
    const fjVertSet = new Set(fj.vertices);
    const pjMembers: VertexId[] = [];
    for (const s of sourcesNotInQ) {
      if (assignedSources.has(s)) {
        continue;
      }
      if (fjVertSet.has(s)) {
        pjMembers.push(s);
        assignedSources.add(s);
      }
    }

    if (pjMembers.length === 0) {
      continue;
    }

    let best = pjMembers[0];
    let bestLabel = labelAt(dist, best);
    for (let i = 1; i < pjMembers.length; i += 1) {
      const candidate = pjMembers[i];
      const candidateLabel = labelAt(dist, candidate);
      if (compareLabels(candidateLabel, bestLabel) === "<") {
        best = candidate;
        bestLabel = candidateLabel;
      }
    }

    resultGroups.push(sortedCopy(pjMembers));
    resultP.push(best);
    yield { k: "pivot", v: best, level };
  }

  return {
    groups: resultGroups,
    P: resultP,
    Q,
    W,
  };
}
