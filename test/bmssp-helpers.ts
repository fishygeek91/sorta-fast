/**
 * Shared helpers for BMSSP unit, golden-trace, and audit tests (issues #9/#10/#11).
 *
 * `drainFindPivots` collects trace events and the generator's final
 * {@link FindPivotsResult}. `drainBmsspRun` does the same for the full BMSSP
 * lane. `NaiveD` is a sorted-map reference for Lemma 3.3 differential tests
 * against {@link BlockListD}. `auditFindPivotsTrace` checks pivot-set
 * consistency and trace shape. `auditBmsspDistancesFromTrace` and
 * `assertBoundedSettleInvariant` replay BMSSP traces for distance audit and
 * bounded-settle checks — do not reuse Dijkstra audit helpers.
 */

import { type DPair, type DOpResult, type DPullResult } from "../src/core/bmssp/dstructure.ts";
import { run, type BmsspResult } from "../src/core/bmssp/bmssp.ts";
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
 * Run BMSSP to completion, collecting all trace events and the final result.
 *
 * @throws If the generator finishes without returning a result object.
 */
export function drainBmsspRun(
  graph: Graph,
  source: VertexId,
): { events: TraceEvent[]; result: BmsspResult } {
  const events: TraceEvent[] = [];
  const gen = run(graph, source);

  for (;;) {
    const step = gen.next();
    if (step.done) {
      if (step.value === undefined) {
        throw new Error("bmssp run finished without returning a result");
      }
      return { events, result: step.value };
    }
    events.push(step.value);
  }
}

/**
 * Re-derive shortest-path distances by replaying improving relax events only.
 *
 * Initializes `distances[source] = 0` and all other entries to `Infinity`, then
 * walks the trace in order. For each relax with `improved === true`, sets
 * `distances[to] = distances[from] + weight` using CSR columns
 * (`offsets`, `targets`, `weights`) and the event's edge index `e`.
 *
 * Does **not** require settle-before-relax ordering or settled-vertex relaxations.
 * BMSSP may emit an improving relax from a vertex before that vertex is settled,
 * and may improve the same target multiple times as bounds tighten — the replay
 * must apply every `improved === true` relax in trace order using the distance
 * of the tail vertex **at replay time**, not a final settled distance.
 *
 * Do not reuse {@link auditDistancesFromTrace} from `dijkstra-helpers.ts`: that
 * helper's contract assumes Dijkstra only relaxes from settled vertices, so its
 * documentation and test pairing are Dijkstra-specific even though the loop shape
 * looks similar. BMSSP fuzz/golden tests must import this function instead.
 *
 * @throws If `source` is out of range or CSR slots are missing.
 */
export function auditBmsspDistancesFromTrace(
  graph: Graph,
  events: readonly TraceEvent[],
  source: VertexId,
): Float64Array {
  const { n, m, offsets, targets, weights } = graph;

  if (!Number.isInteger(source) || source < 0 || source >= n) {
    throw new Error(`source must be an integer in [0, ${n}), got ${String(source)}`);
  }

  const distances = new Float64Array(n);
  distances.fill(Number.POSITIVE_INFINITY);
  distances[source] = 0;

  const tails = new Uint32Array(m);
  for (let v = 0; v < n; v += 1) {
    const arcStart = offsets[v];
    const arcEnd = offsets[v + 1];
    if (arcStart === undefined || arcEnd === undefined) {
      throw new Error(`offsets for vertex ${v} missing`);
    }
    for (let e = arcStart; e < arcEnd; e += 1) {
      tails[e] = v;
    }
  }

  for (const event of events) {
    if (event.k !== "relax" || !event.improved) {
      continue;
    }

    const e = event.e;
    const from = tails[e];
    const to = targets[e];
    const weight = weights[e];
    if (from === undefined || to === undefined || weight === undefined) {
      throw new Error(`CSR arc ${e} missing`);
    }

    const distFrom = distances[from];
    if (distFrom === undefined) {
      throw new Error(`distances[${from}] missing`);
    }

    distances[to] = distFrom + weight;
  }

  return distances;
}

/**
 * Check the BMSSP bounded-settle invariant on a trace and distance array.
 *
 * Maintains a stack of active distance upper bounds from `recurse` events:
 * `dir: "in"` pushes `bound`, `dir: "out"` pops. On each `settle` event,
 * `distances[v] >` the stack top is a violation. Paper Assumption 2.1
 * (unique path lengths) gives strict `dist < B`; with ties, D's (value, key)
 * order can settle at `dist === B` for keys below Pull's pair cut, and recurse
 * events only carry the scalar bound. The top-level call pushes `Infinity`.
 *
 * Also reports mismatched recurse nesting (out without in, or unclosed stack at
 * end) and settles seen with an empty bound stack.
 *
 * @returns Empty array when all checks pass; otherwise human-readable violation messages.
 */
