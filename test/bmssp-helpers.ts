/**
 * Shared helpers for BMSSP unit, golden-trace, and audit tests (issues #9/#10).
 *
 * `drainFindPivots` collects trace events and the generator's final
 * {@link FindPivotsResult}. `NaiveD` is a sorted-map reference for Lemma 3.3
 * differential tests against {@link BlockListD}. `auditFindPivotsTrace` checks
 * pivot-set consistency and trace shape — do not reuse Dijkstra audit helpers.
 */

import { type DPair, type DOpResult, type DPullResult } from "../src/core/bmssp/dstructure.ts";
import { findPivots, type FindPivotsResult } from "../src/core/bmssp/findPivots.ts";
import { type Graph, type VertexId } from "../src/core/graph.ts";
import { type TraceEvent } from "../src/core/trace.ts";

/**
 * Run FindPivots to completion, collecting all trace events and the final result.
 *
 * @throws If the generator finishes without returning a result object.
 */
export function drainFindPivots(
  graph: Graph,
  B: number,
  S: readonly VertexId[],
  k: number,
  dist: Float64Array,
  level: number,
): { events: TraceEvent[]; result: FindPivotsResult } {
  const events: TraceEvent[] = [];
  const gen = findPivots(graph, B, S, k, dist, level);

  for (;;) {
    const step = gen.next();
    if (step.done) {
      if (step.value === undefined) {
        throw new Error("findPivots finished without returning a result");
      }
      return { events, result: step.value };
    }
    events.push(step.value);
  }
}

/**
 * Naive sorted-map reference for Lemma 3.3 data structure D.
 *
 * Observable Pull results (keys and bound) must match {@link BlockListD}; comparison
 * counts are not modeled — tests compare keys and bound only.
 */
export class NaiveD {
  private readonly M: number;
  private readonly B: number;
  private readonly map: Map<number, number>;

  /**
   * @param M - Maximum keys returned by Pull when |D| > M.
   * @param B - Global upper bound when D is empty or fully drained.
   */
  constructor(M: number, B: number) {
    this.M = M;
    this.B = B;
    this.map = new Map();
  }

  /** Number of unique keys currently stored. */
  get size(): number {
    return this.map.size;
  }

  /**
   * Insert key with value; keep the strictly smaller value per key.
   *
   * No-op when an existing value is already ≤ the new value.
   */
  insert(key: number, value: number): DOpResult {
    const existing = this.map.get(key);
    if (existing !== undefined && value >= existing) {
      return { n: 1, cmps: 0 };
    }
    this.map.set(key, value);
    return { n: 1, cmps: 0 };
  }

  /**
   * Batch-prepend pairs; per key keep the minimum value (same as insert).
   *
   * Operand size `n` is the raw pair count, not the collapsed unique-key count.
   */
  batchPrepend(pairs: readonly DPair[]): DOpResult {
    const operandSize = pairs.length;
    for (const pair of pairs) {
      const existing = this.map.get(pair.key);
      if (existing === undefined || pair.value < existing) {
        this.map.set(pair.key, pair.value);
      }
    }
    return { n: operandSize, cmps: 0 };
  }

  /**
   * Pull the M smallest keys (or all keys when |D| ≤ M).
   *
   * Returned keys are sorted by id ascending.
   */
  pull(): DPullResult {
    const totalSize = this.map.size;
    if (totalSize === 0) {
      return { keys: [], bound: this.B, n: 0, cmps: 0 };
    }

    if (totalSize <= this.M) {
      const keys = this.sortedKeys();
      this.map.clear();
      return { keys, bound: this.B, n: keys.length, cmps: 0 };
    }

    const entries = this.sortedEntries();
    const selected = entries.slice(0, this.M);
    const keys = selected.map((entry) => entry.key).sort((a, b) => a - b);

    for (const entry of selected) {
      this.map.delete(entry.key);
    }

    const bound = this.minRemainingValue();
    return { keys, bound, n: keys.length, cmps: 0 };
  }

  /** All keys in ascending id order. */
  private sortedKeys(): number[] {
    const keys: number[] = [];
    for (const key of this.map.keys()) {
      keys.push(key);
    }
    keys.sort((a, b) => a - b);
    return keys;
  }

  /** Entries sorted by (value asc, key asc). */
  private sortedEntries(): { key: number; value: number }[] {
    const entries: { key: number; value: number }[] = [];
    for (const [key, value] of this.map.entries()) {
      entries.push({ key, value });
    }
    entries.sort((a, b) => {
      if (a.value !== b.value) {
        return a.value - b.value;
      }
      return a.key - b.key;
    });
    return entries;
  }

  /** Minimum remaining value, or B when the map is empty. */
  private minRemainingValue(): number {
    let min: number | undefined;
    for (const value of this.map.values()) {
      if (min === undefined || value < min) {
        min = value;
      }
    }
    if (min === undefined) {
      return this.B;
    }
    return min;
  }
}

/**
 * Audit a FindPivots trace for structural consistency with its result.
 *
 * @returns Empty array when all checks pass; otherwise human-readable violation messages.
 */
export function auditFindPivotsTrace(
  graph: Graph,
  events: readonly TraceEvent[],
  result: FindPivotsResult,
): string[] {
  const violations: string[] = [];

  const pivotFromTrace = new Set<VertexId>();
  for (const event of events) {
    if (event.k === "pivot") {
      pivotFromTrace.add(event.v);
    }
  }

  const pivotFromResult = new Set<VertexId>(result.P);
  if (pivotFromTrace.size !== pivotFromResult.size) {
    violations.push(
      `pivot count mismatch: trace has ${pivotFromTrace.size}, result.P has ${pivotFromResult.size}`,
    );
  }
  for (const v of pivotFromTrace) {
    if (!pivotFromResult.has(v)) {
      violations.push(`pivot vertex ${v} in trace but not in result.P`);
    }
  }
  for (const v of pivotFromResult) {
    if (!pivotFromTrace.has(v)) {
      violations.push(`pivot vertex ${v} in result.P but not in trace`);
    }
  }

  for (const event of events) {
    if (event.k !== "relax") {
      continue;
    }
    const e = event.e;
    if (!Number.isInteger(e) || e < 0 || e >= graph.m) {
      violations.push(`relax edge index ${String(e)} is not an integer in [0, ${graph.m})`);
    }
  }

  let batchDepth = 0;
  let batchStarts = 0;
  let batchEnds = 0;

  for (const event of events) {
    if (event.k !== "batch") {
      continue;
    }
    if (event.phase === "start") {
      batchStarts += 1;
      batchDepth += 1;
    } else {
      batchEnds += 1;
      if (batchDepth === 0) {
        violations.push("batch end without matching batch start");
      } else {
        batchDepth -= 1;
      }
    }
  }

  if (batchDepth !== 0) {
    violations.push(`unclosed batch nesting: depth ${batchDepth} at end of trace`);
  }
  if (batchStarts !== batchEnds) {
    violations.push(`batch start/end count mismatch: ${batchStarts} starts, ${batchEnds} ends`);
  }

  return violations;
}
