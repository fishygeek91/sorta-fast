/**
 * Trace event schema, op-cost table, SoA chunks, and TraceWriter (issue #3).
 *
 * Algorithms emit TraceEvents into typed-array slabs; the renderer and harness
 * decode events only — never algorithm code (design.md §4.2).
 */

import { type EdgeId, type VertexId } from "./graph.ts";

export type { EdgeId, VertexId };

/** Numeric kind codes stored in the `kind` column of a TraceChunk. */
export const TRACE_KIND = {
  relax: 0,
  settle: 1,
  heap: 2,
  pivot: 3,
  batch: 4,
  recurse: 5,
  forest: 6,
  dstruct: 7,
} as const;

/** Unused integer columns in SoA packing. */
export const SENTINEL = -1;

export const HEAP_OP = { push: 0, popmin: 1, sift: 2 } as const;
export const BATCH_PHASE = { start: 0, end: 1 } as const;
export const RECURSE_DIR = { in: 0, out: 1 } as const;
export const FOREST_OP = { grow: 0, cut: 1 } as const;
export const DSTRUCT_OP = { insert: 0, batchPrepend: 1, pull: 2 } as const;

/**
 * Fairness rules for every lane (design.md §2.4). The only place billed
 * costs may be defined — encode() and costOf() read this table; emitters
 * must not hardcode a cost.
 *
 * Headline work-clock metric (UI "comparisons") = sum of per-event
 * costs. Secondary Fairness-panel numbers are kind counts from tally(),
 * not extra fees. "Vertices settled out of order" is computed in the
 * harness and documented in the Fairness panel (#16).
 *
 * - comparison: unit for heap/dstruct `cmps` (cost = cmps * comparison).
 * - relax: one billed op for the d[u]+w < d[v] test (union `cost: 1`).
 * - settle: one work-clock tick per settled vertex (union `cost: 1`).
 * - pivot/batch/recurse/forest: 0 — visualization/control events. Billing
 *   them would penalize BMSSP/DMSY for structure Dijkstra does not emit.
 */
export const OP_COST = {
  comparison: 1,
  relax: 1,
  settle: 1,
  pivot: 0,
  batch: 0,
  recurse: 0,
  forest: 0,
} as const;

/** Discriminated union of trace events algorithms may emit. */
export type TraceEvent =
  | { k: "relax"; e: EdgeId; improved: boolean; cost: 1 }
  | { k: "settle"; v: VertexId; order: number; cost: 1 }
  | { k: "heap"; op: "push" | "popmin" | "sift"; cmps: number }
  | { k: "pivot"; v: VertexId; level: number }
  | { k: "batch"; phase: "start" | "end"; level: number; size: number }
  | { k: "recurse"; dir: "in" | "out"; level: number; bound: number }
  | { k: "forest"; op: "grow" | "cut"; e: EdgeId; tree: number }
  | { k: "dstruct"; op: "insert" | "batchPrepend" | "pull"; n: number; cmps: number };

/**
 * Structure-of-arrays trace slab. `count` is the number of filled rows;
 * column arrays may span the full allocated capacity.
 */
export type TraceChunk = {
  readonly count: number;
  readonly kind: Uint8Array;
  readonly vertex: Int32Array;
  readonly edge: Int32Array;
  readonly aux0: Int32Array;
  readonly aux1: Int32Array;
  readonly aux2: Int32Array;
  readonly auxF: Float64Array;
  readonly cost: Uint32Array;
};

/** Aggregated counters from a trace chunk (headline work = sum of `cost`). */
export type TraceTally = {
  work: number;
  relaxations: number;
  heapOps: number;
  dstructOps: number;
  settles: number;
  pivots: number;
  batches: number;
  recurses: number;
  forests: number;
};

/** Default slab capacity for {@link TraceWriter}. */
export const DEFAULT_CHUNK_CAPACITY = 65536;

function assertEncodeIndex(chunk: TraceChunk, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= chunk.kind.length) {
    throw new Error(`encode index ${index} out of range (capacity ${chunk.kind.length})`);
  }
}

