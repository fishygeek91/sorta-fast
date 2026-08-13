/**
 * CSR graph representation and seeded generators (issue #2).
 *
 * Directed, non-negative weights — the SSSP setting of BMSSP / DMSY.
 * Layout coordinates are produced at generation time so the renderer never
 * has to run a layout pass on the main thread (design.md §4.4).
 */

import { mulberry32, type Mulberry32 } from "./prng.ts";

/** Gallery kinds; `city` is the URL slug used in design.md §1. */
export const GRAPH_KINDS = ["city", "maze", "clusters", "sparse"] as const;

export type GraphKind = (typeof GRAPH_KINDS)[number];

/**
 * Node-count presets (design.md §3.4).
 * XL is a stress option, not the default race size.
 */
export const SIZE_PRESETS = {
  S: 500,
  M: 5000,
  L: 25000,
  XL: 100000,
} as const;

export type SizePreset = keyof typeof SIZE_PRESETS;

/**
 * Compressed-sparse-row directed graph on typed arrays.
 *
 * Out-edges of vertex `v` occupy `targets/weights[offsets[v] .. offsets[v+1])`.
 * Neighbor order is sorted by target id so iteration is deterministic.
 */
export interface Graph {
  readonly n: number;
  readonly m: number;
  readonly offsets: Uint32Array;
  readonly targets: Uint32Array;
  readonly weights: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
}

/**
 * Vertex index in `0 .. n-1`.
 */
export type VertexId = number;

/**
 * Directed-arc index into CSR `targets` / `weights` (`0 .. m-1`).
 * Edge `i` leaves vertex `u` when `offsets[u] <= i < offsets[u+1]`.
 */
export type EdgeId = number;

/** One directed arc, used only while packing (not the runtime representation). */
export type CsrEdge = {
  readonly from: number;
  readonly to: number;
  readonly weight: number;
};

const WEIGHT_LO = 1;
const WEIGHT_SPAN = 99;
const INTRA_DEGREE = 8;
const CLUSTER_BRIDGES = 3;
const CLUSTER_COUNT_MIN = 4;
const CLUSTER_COUNT_MAX = 24;
const CLUSTER_RING_RADIUS = 0.35;
const CLUSTER_JITTER = 0.12;

/**
 * Pack a directed edge list into CSR typed arrays.
 *
 * Rejects self-loops, duplicate `(from, to)` arcs, negative / non-finite weights,
 * and out-of-range endpoints. Simple digraph only — later SSSP lanes assume no
 * parallel edges. Edges are sorted by `(from, to)` so neighbor iteration is stable.
 *
 * @param n - Vertex count; must be an integer >= 0.
 * @param edges - Directed arcs.
 * @param x - Per-vertex x coordinates (length `n`).
 * @param y - Per-vertex y coordinates (length `n`).
 */
export function packCsr(
  n: number,
  edges: readonly CsrEdge[],
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): Graph {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`n must be an integer >= 0, got ${String(n)}`);
  }
  if (x.length !== n || y.length !== n) {
    throw new Error(`coordinate arrays must have length ${n}, got x=${x.length} y=${y.length}`);
  }

  for (let v = 0; v < n; v += 1) {
    const xv = x[v];
    const yv = y[v];
    if (xv === undefined || yv === undefined || !Number.isFinite(xv) || !Number.isFinite(yv)) {
      throw new Error(`non-finite coordinates at vertex ${v}`);
    }
  }

  const sorted = edges.slice().sort((a, b) => {
    if (a.from !== b.from) {
      return a.from - b.from;
    }
    return a.to - b.to;
  });

  for (const edge of sorted) {
    if (!Number.isInteger(edge.from) || !Number.isInteger(edge.to)) {
      throw new Error(`edge endpoints must be integers, got ${edge.from} -> ${edge.to}`);
    }
    if (edge.from < 0 || edge.from >= n || edge.to < 0 || edge.to >= n) {
      throw new Error(`edge ${edge.from} -> ${edge.to} is out of range for n=${n}`);
    }
    if (edge.from === edge.to) {
      throw new Error(`self-loop at vertex ${edge.from}`);
    }
    if (!Number.isFinite(edge.weight) || edge.weight < 0) {
      throw new Error(
        `weight must be finite and >= 0, got ${edge.weight} on ${edge.from} -> ${edge.to}`,
      );
    }
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const edge = sorted[i];
    if (prev === undefined || edge === undefined) {
      throw new Error("packCsr: sorted edge list was sparse");
    }
    if (prev.from === edge.from && prev.to === edge.to) {
      throw new Error(`duplicate arc ${edge.from} -> ${edge.to}`);
    }
  }

  const m = sorted.length;
  const offsets = new Uint32Array(n + 1);
  const targets = new Uint32Array(m);
  const weights = new Float64Array(m);

  let e = 0;
  for (let v = 0; v < n; v += 1) {
    offsets[v] = e;
    while (e < m) {
      const edge = sorted[e];
      if (edge === undefined || edge.from !== v) {
        break;
      }
      targets[e] = edge.to;
      weights[e] = edge.weight;
      e += 1;
    }
  }
  offsets[n] = m;

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  xs.set(x);
  ys.set(y);

  return { n, m, offsets, targets, weights, x: xs, y: ys };
}