export function assertBoundedSettleInvariant(
  events: readonly TraceEvent[],
  distances: Float64Array,
): string[] {
  const violations: string[] = [];
  const boundStack: number[] = [];

  for (const event of events) {
    if (event.k === "recurse") {
      if (event.dir === "in") {
        boundStack.push(event.bound);
      } else if (boundStack.length === 0) {
        violations.push("recurse out without matching recurse in");
      } else {
        boundStack.pop();
      }
      continue;
    }

    if (event.k !== "settle") {
      continue;
    }

    const v = event.v;
    if (boundStack.length === 0) {
      violations.push(`settle vertex ${v} with empty recurse stack`);
      continue;
    }

    const bound = boundStack[boundStack.length - 1];
    if (bound === undefined) {
      violations.push(`settle vertex ${v} with missing active bound`);
      continue;
    }

    const dv = distances[v];
    if (dv === undefined) {
      violations.push(`settle vertex ${v}: distances[${v}] missing`);
      continue;
    }

    if (dv > bound) {
      violations.push(
        `settle vertex ${v}: distance ${String(dv)} is greater than bound ${String(bound)}`,
      );
    }
  }

  if (boundStack.length !== 0) {
    violations.push(`unclosed recurse nesting: depth ${boundStack.length} at end of trace`);
  }

  return violations;
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

/** Active recurse frame: recursion level and distance upper bound B. */
export type RecurseFrame = { level: number; bound: number };

/**
 * Compute 2^exp with the same overflow rules as {@link blockCapacity} in `bmssp.ts`.
 */
function pow2(exp: number): number {
  if (!Number.isInteger(exp) || exp < 0) {
    throw new Error(`pow2 exp must be a non-negative integer, got ${String(exp)}`);
  }
  if (exp === 0) {
    return 1;
  }
  if (exp < 31) {
    return 1 << exp;
  }
  if (exp < 53) {
    return 2 ** exp;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Detect heap trace events emitted outside level-0 recursion (base mini-Dijkstra).
 *
 * Walks the trace maintaining a stack of active recurse levels (`in` pushes,
 * `out` pops). Any `heap` event while the stack is empty or the top level is
 * not `0` is a violation — Algorithm 3 uses the heap only in the base case.
 *
 * @returns Empty array when all heap ops occur at level 0; otherwise violation messages.
 */
export function heapEventsOutsideLevelZero(events: readonly TraceEvent[]): string[] {
  const violations: string[] = [];
  const levelStack: number[] = [];

  for (const event of events) {
    if (event.k === "recurse") {
      if (event.dir === "in") {
        levelStack.push(event.level);
      } else if (levelStack.length === 0) {
        violations.push("recurse out without matching recurse in");
      } else {
        levelStack.pop();
      }
      continue;
    }

    if (event.k !== "heap") {
      continue;
    }

    const top = levelStack[levelStack.length - 1];
    if (levelStack.length === 0) {
      violations.push(`heap ${event.op} with empty recurse stack`);
    } else if (top !== 0) {
      violations.push(`heap ${event.op} at level ${String(top)} (expected level 0 only)`);
    }
  }

  if (levelStack.length !== 0) {
    violations.push(`unclosed recurse nesting: depth ${levelStack.length} at end of trace`);
  }

  return violations;
}

/**
 * Detect D-structure Pull events whose operand size exceeds M = 2^{(l-1)·t}.
 *
 * Walks the trace with a recurse level stack. On each `dstruct` pull, the active
 * level is the stack top; pulls must occur only at l ≥ 1 with n ≤ M.
 *
 * @param events - BMSSP trace events from a full `run`.
 * @param t - Block parameter t from {@link bmsspParams}.
 * @returns Empty array when every pull respects the level-dependent cap.
 */
export function pullSizeViolations(events: readonly TraceEvent[], t: number): string[] {
  const violations: string[] = [];
  const levelStack: number[] = [];

  for (const event of events) {
    if (event.k === "recurse") {
      if (event.dir === "in") {
        levelStack.push(event.level);
      } else if (levelStack.length === 0) {
        violations.push("recurse out without matching recurse in");
      } else {
        levelStack.pop();
      }
      continue;
    }

    if (event.k !== "dstruct" || event.op !== "pull") {
      continue;
    }

    if (levelStack.length === 0) {
      violations.push(`pull n=${event.n} with empty recurse stack`);
      continue;
    }

    const level = levelStack[levelStack.length - 1];
    if (level === undefined) {
      violations.push(`pull n=${event.n} with missing active level`);
      continue;
    }

    if (level < 1) {
      violations.push(`pull n=${event.n} at level ${String(level)} (pulls only at l >= 1)`);
      continue;
    }

    const exp = (level - 1) * t;
    const M = pow2(exp);
    if (event.n > M) {
      violations.push(`pull n=${event.n} at level ${String(level)} exceeds M=${String(M)}`);
    }
  }

  if (levelStack.length !== 0) {
    violations.push(`unclosed recurse nesting: depth ${levelStack.length} at end of trace`);
  }

  return violations;
}

/**
 * Whether any recurse `out` event reports B′ strictly less than its matching `in` bound.
 *
 * Partial exit (Algorithm 3 step 6 / Lemma 3.9) tightens B′ below the call's input B.
 * Finite B′ &lt; Infinity counts as partial when the matching `in` bound is Infinity.
 *
 * @returns `true` when at least one paired recurse exit has `out.bound < in.bound`.
 */
export function hasPartialRecurseExit(events: readonly TraceEvent[]): boolean {
  const boundStack: number[] = [];

  for (const event of events) {
    if (event.k !== "recurse") {
      continue;
    }

    if (event.dir === "in") {
      boundStack.push(event.bound);
      continue;
    }

    if (boundStack.length === 0) {
      continue;
    }

    const inBound = boundStack.pop();
    if (inBound === undefined) {
      continue;
    }

    const outBound = event.bound;
    if (outBound < inBound) {
      return true;
    }
  }

  return false;
}
