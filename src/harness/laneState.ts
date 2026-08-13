/**
 * Typed-array visual state for one race lane (issue #7, design.md §4.3).
 *
 * Headless playback snapshot: settle order, frontier flags, event cursor,
 * billed work, per-edge relax ghost data for lens mode, and BMSSP overlay
 * narration fields (issue #12). No DOM, `Date.now()`, or `Math.random()`.
 */

import { SENTINEL } from "../core/trace.ts";

/** Matches trace SENTINEL: vertex has not settled. Renderer imports this, not trace.ts. */
export const UNSETTLED = SENTINEL;

/** Maximum schematic D blocks tracked for BMSSP overlay narration. */
export const D_BLOCK_CAP = 64;

/**
 * Per-lane playback state derived from trace events.
 *
 * `settleOrder[v]` is {@link UNSETTLED} until vertex `v` settles, then its
 * 0-based settle index. `frontier[v]` is 1 when `v` is improved but not yet
 * settled. `lastRelaxWork[e]` is {@link UNSETTLED} until edge `e` improves,
 * then the billed work after that relax event. `pred[v]` and `dist[v]` mirror
 * shortest-path tree state from relax events; `settleWork[v]` records billed
 * work after the settle on `v`. Scalars track playback progress and out-of-order
 * settle detection via `maxSettledDist`. BMSSP fields hold visual/narration state
 * for recurse depth, FindPivots batches, bloom regions, and schematic D blocks.
 */
export class LaneState {
  readonly n: number;
  /** Edge count for the graph this lane mirrors. */
  readonly m: number;
  /** Per-vertex settle index, or {@link UNSETTLED} if not yet settled. */
  readonly settleOrder: Int32Array;
  /**
   * Predecessor vertex on the shortest-path tree, or {@link UNSETTLED} until an
   * improving relax assigns one. The source stays {@link UNSETTLED}.
   */
  readonly pred: Int32Array;
  /**
   * Tentative shortest-path distance; `Infinity` until known. TraceBuffer sets
   * `dist[source]` on playback start; constructor/reset do not know the source.
   */
  readonly dist: Float64Array;
  /**
   * Billed work after the settle event on vertex `v`, or {@link UNSETTLED} until
   * `v` settles.
   */
  readonly settleWork: Int32Array;
  /** 1 if vertex is on the open frontier (improved, not settled); else 0. */
  readonly frontier: Uint8Array;
  /**
   * Per-edge billed work after the latest improving relax on that edge, or
   * {@link UNSETTLED} if the edge has not yet improved.
   */
  readonly lastRelaxWork: Int32Array;
  /** Count of vertices with a settled order assigned. */
  settledCount: number;
  /**
   * Settles where `dist[v] < maxSettledDist` at settle time (out-of-order vs
   * Dijkstra order). Incremented by TraceBuffer on each such settle.
   */
  outOfOrderSettles: number;
  /**
   * Maximum `dist[v]` among settled vertices so far; `-Infinity` when none
   * settled. Lets TraceBuffer detect out-of-order settles without scanning.
   */
  maxSettledDist: number;
  /** Next trace event index to apply (0..totalEvents). */
  eventIndex: number;
  /** Billed ops applied so far (sum of chunk costs). */
  work: number;
  /** Running count of relax trace events applied. */
  relaxations: number;
  /** Running count of heap trace events applied. */
  heapOps: number;

  /** Nest depth from recurse in/out; 0 at top level when not inside a recurse. */
  recursionDepth: number;
  /** Active bound B from the latest recurse in; `Infinity` when unset or top-level. */
  currentBound: number;
  /** 1 if a FindPivots batch is currently open; otherwise 0. */
  batchOpen: number;
  /** Level of the open or most recent FindPivots batch. */
  batchLevel: number;
  /** 1-based FindPivots round at the current level (incremented on batch start). */
  batchRound: number;
  /** Narration k for FindPivots; 0 until set by TraceBuffer. */
  findPivotsK: number;
  /** Vertex count from the latest batch start (vertices relaxed this round). */
  lastBatchSize: number;
  /** Pivots seen since the last recurse-in at the current FindPivots window. */
  pivotsFoundThisCall: number;
  /** n from the latest dstruct pull; 0 if none yet. */
  lastPullN: number;
  /** Count of dstruct trace events applied. */
  dstructOps: number;
  /** Bloom bbox minimum x; `Infinity` when the bloom set is empty. */
  bloomMinX: number;
  /** Bloom bbox minimum y; `Infinity` when the bloom set is empty. */
  bloomMinY: number;
  /** Bloom bbox maximum x; `-Infinity` when the bloom set is empty. */
  bloomMaxX: number;
  /** Bloom bbox maximum y; `-Infinity` when the bloom set is empty. */
  bloomMaxY: number;
  /** 1 when the bloom region is valid for FX; otherwise 0. */
  bloomActive: number;
  /** Number of schematic D blocks currently in use. */
  dBlockCount: number;
  /**
   * Billed work when vertex v last flared as a pivot, or {@link UNSETTLED} if
   * never flared.
   */
  readonly pivotFlareWork: Int32Array;
  /** 1 if vertex v is in the current bloom set; otherwise 0. */
  readonly bloomVertex: Uint8Array;
  /** Schematic D block sizes; only indices `0..dBlockCount-1` are meaningful. */
  readonly dBlockSizes: Int32Array;