/**
 * Generate a seeded graph of the requested kind.
 *
 * @param kind - One of {@link GRAPH_KINDS}.
 * @param n - Vertex count; integer >= 1. `sparse` requires n >= 3 (cannot place
 *   m = 2n distinct arcs otherwise). `city` with n = 1 or 2 is edgeless — the
 *   Delaunay super-triangle is stripped and nothing remains. URL/UI layers
 *   should clamp rather than pass those sizes through.
 * @param seed - PRNG seed; coerced to Uint32.
 */
export function generateGraph(kind: GraphKind, n: number, seed: number): Graph {
  if (kind !== "city" && kind !== "maze" && kind !== "clusters" && kind !== "sparse") {
    throw new Error(`unknown graph kind: ${String(kind)}`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(n)}`);
  }

  switch (kind) {
    case "city":
      return generateCity(n, seed);
    case "maze":
      return generateMaze(n, seed);
    case "clusters":
      return generateClusters(n, seed);
    case "sparse":
      return generateSparse(n, seed);
  }
}

/**
 * Sparse random digraph with exactly `m = 2n` distinct arcs (design.md §3.4).
 * This is the regime where the Feb-2026 bound is meant to shine.
 */
function generateSparse(n: number, seed: number): Graph {
  const maxArcs = n * (n - 1);
  const want = 2 * n;
  if (want > maxArcs) {
    throw new Error(`sparse graphs need n >= 3 to place m = 2n distinct arcs, got n=${n}`);
  }

  const rng = mulberry32(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let v = 0; v < n; v += 1) {
    x[v] = rng.next();
    y[v] = rng.next();
  }

  const seen = new Set<string>();
  const edges: CsrEdge[] = [];
  while (edges.length < want) {
    const from = randomIndex(rng, n);
    const to = randomIndex(rng, n);
    if (from === to) {
      continue;
    }
    const key = `${from},${to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    edges.push({ from, to, weight: randomWeight(rng) });
  }

  return packCsr(n, edges, x, y);
}

/**
 * Grid maze via iterative recursive-backtracker (seeded neighbor order).
 *
 * The cell graph is a 4-neighbor grid with `cols = ceil(sqrt(n))`; the last
 * row may be short so the vertex count is exactly `n`. A perfect maze is a
 * spanning tree, so the directed graph has `m = 2(n-1)` unit-weight arcs.
 */
function generateMaze(n: number, seed: number): Graph {
  const rng = mulberry32(seed);
  const cols = Math.ceil(Math.sqrt(n));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let v = 0; v < n; v += 1) {
    x[v] = v % cols;
    y[v] = Math.floor(v / cols);
  }

  const visited = new Uint8Array(n);
  const stack: number[] = [0];
  visited[0] = 1;
  const edges: CsrEdge[] = [];

  while (stack.length > 0) {
    const v = stack[stack.length - 1];
    if (v === undefined) {
      break;
    }
    const candidates = unvisitedNeighbors(v, n, cols, visited);
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    shuffleInPlace(candidates, rng);
    const u = candidates[0];
    if (u === undefined) {
      throw new Error("maze: shuffled candidate list was empty");
    }
    visited[u] = 1;
    stack.push(u);
    edges.push({ from: v, to: u, weight: 1 });
    edges.push({ from: u, to: v, weight: 1 });
  }

  for (let v = 0; v < n; v += 1) {
    if (visited[v] !== 1) {
      throw new Error(`maze: cell ${v} was never visited; grid is disconnected`);
    }
  }

  return packCsr(n, edges, x, y);
}

/**
 * Ring of clusters: dense local neighborhoods, sparse ring bridges.
 *
 * Batch-blooms read clearly because the frontier jumps between clusters
 * (design.md §3.4).
 */
