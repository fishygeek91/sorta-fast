/**
 * Shared helpers for DMSY unit, golden-trace, and audit tests (issue #26).
 *
 * `drainDmsyRun` collects trace events and the public {@link run} result on the
 * original gallery graph. `drainDmsyInstrumented` runs {@link runInstrumented}
 * for lex tie-break checks against the live {@link DistanceStore}.
 * `auditDmsyLengthsFromTrace` replays improving relax events on the original CSR.
 * `assertDmsyBoundedSettle` and `assertDmsyLexTieBreak` validate trace invariants.
 * `assertDmsySettleFinality` classifies post-settle improving relaxes by 4-tuple label replay.
 */

import {
  run,
  runInstrumented,
  type DmsyInstrumentedResult,
  type DmsyParams,
  type DmsyResult,
} from "../src/core/dmsy/dmsy.ts";
import {
  degreeReduce,
  mapBackDistances,
  mapBackPredecessors,
  reducedSource,
} from "../src/core/dmsy/degreeReduce.ts";
import {
  addWeight,
  compareLabels,
  createDistanceStore,
  labelAt,
  type DistanceLabel,
  type DistanceStore,
} from "../src/core/dmsy/forest.ts";
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

/** Classification of a post-settle improving relax relative to the settled label. */
export type DmsySettleImproveClass = "strict-length" | "lex-only" | "equal-label";

/** Emission region derived from recurse/batch context at the finding. */
export type DmsySettleImproveRegion = "level-0" | "after-child" | "in-level";

/** One post-settle improving relax witness from {@link assertDmsySettleFinality}. */
export type DmsySettleImproveFinding = {
  vertex: VertexId;
  edge: number;
  klass: DmsySettleImproveClass;
  settleOrder: number;
  region: DmsySettleImproveRegion;
  recurseDepth: number;
  activeLevel: number;
  settleLabel: DistanceLabel;
  candidateLabel: DistanceLabel;
};

/** Report from {@link assertDmsySettleFinality}: structured findings plus human messages. */
export type DmsySettleFinalityReport = {
  findings: DmsySettleImproveFinding[];
  messages: string[];
};

type RecurseFrame = {
  level: number;
  bound: number;
};

/**
 * Format a distance label as ⟨length, nEdges, curr, pred⟩ for violation messages.
 */
function formatDistanceLabel(label: DistanceLabel): string {
  return `⟨${String(label.length)}, ${String(label.nEdges)}, ${String(label.curr)}, ${String(label.pred)}⟩`;
}

/**
 * Copy a label into a {@link DistanceStore} at vertex `v` (columns only; no export of writeLabel).
 */
function applyLabel(store: DistanceStore, v: VertexId, label: DistanceLabel): void {
  store.length[v] = label.length;
  store.nEdges[v] = label.nEdges;
  store.curr[v] = label.curr;
  store.pred[v] = label.pred;
}

/**
 * Shallow copy of a {@link DistanceLabel} so later store writes do not mutate findings.
 */
function copyLabel(label: DistanceLabel): DistanceLabel {
  return {
    length: label.length,
    nEdges: label.nEdges,
    curr: label.curr,
    pred: label.pred,
  };
}

/**
 * Classify a post-settle improve: equal-label, strict-length, or lex-only.
 *
 * @throws If `improved: true` but the candidate is not ≤ the current label.
 */
function classifyPostSettleImprove(
  candidate: DistanceLabel,
  current: DistanceLabel,
): DmsySettleImproveClass {
  const cmp = compareLabels(candidate, current);
  if (cmp === "=") {
    return "equal-label";
  }
  if (candidate.length < current.length) {
    return "strict-length";
  }
  if (cmp === "<") {
    return "lex-only";
  }
  throw new Error(
    `relax improved: true but candidate ${formatDistanceLabel(candidate)} is not ≤ current ${formatDistanceLabel(current)}`,
  );
}

/**
 * Derive emission region and recurse context at the moment of a post-settle finding.
 */