  /**
   * Allocate lane state for a graph with `n` vertices and `m` edges.
   *
   * @param n - Vertex count; must be an integer >= 0.
   * @param m - Edge count; must be an integer >= 0.
   * @throws If `n` or `m` is not an integer or is negative.
   */
  constructor(n: number, m: number) {
    if (!Number.isInteger(n)) {
      throw new Error(`n must be an integer >= 0, got ${String(n)}`);
    }
    if (n < 0) {
      throw new Error(`n must be >= 0, got ${String(n)}`);
    }
    if (!Number.isInteger(m)) {
      throw new Error(`m must be an integer >= 0, got ${String(m)}`);
    }
    if (m < 0) {
      throw new Error(`m must be >= 0, got ${String(m)}`);
    }
    this.n = n;
    this.m = m;
    this.settleOrder = new Int32Array(n);
    this.pred = new Int32Array(n);
    this.dist = new Float64Array(n);
    this.settleWork = new Int32Array(n);
    this.frontier = new Uint8Array(n);
    this.lastRelaxWork = new Int32Array(m);
    this.pivotFlareWork = new Int32Array(n);
    this.bloomVertex = new Uint8Array(n);
    this.dBlockSizes = new Int32Array(D_BLOCK_CAP);
    this.settledCount = 0;
    this.outOfOrderSettles = 0;
    this.maxSettledDist = -Infinity;
    this.eventIndex = 0;
    this.work = 0;
    this.relaxations = 0;
    this.heapOps = 0;
    this.recursionDepth = 0;
    this.currentBound = Infinity;
    this.batchOpen = 0;
    this.batchLevel = 0;
    this.batchRound = 0;
    this.findPivotsK = 0;
    this.lastBatchSize = 0;
    this.pivotsFoundThisCall = 0;
    this.lastPullN = 0;
    this.dstructOps = 0;
    this.bloomMinX = Infinity;
    this.bloomMinY = Infinity;
    this.bloomMaxX = -Infinity;
    this.bloomMaxY = -Infinity;
    this.bloomActive = 0;
    this.dBlockCount = 0;
    this.reset();
  }

  /**
   * Clear playback state: unsettled vertices, empty frontier, zero counters.
   */
  reset(): void {
    this.settleOrder.fill(UNSETTLED);
    this.pred.fill(UNSETTLED);
    this.dist.fill(Infinity);
    this.settleWork.fill(UNSETTLED);
    this.frontier.fill(0);
    this.lastRelaxWork.fill(UNSETTLED);
    this.pivotFlareWork.fill(UNSETTLED);
    this.bloomVertex.fill(0);
    this.dBlockSizes.fill(0);
    this.settledCount = 0;
    this.outOfOrderSettles = 0;
    this.maxSettledDist = -Infinity;
    this.eventIndex = 0;
    this.work = 0;
    this.relaxations = 0;
    this.heapOps = 0;
    this.recursionDepth = 0;
    this.currentBound = Infinity;
    this.batchOpen = 0;
    this.batchLevel = 0;
    this.batchRound = 0;
    this.findPivotsK = 0;
    this.lastBatchSize = 0;
    this.pivotsFoundThisCall = 0;
    this.lastPullN = 0;
    this.dstructOps = 0;
    this.bloomMinX = Infinity;
    this.bloomMinY = Infinity;
    this.bloomMaxX = -Infinity;
    this.bloomMaxY = -Infinity;
    this.bloomActive = 0;
    this.dBlockCount = 0;
  }

  /**
   * Deep copy of typed arrays and scalar fields.
   *
   * @returns A new lane with the same vertex and edge counts and identical contents.
   */
  clone(): LaneState {
    const copy = new LaneState(this.n, this.m);
    copy.copyFrom(this);
    return copy;
  }

  /**
   * Overwrite this lane from `other` (arrays and scalars).
   *
   * @param other - Source lane; must have the same `n` and `m` as this lane.
   * @throws If `other.n !== this.n` or `other.m !== this.m`.
   */
  copyFrom(other: LaneState): void {
    if (other.n !== this.n) {
      throw new Error(
        `lane vertex count mismatch: expected ${String(this.n)}, got ${String(other.n)}`,
      );
    }
    if (other.m !== this.m) {
      throw new Error(
        `lane edge count mismatch: expected ${String(this.m)}, got ${String(other.m)}`,
      );
    }
    this.settleOrder.set(other.settleOrder);
    this.pred.set(other.pred);
    this.dist.set(other.dist);
    this.settleWork.set(other.settleWork);
    this.frontier.set(other.frontier);
    this.lastRelaxWork.set(other.lastRelaxWork);
    this.pivotFlareWork.set(other.pivotFlareWork);
    this.bloomVertex.set(other.bloomVertex);
    this.dBlockSizes.set(other.dBlockSizes);
    this.settledCount = other.settledCount;
    this.outOfOrderSettles = other.outOfOrderSettles;
    this.maxSettledDist = other.maxSettledDist;
    this.eventIndex = other.eventIndex;
    this.work = other.work;
    this.relaxations = other.relaxations;
    this.heapOps = other.heapOps;
    this.recursionDepth = other.recursionDepth;
    this.currentBound = other.currentBound;
    this.batchOpen = other.batchOpen;
    this.batchLevel = other.batchLevel;
    this.batchRound = other.batchRound;
    this.findPivotsK = other.findPivotsK;
    this.lastBatchSize = other.lastBatchSize;
    this.pivotsFoundThisCall = other.pivotsFoundThisCall;
    this.lastPullN = other.lastPullN;
    this.dstructOps = other.dstructOps;
    this.bloomMinX = other.bloomMinX;
    this.bloomMinY = other.bloomMinY;
    this.bloomMaxX = other.bloomMaxX;
    this.bloomMaxY = other.bloomMaxY;
    this.bloomActive = other.bloomActive;
    this.dBlockCount = other.dBlockCount;
  }
}
