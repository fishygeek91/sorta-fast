/**
 * Shared helpers for DMSY unit, golden-trace, and audit tests (issue #26).
 *
 * `drainDmsyRun` collects trace events and the public {@link run} result on the
 * original gallery graph. `drainDmsyInstrumented` runs {@link runInstrumented}
 * for lex tie-break checks against the live {@link DistanceStore}.
 * `auditDmsyLengthsFromTrace` replays improving relax events on the original CSR.
 * `assertDmsyBoundedSettle` and `assertDmsyLexTieBreak` validate trace invariants.
 */

import {
  run,
  runInstrumented,
  type DmsyInstrumentedResult,
  type DmsyParams,
  type DmsyResult,
} from "../src/core/dmsy/dmsy.ts";
import { compareLabels, labelAt, type DistanceLabel } from "../src/core/dmsy/forest.ts";
import { type Graph, type VertexId } from "../src/core/graph.ts";
import { SENTINEL, type TraceEvent } from "../src/core/trace.ts";

/**
 * Run public DMSY to completion, collecting trace events and the final result.
 *
 * @param params - Optional k/t parameters forwarded to {@link run}.
 * @throws If the generator finishes without returning a result object.
 */
export function drainDmsyRun(
  graph: Graph,
  source: VertexId,
  params?: DmsyParams,
): { events: TraceEvent[]; result: DmsyResult } {
  const events: TraceEvent[] = [];
  const gen = run(graph, source, params);

  for (;;) {
    const step = gen.next();
    if (step.done) {
      if (step.value === undefined) {
        throw new Error("dmsy run finished without returning a result");
      }
      return { events, result: step.value };
    }
    events.push(step.value);
  }
}

/**
 * Run instrumented DMSY to completion on the graph passed in (identity or reduced).
 *
 * @param params - Optional k/t parameters forwarded to {@link runInstrumented}.
 * @throws If the generator finishes without returning a result object.
 */
export function drainDmsyInstrumented(
  graph: Graph,
  source: VertexId,
  params?: DmsyParams,
): { events: TraceEvent[]; result: DmsyInstrumentedResult } {
  const events: TraceEvent[] = [];
  const gen = runInstrumented(graph, source, params);

  for (;;) {
    const step = gen.next();
    if (step.done) {
      if (step.value === undefined) {
        throw new Error("dmsy runInstrumented finished without returning a result");
      }
      return { events, result: step.value };
    }
    events.push(step.value);
  }
}

/**
 * Re-derive shortest-path lengths by replaying improving relax events only.
 *
 * Initializes `distances[source] = 0` and all other entries to `Infinity`, then
 * walks the trace in order. For each relax with `improved === true`, sets
 * `distances[to] = distances[from] + weight` using CSR columns
 * (`offsets`, `targets`, `weights`) and the event's edge index `e`.
 *
 * This is the **public-run audit** on un-mapped events against the original CSR.
 * Do not import {@link auditDistancesFromTrace} from `dijkstra-helpers.ts`: that
 * helper assumes Dijkstra only relaxes from settled vertices.
 *
 * @throws If `source` is out of range or CSR slots are missing.
 */