function settleImproveContext(
  recurseStack: readonly RecurseFrame[],
  lastRecurseDir: "in" | "out" | null,
): { region: DmsySettleImproveRegion; recurseDepth: number; activeLevel: number } {
  if (recurseStack.length === 0) {
    return { region: "in-level", recurseDepth: 0, activeLevel: -1 };
  }

  const top = recurseStack[recurseStack.length - 1];
  if (top === undefined) {
    return { region: "in-level", recurseDepth: 0, activeLevel: -1 };
  }

  const recurseDepth = recurseStack.length;
  const activeLevel = top.level;

  if (top.level === 0) {
    return { region: "level-0", recurseDepth, activeLevel };
  }
  if (lastRecurseDir === "out") {
    return { region: "after-child", recurseDepth, activeLevel };
  }
  return { region: "in-level", recurseDepth, activeLevel };
}

/**
 * Build CSR tail column `tails[e] = from` for arc index `e`.
 *
 * @throws If any offset slot is missing.
 */
function buildCsrTails(graph: Graph): Uint32Array {
  const { n, m, offsets } = graph;
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
  return tails;
}

/**
 * Replay a DMSY trace on a {@link DistanceStore} and report post-settle improving relaxes.
 *
 * Walks events in order, maintaining settled vertices and recurse/batch context. Each
 * `relax` with `improved: true` on an already-settled target is classified as
 * {@link DmsySettleImproveClass strict-length}, {@link DmsySettleImproveClass lex-only},
 * or {@link DmsySettleImproveClass equal-label} from 4-tuple label replay.
 *
 * @param graph - Original CSR graph (offsets, targets, weights).
 * @param events - DMSY trace events (public or instrumented lane).
 * @param source - Source vertex; must be an integer in `[0, n)`.
 * @returns Structured findings and one human-readable message per finding (empty when clean).
 * @throws If `source` is out of range, CSR slots are missing, or an improving relax is not ≤ current.
 */