function assertDecodeIndex(chunk: TraceChunk, index: number): void {
  if (chunk.kind.length < chunk.count) {
    throw new Error("chunk buffers detached");
  }
  if (!Number.isInteger(index) || index < 0 || index >= chunk.count) {
    throw new Error(`decodeAt index ${index} out of range (count ${chunk.count})`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
}

function assertBound(name: string, bound: number): void {
  if (bound !== Infinity && !Number.isFinite(bound)) {
    throw new Error(`${name} must be finite or Infinity, got ${bound}`);
  }
}

function assertBoolean(name: string, value: boolean): void {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean, got ${typeof value}`);
  }
}

/** Write every SoA column exactly once. */
function writeRow(
  chunk: TraceChunk,
  index: number,
  kind: number,
  vertex: number,
  edge: number,
  aux0: number,
  aux1: number,
  aux2: number,
  auxF: number,
  cost: number,
): void {
  chunk.kind[index] = kind;
  chunk.vertex[index] = vertex;
  chunk.edge[index] = edge;
  chunk.aux0[index] = aux0;
  chunk.aux1[index] = aux1;
  chunk.aux2[index] = aux2;
  chunk.auxF[index] = auxF;
  chunk.cost[index] = cost;
}

function validateEvent(event: TraceEvent): void {
  switch (event.k) {
    case "relax":
      assertBoolean("improved", event.improved);
      return;
    case "settle":
      assertNonNegativeInteger("order", event.order);
      return;
    case "heap":
      assertNonNegativeInteger("cmps", event.cmps);
      return;
    case "pivot":
      assertNonNegativeInteger("level", event.level);
      return;
    case "batch":
      assertNonNegativeInteger("level", event.level);
      assertNonNegativeInteger("size", event.size);
      return;
    case "recurse":
      assertNonNegativeInteger("level", event.level);
      assertBound("bound", event.bound);
      return;
    case "forest":
      assertNonNegativeInteger("tree", event.tree);
      return;
    case "dstruct":
      assertNonNegativeInteger("n", event.n);
      assertNonNegativeInteger("cmps", event.cmps);
      return;
  }
}

function heapOpFromCode(code: number): "push" | "popmin" | "sift" {
  switch (code) {
    case HEAP_OP.push:
      return "push";
    case HEAP_OP.popmin:
      return "popmin";
    case HEAP_OP.sift:
      return "sift";
    default:
      throw new Error(`invalid heap op code ${code}`);
  }
}

function batchPhaseFromCode(code: number): "start" | "end" {
  switch (code) {
    case BATCH_PHASE.start:
      return "start";
    case BATCH_PHASE.end:
      return "end";
    default:
      throw new Error(`invalid batch phase code ${code}`);
  }
}

function recurseDirFromCode(code: number): "in" | "out" {
  switch (code) {
    case RECURSE_DIR.in:
      return "in";
    case RECURSE_DIR.out:
      return "out";
    default:
      throw new Error(`invalid recurse direction code ${code}`);
  }
}

function forestOpFromCode(code: number): "grow" | "cut" {
  switch (code) {
    case FOREST_OP.grow:
      return "grow";
    case FOREST_OP.cut:
      return "cut";
    default:
      throw new Error(`invalid forest op code ${code}`);
  }
}

function dstructOpFromCode(code: number): "insert" | "batchPrepend" | "pull" {
  switch (code) {
    case DSTRUCT_OP.insert:
      return "insert";
    case DSTRUCT_OP.batchPrepend:
      return "batchPrepend";
    case DSTRUCT_OP.pull:
      return "pull";
    default:
      throw new Error(`invalid dstruct op code ${code}`);
  }
}

/**
 * Billed work for a trace event, read only from {@link OP_COST}.
 */
export function costOf(event: TraceEvent): number {
  switch (event.k) {
    case "relax":
      return OP_COST.relax;
    case "settle":
      return OP_COST.settle;
    case "heap":
      return event.cmps * OP_COST.comparison;
    case "pivot":
      return OP_COST.pivot;
    case "batch":
      return OP_COST.batch;
    case "recurse":
      return OP_COST.recurse;
    case "forest":
      return OP_COST.forest;
    case "dstruct":
      return event.cmps * OP_COST.comparison;
  }
}

/**
 * Pack one {@link TraceEvent} into row `index` of a {@link TraceChunk}.
 * Hot path: no payload validation; each column is written once.
 * Unused int columns are {@link SENTINEL}; unused `auxF` is 0.
 * Use {@link encodeChecked} from tests.
 */
export function encode(chunk: TraceChunk, index: number, event: TraceEvent): void {
  switch (event.k) {
    case "relax":
      writeRow(
        chunk,
        index,
        TRACE_KIND.relax,
        SENTINEL,
        event.e,
        event.improved ? 1 : 0,
        SENTINEL,
        SENTINEL,
        0,
        OP_COST.relax,
      );
      return;

    case "settle":
      writeRow(
        chunk,
        index,
        TRACE_KIND.settle,
        event.v,
        SENTINEL,
        event.order,
        SENTINEL,
        SENTINEL,
        0,
        OP_COST.settle,
      );
      return;

    case "heap":
      writeRow(
        chunk,
        index,
        TRACE_KIND.heap,
        SENTINEL,
        SENTINEL,
        HEAP_OP[event.op],
        event.cmps,
        SENTINEL,
        0,
        event.cmps * OP_COST.comparison,
      );
      return;

    case "pivot":
      writeRow(
        chunk,
        index,
        TRACE_KIND.pivot,
        event.v,
        SENTINEL,
        event.level,
        SENTINEL,
        SENTINEL,
        0,
        OP_COST.pivot,
      );
      return;

    case "batch":
      writeRow(
        chunk,
        index,
        TRACE_KIND.batch,
        SENTINEL,
        SENTINEL,
        BATCH_PHASE[event.phase],
        event.level,
        event.size,
        0,
        OP_COST.batch,
      );
      return;

    case "recurse":
      writeRow(
        chunk,
        index,
        TRACE_KIND.recurse,
        SENTINEL,
        SENTINEL,
        RECURSE_DIR[event.dir],
        event.level,
        SENTINEL,
        event.bound,
        OP_COST.recurse,
      );
      return;

    case "forest":
      writeRow(
        chunk,
        index,
        TRACE_KIND.forest,
        SENTINEL,
        event.e,
        FOREST_OP[event.op],
        event.tree,
        SENTINEL,
        0,
        OP_COST.forest,
      );
      return;

    case "dstruct":
      writeRow(
        chunk,
        index,
        TRACE_KIND.dstruct,
        SENTINEL,
        SENTINEL,
        DSTRUCT_OP[event.op],
        event.n,
        event.cmps,
        0,
        event.cmps * OP_COST.comparison,
      );
      return;
  }
}

/**
 * {@link encode} plus payload and index checks. Used by unit tests; the
 * writer hot path calls {@link encode} directly.
 */
export function encodeChecked(chunk: TraceChunk, index: number, event: TraceEvent): void {
  assertEncodeIndex(chunk, index);
  validateEvent(event);
  encode(chunk, index, event);
}

/**
 * Reconstruct one {@link TraceEvent} from row `index` of a {@link TraceChunk}.
 */
export function decodeAt(chunk: TraceChunk, index: number): TraceEvent {
  assertDecodeIndex(chunk, index);

  const kind = chunk.kind[index];
  switch (kind) {
    case TRACE_KIND.relax: {
      const improvedRaw = chunk.aux0[index];
      if (improvedRaw !== 0 && improvedRaw !== 1) {
        throw new Error(`relax improved flag must be 0 or 1 at index ${index}, got ${improvedRaw}`);
      }
      return {
        k: "relax",
        e: chunk.edge[index],
        improved: improvedRaw === 1,
        cost: 1,
      };
    }

    case TRACE_KIND.settle: {
      const order = chunk.aux0[index];
      assertNonNegativeInteger(`settle order at index ${index}`, order);
      return {
        k: "settle",
        v: chunk.vertex[index],
        order,
        cost: 1,
      };
    }

    case TRACE_KIND.heap: {
      const cmps = chunk.aux1[index];
      assertNonNegativeInteger(`heap cmps at index ${index}`, cmps);
      return {
        k: "heap",
        op: heapOpFromCode(chunk.aux0[index]),
        cmps,
      };
    }

    case TRACE_KIND.pivot: {
      const level = chunk.aux0[index];
      assertNonNegativeInteger(`pivot level at index ${index}`, level);
      return {
        k: "pivot",
        v: chunk.vertex[index],
        level,
      };
    }

    case TRACE_KIND.batch: {
      const level = chunk.aux1[index];
      const size = chunk.aux2[index];
      assertNonNegativeInteger(`batch level at index ${index}`, level);
      assertNonNegativeInteger(`batch size at index ${index}`, size);
      return {
        k: "batch",
        phase: batchPhaseFromCode(chunk.aux0[index]),
        level,
        size,
      };
    }

    case TRACE_KIND.recurse: {
      const level = chunk.aux1[index];
      const bound = chunk.auxF[index];
      assertNonNegativeInteger(`recurse level at index ${index}`, level);
      assertBound(`recurse bound at index ${index}`, bound);
      return {
        k: "recurse",
        dir: recurseDirFromCode(chunk.aux0[index]),
        level,
        bound,
      };
    }

    case TRACE_KIND.forest: {
      const tree = chunk.aux1[index];
      assertNonNegativeInteger(`forest tree at index ${index}`, tree);
      return {
        k: "forest",
        op: forestOpFromCode(chunk.aux0[index]),
        e: chunk.edge[index],
        tree,
      };
    }

    case TRACE_KIND.dstruct: {
      const n = chunk.aux1[index];
      const cmps = chunk.aux2[index];
      assertNonNegativeInteger(`dstruct n at index ${index}`, n);
      assertNonNegativeInteger(`dstruct cmps at index ${index}`, cmps);
      return {
        k: "dstruct",
        op: dstructOpFromCode(chunk.aux0[index]),
        n,
        cmps,
      };
    }

    default:
      throw new Error(`unknown trace kind ${kind} at index ${index}`);
  }
}

/**
 * Decode every filled row of a chunk into a JS array (test helper; allocates).
 */
export function decodeChunk(chunk: TraceChunk): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (let i = 0; i < chunk.count; i += 1) {
    events.push(decodeAt(chunk, i));
  }
  return events;
}

/**
 * Sum billed work and count events by kind.
 */
export function tally(chunk: TraceChunk): TraceTally {
  const result: TraceTally = {
    work: 0,
    relaxations: 0,
    heapOps: 0,
    dstructOps: 0,
    settles: 0,
    pivots: 0,
    batches: 0,
    recurses: 0,
    forests: 0,
  };

  for (let i = 0; i < chunk.count; i += 1) {
    const billed = chunk.cost[i];
    if (billed === undefined) {
      throw new Error(`missing cost at index ${i}`);
    }
    result.work += billed;
    switch (chunk.kind[i]) {
      case TRACE_KIND.relax:
        result.relaxations += 1;
        break;
      case TRACE_KIND.settle:
        result.settles += 1;
        break;
      case TRACE_KIND.heap:
        result.heapOps += 1;
        break;
      case TRACE_KIND.pivot:
        result.pivots += 1;
        break;
      case TRACE_KIND.batch:
        result.batches += 1;
        break;
      case TRACE_KIND.recurse:
        result.recurses += 1;
        break;
      case TRACE_KIND.forest:
        result.forests += 1;
        break;
      case TRACE_KIND.dstruct:
        result.dstructOps += 1;
        break;
    }
  }

  return result;
}

/**
 * Alias for {@link tally} — scans the `cost` column and kind counts.
 */
export function scanCosts(chunk: TraceChunk): TraceTally {
  return tally(chunk);
}

/**
 * Allocate an empty trace slab with the given row capacity.
 */
export function allocateChunk(capacity: number): TraceChunk {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`allocateChunk capacity must be an integer >= 1, got ${capacity}`);
  }

  return {
    count: 0,
    kind: new Uint8Array(capacity),
    vertex: new Int32Array(capacity),
    edge: new Int32Array(capacity),
    aux0: new Int32Array(capacity),
    aux1: new Int32Array(capacity),
    aux2: new Int32Array(capacity),
    auxF: new Float64Array(capacity),
    cost: new Uint32Array(capacity),
  };
}

/**
 * View the first `count` filled rows of a chunk. Column arrays are shared
 * with the source chunk; only the `count` field is narrowed.
 */
export function sliceChunk(chunk: TraceChunk, count: number): TraceChunk {
  if (!Number.isInteger(count) || count < 0 || count > chunk.count) {
    throw new Error(`sliceChunk count must be an integer in [0, ${chunk.count}], got ${count}`);
  }

  return {
    count,
    kind: chunk.kind,
    vertex: chunk.vertex,
    edge: chunk.edge,
    aux0: chunk.aux0,
    aux1: chunk.aux1,
    aux2: chunk.aux2,
    auxF: chunk.auxF,
    cost: chunk.cost,
  };
}

/**
 * Unique backing {@link ArrayBuffer}s for postMessage transferables.
 * Deduplicates when several typed arrays share one buffer.
 */
export function transferables(chunk: TraceChunk): ArrayBuffer[] {
  const buffers = [
    chunk.kind.buffer,
    chunk.vertex.buffer,
    chunk.edge.buffer,
    chunk.aux0.buffer,
    chunk.aux1.buffer,
    chunk.aux2.buffer,
    chunk.auxF.buffer,
    chunk.cost.buffer,
  ];

  const unique: ArrayBuffer[] = [];
  for (const buffer of buffers) {
    if (!unique.includes(buffer)) {
      unique.push(buffer);
    }
  }
  return unique;
}

/**
 * Append-only trace encoder with fixed-size SoA slabs (not a true ring:
 * a filled slab is rotated out so its buffers can be transferred).
 *
 * Each slab owns arrays of length `capacity`; {@link TraceChunk.count} tracks
 * filled rows. Full slabs are rotated onto a completed list. A partial flush
 * copies columns to exact length so transferables are not full-capacity buffers.
 */
export class TraceWriter {
  private readonly capacity: number;
  private slab: TraceChunk;
  /** Filled rows in `slab`. Kept off the chunk so append does not allocate. */
  private filled = 0;
  private completed: TraceChunk[] = [];

  /**
   * @param chunkCapacity - Rows per slab; defaults to {@link DEFAULT_CHUNK_CAPACITY}.
   */
  constructor(chunkCapacity?: number) {
    const capacity = chunkCapacity ?? DEFAULT_CHUNK_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`TraceWriter chunkCapacity must be an integer >= 1, got ${capacity}`);
    }
    this.capacity = capacity;
    this.slab = allocateChunk(capacity);
  }

  /**
   * Encode one event at the current write cursor. Rotates the slab when full.
   */
  append(event: TraceEvent): void {
    encode(this.slab, this.filled, event);
    this.filled += 1;
    if (this.filled === this.capacity) {
      this.completed.push(this.freezeSlab(this.capacity));
      this.slab = allocateChunk(this.capacity);
      this.filled = 0;
    }
  }

  /**
   * Push the current partial slab onto the completed list when non-empty,
   * then allocate a fresh empty slab.
   */
  flush(): void {
    if (this.filled > 0) {
      this.completed.push(this.freezeSlab(this.filled));
      this.slab = allocateChunk(this.capacity);
      this.filled = 0;
    }
  }

  /**
   * Return rotated full slabs without flushing the current partial slab.
   * A subsequent takeChunks() still flushes the remainder.
   * Does not detach buffers.
   */
  drainCompleted(): TraceChunk[] {
    if (this.completed.length === 0) {
      return [];
    }
    const result = this.completed;
    this.completed = [];
    return result;
  }

  /**
   * Flush, return all completed chunks, and clear the completed list.
   * Does not detach buffers. A second call returns only chunks from new appends.
   */
  takeChunks(): TraceChunk[] {
    this.flush();
    const result = this.completed;
    this.completed = [];
    return result;
  }

  /**
   * Snapshot the current slab at `count` filled rows.
   *
   * Full slabs (`count === capacity`) return column arrays by reference for
   * zero-copy transfer. Partial slabs copy each column with `.slice(0, count)`
   * so backing buffers match the filled row count.
   */
  private freezeSlab(count: number): TraceChunk {
    if (count === this.capacity) {
      return {
        count,
        kind: this.slab.kind,
        vertex: this.slab.vertex,
        edge: this.slab.edge,
        aux0: this.slab.aux0,
        aux1: this.slab.aux1,
        aux2: this.slab.aux2,
        auxF: this.slab.auxF,
        cost: this.slab.cost,
      };
    }

    return {
      count,
      kind: this.slab.kind.slice(0, count),
      vertex: this.slab.vertex.slice(0, count),
      edge: this.slab.edge.slice(0, count),
      aux0: this.slab.aux0.slice(0, count),
      aux1: this.slab.aux1.slice(0, count),
      aux2: this.slab.aux2.slice(0, count),
      auxF: this.slab.auxF.slice(0, count),
      cost: this.slab.cost.slice(0, count),
    };
  }
}