function generateClusters(n: number, seed: number): Graph {
  const rng = mulberry32(seed);
  const clusterCount = clusterCountFor(n);
  const ranges = partitionContiguous(n, clusterCount);
  const x = new Float64Array(n);
  const y = new Float64Array(n);

  for (let c = 0; c < clusterCount; c += 1) {
    const range = ranges[c];
    if (range === undefined) {
      throw new Error(`clusters: missing range for cluster ${c}`);
    }
    const theta = (2 * Math.PI * c) / clusterCount;
    const cx = 0.5 + CLUSTER_RING_RADIUS * Math.cos(theta);
    const cy = 0.5 + CLUSTER_RING_RADIUS * Math.sin(theta);
    for (let v = range.start; v < range.end; v += 1) {
      x[v] = cx + (rng.next() - 0.5) * CLUSTER_JITTER;
      y[v] = cy + (rng.next() - 0.5) * CLUSTER_JITTER;
    }
  }

  const undirected = new Map<string, number>();

  const addUndirected = (a: number, b: number): void => {
    if (a === b) {
      return;
    }
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo},${hi}`;
    if (undirected.has(key)) {
      return;
    }
    undirected.set(key, randomWeight(rng));
  };

  for (const range of ranges) {
    const size = range.end - range.start;
    const degree = Math.min(INTRA_DEGREE, size - 1);
    if (degree <= 0) {
      continue;
    }
    const members: number[] = [];
    for (let v = range.start; v < range.end; v += 1) {
      members.push(v);
    }
    for (let v = range.start; v < range.end; v += 1) {
      const others: number[] = [];
      for (const u of members) {
        if (u !== v) {
          others.push(u);
        }
      }
      shuffleInPlace(others, rng);
      for (let i = 0; i < degree; i += 1) {
        const u = others[i];
        if (u === undefined) {
          throw new Error("clusters: intra-neighbor pick out of range");
        }
        addUndirected(v, u);
      }
    }
  }

  if (clusterCount >= 2) {
    for (let c = 0; c < clusterCount; c += 1) {
      const left = ranges[c];
      const right = ranges[(c + 1) % clusterCount];
      if (left === undefined || right === undefined) {
        throw new Error("clusters: missing adjacent range");
      }
      const leftSize = left.end - left.start;
      const rightSize = right.end - right.start;
      for (let b = 0; b < CLUSTER_BRIDGES; b += 1) {
        const u = left.start + randomIndex(rng, leftSize);
        const v = right.start + randomIndex(rng, rightSize);
        addUndirected(u, v);
      }
    }
  }

  const edges: CsrEdge[] = [];
  for (const [key, weight] of undirected) {
    const parts = key.split(",");
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error(`clusters: malformed undirected key ${key}`);
    }
    edges.push({ from: a, to: b, weight });
    edges.push({ from: b, to: a, weight });
  }

  return packCsr(n, edges, x, y);
}

/**
 * Geometric / Delaunay city: random points in the unit square, Delaunay
 * triangulation via Bowyer–Watson, Euclidean bidirectional weights.
 *
 * Insertion order is vertex id (the seeded point stream). No extra jitter
 * beyond that stream — degeneracies are broken by insertion order + CSR sort.
 * n = 1 and n = 2 produce an edgeless graph (no remaining triangles).
 */
function generateCity(n: number, seed: number): Graph {
  const rng = mulberry32(seed);
  const px = new Float64Array(n + 3);
  const py = new Float64Array(n + 3);
  for (let v = 0; v < n; v += 1) {
    px[v] = rng.next();
    py[v] = rng.next();
  }

  const superA = n;
  const superB = n + 1;
  const superC = n + 2;
  px[superA] = -10;
  py[superA] = -10;
  px[superB] = 10;
  py[superB] = -10;
  px[superC] = 0;
  py[superC] = 20;

  type Triangle = { a: number; b: number; c: number };
  let triangles: Triangle[] = [{ a: superA, b: superB, c: superC }];

  for (let p = 0; p < n; p += 1) {
    const bad: Triangle[] = [];
    const kept: Triangle[] = [];
    for (const tri of triangles) {
      if (pointInCircumcircle(px, py, tri.a, tri.b, tri.c, p)) {
        bad.push(tri);
      } else {
        kept.push(tri);
      }
    }

    const boundary = cavityBoundary(bad);
    for (const edge of boundary) {
      kept.push({ a: edge.a, b: edge.b, c: p });
    }
    triangles = kept;
  }

  const seen = new Set<string>();
  const edges: CsrEdge[] = [];
  const addUndirected = (u: number, v: number): void => {
    if (u >= n || v >= n || u === v) {
      return;
    }
    const lo = u < v ? u : v;
    const hi = u < v ? v : u;
    const key = `${lo},${hi}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const ux = px[u];
    const uy = py[u];
    const vx = px[v];
    const vy = py[v];
    if (ux === undefined || uy === undefined || vx === undefined || vy === undefined) {
      throw new Error("city: missing point coordinates");
    }
    const weight = Math.hypot(ux - vx, uy - vy);
    edges.push({ from: u, to: v, weight });
    edges.push({ from: v, to: u, weight });
  };

  for (const tri of triangles) {
    if (tri.a >= n || tri.b >= n || tri.c >= n) {
      continue;
    }
    addUndirected(tri.a, tri.b);
    addUndirected(tri.b, tri.c);
    addUndirected(tri.c, tri.a);
  }

  const x = px.subarray(0, n);
  const y = py.subarray(0, n);
  return packCsr(n, edges, x, y);
}