export function assertDmsySettleFinality(
  graph: Graph,
  events: readonly TraceEvent[],
  source: VertexId,
): DmsySettleFinalityReport {
  const { n, targets, weights } = graph;

  if (!Number.isInteger(source) || source < 0 || source >= n) {
    throw new Error(`source must be an integer in [0, ${n}), got ${String(source)}`);
  }

  const tails = buildCsrTails(graph);
  const store = createDistanceStore(n);
  applyLabel(store, source, { length: 0, nEdges: 0, curr: source, pred: SENTINEL });

  const settled = new Uint8Array(n);
  const settleOrderAt = new Int32Array(n);
  settleOrderAt.fill(-1);
  const settleLabelAt: DistanceLabel[] = [];
  let nextSettleOrder = 0;

  const recurseStack: RecurseFrame[] = [];
  let lastRecurseDir: "in" | "out" | null = null;

  const findings: DmsySettleImproveFinding[] = [];
  const messages: string[] = [];

  for (const event of events) {
    if (event.k === "recurse") {
      if (event.dir === "in") {
        recurseStack.push({ level: event.level, bound: event.bound });
        lastRecurseDir = "in";
      } else if (recurseStack.length === 0) {
        messages.push("recurse out without matching recurse in");
        lastRecurseDir = "out";
      } else {
        recurseStack.pop();
        lastRecurseDir = "out";
      }
      continue;
    }

    if (event.k === "batch") {
      continue;
    }

    if (event.k === "settle") {
      const v = event.v;
      if (settled[v] === 1) {
        continue;
      }
      settled[v] = 1;
      settleOrderAt[v] = nextSettleOrder;
      nextSettleOrder += 1;
      settleLabelAt[v] = copyLabel(labelAt(store, v));
      continue;
    }

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

    const candidate = addWeight(labelAt(store, from), weight, to);
    const current = labelAt(store, to);

    if (settled[to] === 1) {
      const klass = classifyPostSettleImprove(candidate, current);
      const order = settleOrderAt[to];
      if (order === undefined || order < 0) {
        throw new Error(`settled vertex ${to} missing settle order`);
      }
      const settleLabel = settleLabelAt[to];
      if (settleLabel === undefined) {
        throw new Error(`settled vertex ${to} missing settle label snapshot`);
      }
      const { region, recurseDepth, activeLevel } = settleImproveContext(
        recurseStack,
        lastRecurseDir,
      );
      const finding: DmsySettleImproveFinding = {
        vertex: to,
        edge: e,
        klass,
        settleOrder: order,
        region,
        recurseDepth,
        activeLevel,
        settleLabel: copyLabel(settleLabel),
        candidateLabel: copyLabel(candidate),
      };
      findings.push(finding);
      messages.push(
        `post-settle improve vertex ${String(to)} via edge ${String(e)}: ${klass} (region ${region}, depth ${String(recurseDepth)}, level ${String(activeLevel)}); settle ${formatDistanceLabel(settleLabel)} → ${formatDistanceLabel(candidate)}`,
      );
    }

    applyLabel(store, to, candidate);
  }

  return { findings, messages };
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
 * Check DMSY lexicographic labels and cross-check public {@link run} vs mapped
 * {@link runInstrumented} on the degree-reduced graph.
 *
 * `recurse.bound` is only the length component of the call bound (schema is a
 * number). A synthetic ⟨bound, 0, SENTINEL, SENTINEL⟩ is **not** the real 4-tuple
 * B — settling with the same length and more hops is valid when the live B has
 * a larger nEdges/curr/pred. The algorithm already throws in `emitSettle` if
 * `compareLabels(label, B) !== "<"` against the live bound.
 *
 * Store shape on the instrumented lane: settled `curr === v` and finite length;
 * source is ⟨0, 0, s, SENTINEL⟩; unreachable stay ⟨Infinity, 0, v, SENTINEL⟩.
 * Distances and predecessors from public `run()` must match
 * {@link mapBackDistances} / {@link mapBackPredecessors} of the instrumented
 * result so a scalar pred replay cannot silently disagree with the live store.
 *
 * Also runs {@link assertDmsySettleFinality} on both public and instrumented traces
 * (DMSY-P32: no post-settle `improved: true` on either lane).
 *
 * @returns Empty array when all checks pass; otherwise human-readable violation messages.
 */
export function assertDmsyLexTieBreak(
  graph: Graph,
  source: VertexId,
  params?: DmsyParams,
): string[] {
  const violations: string[] = [];
  const pub = drainDmsyRun(graph, source, params);
  const reduced = degreeReduce(graph);
  const reducedSrc = reducedSource(reduced.vertexMap, source);
  const inst = drainDmsyInstrumented(reduced.graph, reducedSrc, params);
  const { events, result } = inst;
  const { dist, distances } = result;

  const sourceLabel = labelAt(dist, reducedSrc);
  if (
    sourceLabel.length !== 0 ||
    sourceLabel.nEdges !== 0 ||
    sourceLabel.curr !== reducedSrc ||
    sourceLabel.pred !== SENTINEL
  ) {
    violations.push(
      `source ${reducedSrc}: expected ⟨0, 0, ${reducedSrc}, SENTINEL⟩, got ${JSON.stringify(sourceLabel)}`,
    );
  }

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
    if (label.pred !== SENTINEL && (label.pred < 0 || label.pred >= reduced.graph.n)) {
      violations.push(`settle vertex ${v}: pred ${label.pred} is out of range`);
    }
  }

  const mappedDistances = mapBackDistances(inst.result.distances, reduced.vertexMap, graph.n);
  for (let v = 0; v < graph.n; v += 1) {
    const pubDist = pub.result.distances[v];
    const mappedDist = mappedDistances[v];
    if (pubDist === undefined || mappedDist === undefined) {
      violations.push(`vertex ${v}: missing distance slot in public vs instrumented cross-check`);
      continue;
    }
    if (pubDist !== mappedDist) {
      violations.push(
        `vertex ${v}: public distance ${String(pubDist)} !== mapped instrumented ${String(mappedDist)}`,
      );
    }
  }

  const mappedPredecessors = mapBackPredecessors(inst.result.dist, reduced.vertexMap, graph.n);
  for (let v = 0; v < graph.n; v += 1) {
    const pubPred = pub.result.predecessors[v];
    const mappedPred = mappedPredecessors[v];
    if (pubPred === undefined || mappedPred === undefined) {
      violations.push(
        `vertex ${v}: missing predecessor slot in public vs instrumented cross-check`,
      );
      continue;
    }
    if (pubPred !== mappedPred) {
      violations.push(
        `vertex ${v}: public pred ${String(pubPred)} !== mapped instrumented ${String(mappedPred)}`,
      );
    }
  }

  const pubFinality = assertDmsySettleFinality(graph, pub.events, source);
  for (const msg of pubFinality.messages) {
    violations.push(`public settle-finality: ${msg}`);
  }
  const instFinality = assertDmsySettleFinality(reduced.graph, inst.events, reducedSrc);
  for (const msg of instFinality.messages) {
    violations.push(`instrumented settle-finality: ${msg}`);
  }

  for (let v = 0; v < reduced.graph.n; v += 1) {
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