export function auditDmsyLengthsFromTrace(
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
 * Check the DMSY bounded-settle invariant on a trace and distance array.
 *
 * Maintains a stack of active scalar bounds from `recurse` events (`bound` is
 * the length component of the call's distance upper bound): `dir: "in"` pushes,
 * `dir: "out"` pops. On each `settle` event, `distances[v] >` the stack top is
 * a violation. The top-level call pushes `Infinity`.
 *
 * Also reports mismatched recurse nesting and settles with an empty bound stack.
 *
 * @returns Empty array when all checks pass; otherwise human-readable violation messages.
 */
export function assertDmsyBoundedSettle(
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
 * Whether a label matches the unreachable initialization ⟨Infinity, 0, v, SENTINEL⟩.
 */
function isUnreachableInitLabel(label: DistanceLabel, v: VertexId): boolean {
  return (
    label.length === Number.POSITIVE_INFINITY &&
    label.nEdges === 0 &&
    label.curr === v &&
    label.pred === SENTINEL
  );
}

/**
 * Check DMSY lexicographic labels against the instrumented distance store.
 *
 * `recurse.bound` is only the length component of the call bound (schema is a
 * number). A synthetic ⟨bound, 0, SENTINEL, SENTINEL⟩ is **not** the real 4-tuple
 * B — settling with the same length and more hops is valid when the live B has
 * a larger nEdges/curr/pred. The algorithm already throws in `emitSettle` if
 * `compareLabels(label, B) !== "<"` against the live bound.
 *
 * This checker verifies store shape: settled `curr === v` and finite length;
 * source is ⟨0, 0, s, SENTINEL⟩; unreachable stay ⟨Infinity, 0, v, SENTINEL⟩;
 * `compareLabels` is a total order on the settled set (antisymmetry).
 *
 * @returns Empty array when all checks pass; otherwise human-readable violation messages.
 */
export function assertDmsyLexTieBreak(
  graph: Graph,
  source: VertexId,
  params?: DmsyParams,
): string[] {
  const violations: string[] = [];
  const { events, result } = drainDmsyInstrumented(graph, source, params);
  const { dist, distances } = result;

  const sourceLabel = labelAt(dist, source);
  if (
    sourceLabel.length !== 0 ||
    sourceLabel.nEdges !== 0 ||
    sourceLabel.curr !== source ||
    sourceLabel.pred !== SENTINEL
  ) {
    violations.push(
      `source ${source}: expected ⟨0, 0, ${source}, SENTINEL⟩, got ${JSON.stringify(sourceLabel)}`,
    );
  }

  const settled: VertexId[] = [];
  for (const event of events) {
    if (event.k !== "settle") {
      continue;
    }
    const v = event.v;
    const label = labelAt(dist, v);
    if (label.curr !== v) {
      violations.push(`settle vertex ${v}: label.curr is ${label.curr}, expected ${v}`);
    }
    if (!Number.isFinite(label.length)) {
      violations.push(`settle vertex ${v}: label length is not finite`);
    }
    if (label.pred !== SENTINEL && (label.pred < 0 || label.pred >= graph.n)) {
      violations.push(`settle vertex ${v}: pred ${label.pred} is out of range`);
    }
    settled.push(v);
  }

  for (let i = 0; i < settled.length; i += 1) {
    const a = settled[i];
    if (a === undefined) {
      throw new Error(`settled[${i}] missing`);
    }
    const labelA = labelAt(dist, a);
    if (compareLabels(labelA, labelA) !== "=") {
      violations.push(`compareLabels is not reflexive at vertex ${a}`);
    }
    for (let j = i + 1; j < settled.length; j += 1) {
      const b = settled[j];
      if (b === undefined) {
        throw new Error(`settled[${j}] missing`);
      }
      const labelB = labelAt(dist, b);
      const ab = compareLabels(labelA, labelB);
      const ba = compareLabels(labelB, labelA);
      if (ab === "=" && ba !== "=") {
        violations.push(`compareLabels antisymmetry failed for ${a} vs ${b}`);
      }
      if (ab === "<" && ba !== ">") {
        violations.push(`compareLabels inversion failed for ${a} < ${b}`);
      }
      if (ab === ">" && ba !== "<") {
        violations.push(`compareLabels inversion failed for ${a} > ${b}`);
      }
    }
  }

  for (let v = 0; v < graph.n; v += 1) {
    const distV = distances[v];
    if (distV === undefined) {
      violations.push(`distances[${v}] missing`);
      continue;
    }
    if (distV !== Number.POSITIVE_INFINITY) {
      continue;
    }
    const label = labelAt(dist, v);
    if (!isUnreachableInitLabel(label, v)) {
      violations.push(
        `unreachable vertex ${v}: expected ⟨Infinity, 0, ${v}, SENTINEL⟩, got ${JSON.stringify(label)}`,
      );
    }
  }

  return violations;
}