/**
 * Unique boundary edges of the Bowyer–Watson cavity, oriented as in the
 * (only) bad triangle that contains them so the new vertex sits to the left.
 */
function cavityBoundary(
  bad: readonly { a: number; b: number; c: number }[],
): { a: number; b: number }[] {
  const counts = new Map<string, { a: number; b: number; count: number }>();

  const touch = (a: number, b: number): void => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo},${hi}`;
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { a, b, count: 1 });
      return;
    }
    existing.count += 1;
  };

  for (const tri of bad) {
    touch(tri.a, tri.b);
    touch(tri.b, tri.c);
    touch(tri.c, tri.a);
  }

  const boundary: { a: number; b: number }[] = [];
  for (const entry of counts.values()) {
    if (entry.count === 1) {
      boundary.push({ a: entry.a, b: entry.b });
    }
  }
  return boundary;
}

/**
 * In-circumcircle test. The triangle is forced counterclockwise so a
 * positive determinant means `p` is strictly inside the circumcircle.
 */
function pointInCircumcircle(
  px: Float64Array,
  py: Float64Array,
  ia: number,
  ib: number,
  ic: number,
  ip: number,
): boolean {
  const ax = px[ia];
  const ay = py[ia];
  let bx = px[ib];
  let by = py[ib];
  let cx = px[ic];
  let cy = py[ic];
  const dx = px[ip];
  const dy = py[ip];
  if (
    ax === undefined ||
    ay === undefined ||
    bx === undefined ||
    by === undefined ||
    cx === undefined ||
    cy === undefined ||
    dx === undefined ||
    dy === undefined
  ) {
    throw new Error("city: circumcircle test missing coordinates");
  }

  const twiceArea = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (twiceArea < 0) {
    const tx = bx;
    const ty = by;
    bx = cx;
    by = cy;
    cx = tx;
    cy = ty;
  }

  const adx = ax - dx;
  const ady = ay - dy;
  const bdx = bx - dx;
  const bdy = by - dy;
  const cdx = cx - dx;
  const cdy = cy - dy;
  const det =
    (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) -
    (bdx * bdx + bdy * bdy) * (adx * cdy - cdx * ady) +
    (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
  return det > 0;
}

function clusterCountFor(n: number): number {
  const raw = Math.round(Math.sqrt(n) / 3);
  const clamped = Math.min(CLUSTER_COUNT_MAX, Math.max(CLUSTER_COUNT_MIN, raw));
  return Math.min(n, clamped);
}

function partitionContiguous(n: number, parts: number): { start: number; end: number }[] {
  const base = Math.floor(n / parts);
  const extra = n % parts;
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < parts; i += 1) {
    const size = base + (i < extra ? 1 : 0);
    ranges.push({ start: cursor, end: cursor + size });
    cursor += size;
  }
  return ranges;
}

function unvisitedNeighbors(v: number, n: number, cols: number, visited: Uint8Array): number[] {
  const col = v % cols;
  const out: number[] = [];
  if (col > 0) {
    const west = v - 1;
    if (visited[west] !== 1) {
      out.push(west);
    }
  }
  if (col < cols - 1) {
    const east = v + 1;
    if (east < n && visited[east] !== 1) {
      out.push(east);
    }
  }
  if (v >= cols) {
    const north = v - cols;
    if (visited[north] !== 1) {
      out.push(north);
    }
  }
  const south = v + cols;
  if (south < n && visited[south] !== 1) {
    out.push(south);
  }
  return out;
}

function shuffleInPlace(values: number[], rng: Mulberry32): void {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = randomIndex(rng, i + 1);
    const a = values[i];
    const b = values[j];
    if (a === undefined || b === undefined) {
      throw new Error("shuffle: index out of range");
    }
    values[i] = b;
    values[j] = a;
  }
}

function randomIndex(rng: Mulberry32, n: number): number {
  if (n <= 0) {
    throw new Error(`randomIndex: n must be positive, got ${n}`);
  }
  return Math.floor(rng.next() * n);
}

function randomWeight(rng: Mulberry32): number {
  return WEIGHT_LO + rng.next() * WEIGHT_SPAN;
}

/**
 * BFS reachability mask on CSR out-edges from `source`.
 *
 * @param graph - CSR graph.
 * @param source - Start vertex; must be an integer in `[0, graph.n)`.
 * @param context - Prefix for internal error messages (caller name).
 * @returns `visited[v] === 1` when `v` is reachable from `source`.
 * @throws When `source` is out of range or CSR indices are inconsistent.
 */
function bfsVisited(graph: Graph, source: number, context: string): Uint8Array {
  if (!Number.isInteger(source) || source < 0 || source >= graph.n) {
    throw new Error(`source must be an integer in [0, ${graph.n}), got ${String(source)}`);
  }

  const visited = new Uint8Array(graph.n);
  const queue: number[] = [source];
  visited[source] = 1;
  let head = 0;

  while (head < queue.length) {
    const v = queue[head];
    head += 1;
    if (v === undefined) {
      throw new Error(`${context}: BFS queue was sparse`);
    }
    const start = graph.offsets[v];
    const end = graph.offsets[v + 1];
    if (start === undefined || end === undefined) {
      throw new Error(`${context}: missing offsets for vertex ${v}`);
    }
    for (let e = start; e < end; e += 1) {
      const u = graph.targets[e];
      if (u === undefined) {
        throw new Error(`${context}: missing target at edge ${e}`);
      }
      if (visited[u] === 0) {
        visited[u] = 1;
        queue.push(u);
      }
    }
  }

  return visited;
}

/**
 * Whether `vertex` is BFS-reachable from `source` on CSR out-edges.
 *
 * @param graph - CSR graph.
 * @param source - Start vertex; must be an integer in `[0, graph.n)`.
 * @param vertex - Vertex to test; must be an integer in `[0, graph.n)`.
 * @returns `true` when `vertex === source` or visited during BFS from `source`.
 * @throws When `source` or `vertex` is out of range.
 */
export function isBfsReachable(graph: Graph, source: number, vertex: number): boolean {
  if (!Number.isInteger(vertex) || vertex < 0 || vertex >= graph.n) {
    throw new Error(`vertex must be an integer in [0, ${graph.n}), got ${String(vertex)}`);
  }
  if (vertex === source) {
    return true;
  }

  const visited = bfsVisited(graph, source, "isBfsReachable");
  return visited[vertex] === 1;
}

/**
 * Pick the race photo-finish vertex for a directed graph.
 *
 * Runs BFS from `source` on the CSR out-edges, then chooses the reachable
 * vertex (other than `source`) whose layout is farthest from the source in
 * squared Euclidean distance. Ties break toward the lowest vertex id.
 *
 * @param graph - CSR graph with layout coordinates.
 * @param source - Start vertex; must be an integer in `[0, graph.n)`.
 * @returns The finish vertex id.
 * @throws When `source` is out of range, coordinates are missing or
 *   non-finite, or no vertex other than `source` is BFS-reachable.
 */
export function pickFinishVertex(graph: Graph, source: number): number {
  if (!Number.isInteger(source) || source < 0 || source >= graph.n) {
    throw new Error(`source must be an integer in [0, ${graph.n}), got ${String(source)}`);
  }

  const sx = graph.x[source];
  const sy = graph.y[source];
  if (sx === undefined || sy === undefined || !Number.isFinite(sx) || !Number.isFinite(sy)) {
    throw new Error(`non-finite coordinates at source vertex ${source}`);
  }

  const visited = bfsVisited(graph, source, "pickFinishVertex");

  let bestVertex = -1;
  let bestDistSq = -1;

  for (let v = 0; v < graph.n; v += 1) {
    if (v === source || visited[v] === 0) {
      continue;
    }
    const xv = graph.x[v];
    const yv = graph.y[v];
    if (xv === undefined || yv === undefined || !Number.isFinite(xv) || !Number.isFinite(yv)) {
      throw new Error(`non-finite coordinates at vertex ${v}`);
    }
    const dx = xv - sx;
    const dy = yv - sy;
    const distSq = dx * dx + dy * dy;
    if (distSq > bestDistSq || (distSq === bestDistSq && v < bestVertex)) {
      bestDistSq = distSq;
      bestVertex = v;
    }
  }

  if (bestVertex < 0) {
    throw new Error(
      `no finish vertex: only source ${source} is reachable in a graph with n=${graph.n}`,
    );
  }

  return bestVertex;
}
