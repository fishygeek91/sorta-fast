/**
 * Headless trace playback buffer (issue #7, design.md §4.3).
 *
 * Applies column-native SoA trace chunks onto {@link LaneState} for scrub-safe
 * playback. Keyframe snapshots every {@link KEYFRAME_OPS} billed ops make
 * backward seeks cheap. No DOM, `Date.now()`, or `Math.random()`.
 */

import { bmsspParams } from "../core/bmssp/params.ts";
import { type Graph } from "../core/graph.ts";
import {
  BATCH_PHASE,
  DSTRUCT_OP,
  FOREST_OP,
  RECURSE_DIR,
  TRACE_KIND,
  type TraceChunk,
} from "../core/trace.ts";
import {
  D_BLOCK_CAP,
  FOREST_EDGE_CUT,
  FOREST_EDGE_GROW,
  FOREST_EDGE_NONE,
  FOREST_SUBTREE_CAP,
  LaneState,
  UNSETTLED,
} from "./laneState.ts";

/** Keyframe interval in billed ops for backward scrub restores (design.md §4.3). */
export const KEYFRAME_OPS = 250_000;

/**
 * Playback buffer over one lane's trace chunks.
 *
 * Holds prefix tables (`chunkOfEvent`, `rowOfEvent`, `workAfter`) for O(1)
 * event locate and binary-search seek. {@link state} is the live cursor;
 * {@link seekWork} restores from keyframes when scrubbing backward.
 * {@link appendChunk} extends the trace incrementally for streaming playback.
 * Reconstructs shortest-path tree fields (`pred`, `dist`, `settleWork`) and
 * out-of-order settle counts for photo-finish playback (#14).
 */
export class TraceBuffer {
  readonly graph: Graph;
  totalEvents: number;
  totalWork: number;
  readonly state: LaneState;

  private chunks: TraceChunk[];
  private chunkOfEvent: Uint32Array;
  private rowOfEvent: Uint32Array;
  private workAfter: Uint32Array;
  private readonly source: number;
  /** FindPivots k narrated on recurse-in; from ctor arg or {@link bmsspParams}. */
  private readonly findPivotsKParam: number;
  /** CSR edge index → tail vertex for relax pred/dist reconstruction. */
  private readonly edgeSources: Uint32Array;
  private readonly keyframes: LaneState[];
  /** Lane state at the end of indexed events; used only for keyframe continuation. */
  private readonly indexState: LaneState;
  /** Last keyframe bucket `floor(work / KEYFRAME_OPS)` for append cadence. */
  private lastKeyframeK: number;
  private _applyCount = 0;

  /** Number of keyframe snapshots (T=0, interval, trailing end). */
  get keyframeCount(): number {
    return this.keyframes.length;
  }

  /**
   * Lifetime live-cursor apply count (#44).
   *
   * Counts successful {@link applyOne} calls on the live {@link state}
   * (constructor keyframe pass when chunks are given to the constructor,
   * {@link seekWork}, and {@link stepEvent}). Does not include
   * {@link appendChunk}'s indexState pass, which uses applyOneTo directly.
   */
  get applyCount(): number {
    return this._applyCount;
  }

  /**
   * Build indices, keyframes, and an empty playback cursor.
   *
   * @param graph - CSR graph for relax target lookup.
   * @param chunks - Completed trace slabs (array copied; column buffers shared).
   *                 Pass `[]` for an empty trace that can grow via {@link appendChunk}.
   * @param source - SSSP source vertex; `dist[source]` is 0 at playback start (default 0).
   * @param findPivotsK - FindPivots k applied on each recurse-in (default `bmsspParams(n).k`).
   * @throws If `graph.n` is invalid, `source` is out of range, `findPivotsK` is not an
   *         integer >= 1, a row cost is missing, or a kind is unknown.
   */
  constructor(
    graph: Graph,
    chunks: readonly TraceChunk[],
    source: number = 0,
    findPivotsK?: number,
  ) {
    if (!Number.isInteger(graph.n) || graph.n < 0) {
      throw new Error(`graph.n must be an integer >= 0, got ${String(graph.n)}`);
    }
    if (graph.n > 0) {
      if (!Number.isInteger(source) || source < 0 || source >= graph.n) {
        throw new Error(
          `source must be an integer in [0, ${String(graph.n)}), got ${String(source)}`,
        );
      }
    }

    if (findPivotsK !== undefined) {
      if (!Number.isInteger(findPivotsK) || findPivotsK < 1) {
        throw new Error("findPivotsK must be an integer >= 1");
      }
    }

    this.graph = graph;
    this.source = source;
    this.findPivotsKParam =
      findPivotsK ?? (graph.n === 0 ? 1 : bmsspParams(Math.max(1, graph.n)).k);
    this.edgeSources = buildEdgeSources(graph);
    this.chunks = chunks.slice();

    let totalEvents = 0;
    for (const chunk of this.chunks) {
      totalEvents += chunk.count;
    }
    this.totalEvents = totalEvents;

    this.chunkOfEvent = new Uint32Array(totalEvents);
    this.rowOfEvent = new Uint32Array(totalEvents);
    this.workAfter = new Uint32Array(totalEvents);

    let cumulativeWork = 0;
    let eventIndex = 0;

    for (let chunkIdx = 0; chunkIdx < this.chunks.length; chunkIdx += 1) {
      const chunk = this.chunks[chunkIdx];
      if (chunk === undefined) {
        throw new Error(`missing chunk at index ${String(chunkIdx)}`);
      }

      for (let row = 0; row < chunk.count; row += 1) {
        this.validateChunkRow(chunk, chunkIdx, row);

        const cost = chunk.cost[row];
        if (cost === undefined) {
          throw new Error(`missing cost at chunk ${String(chunkIdx)} row ${String(row)}`);
        }

        cumulativeWork += cost;
        this.chunkOfEvent[eventIndex] = chunkIdx;
        this.rowOfEvent[eventIndex] = row;
        this.workAfter[eventIndex] = cumulativeWork;
        eventIndex += 1;
      }
    }

    this.totalWork = cumulativeWork;
    this.state = new LaneState(graph.n, graph.m);
    if (graph.n > 0) {
      this.state.dist[this.source] = 0;
    }
    this.indexState = this.state.clone();

    this.keyframes = [];
    const t0 = this.state.clone();
    this.keyframes.push(t0);

    this.lastKeyframeK = 0;

    while (this.state.eventIndex < this.totalEvents) {
      this.applyOne();

      const k = Math.floor(this.state.work / KEYFRAME_OPS);
      if (k > this.lastKeyframeK) {
        this.keyframes.push(this.state.clone());
        this.lastKeyframeK = k;
      }
    }

    const lastKeyframe = this.keyframes[this.keyframes.length - 1];
    if (lastKeyframe === undefined) {
      throw new Error("TraceBuffer: missing initial keyframe");
    }
    if (lastKeyframe.eventIndex !== this.totalEvents) {
      this.keyframes.push(this.state.clone());
    }

    this.indexState.copyFrom(this.state);
    this.state.copyFrom(t0);
  }

  /**
   * Append a completed trace slab and extend prefix tables and keyframes.
   *
   * Live {@link state} is not moved; only {@link indexState} advances for
   * keyframe continuation.
   *
   * @param chunk - New slab with at least one event row.
   * @throws If `chunk.count` is invalid, a row cost is missing, or a kind is unknown.
   */
  appendChunk(chunk: TraceChunk): void {
    if (!Number.isInteger(chunk.count) || chunk.count < 1) {
      throw new Error(`chunk.count must be an integer >= 1, got ${String(chunk.count)}`);
    }

    const chunkIdx = this.chunks.length;
    for (let row = 0; row < chunk.count; row += 1) {
      this.validateChunkRow(chunk, chunkIdx, row);
    }

    this.chunks.push(chunk);

    const oldLen = this.totalEvents;
    const newLen = oldLen + chunk.count;
    const newChunkOfEvent = new Uint32Array(newLen);
    const newRowOfEvent = new Uint32Array(newLen);
    const newWorkAfter = new Uint32Array(newLen);

    newChunkOfEvent.set(this.chunkOfEvent);
    newRowOfEvent.set(this.rowOfEvent);
    newWorkAfter.set(this.workAfter);

    let cumulativeWork = this.totalWork;
    let eventIndex = oldLen;

    for (let row = 0; row < chunk.count; row += 1) {
      const cost = chunk.cost[row];
      if (cost === undefined) {
        throw new Error(`missing cost at chunk ${String(chunkIdx)} row ${String(row)}`);
      }

      cumulativeWork += cost;
      newChunkOfEvent[eventIndex] = chunkIdx;
      newRowOfEvent[eventIndex] = row;
      newWorkAfter[eventIndex] = cumulativeWork;
      eventIndex += 1;
    }

    this.chunkOfEvent = newChunkOfEvent;
    this.rowOfEvent = newRowOfEvent;
    this.workAfter = newWorkAfter;
    this.totalEvents = newLen;
    this.totalWork = cumulativeWork;

    while (this.indexState.eventIndex < this.totalEvents) {
      this.applyOneTo(this.indexState);

      const k = Math.floor(this.indexState.work / KEYFRAME_OPS);
      if (k > this.lastKeyframeK) {
        this.keyframes.push(this.indexState.clone());
        this.lastKeyframeK = k;
      }
    }

    const lastKeyframe = this.keyframes[this.keyframes.length - 1];
    if (lastKeyframe === undefined) {
      throw new Error("TraceBuffer: missing initial keyframe");
    }
    if (lastKeyframe.eventIndex !== this.totalEvents) {
      const prev = this.keyframes[this.keyframes.length - 2];
      const isTrailingEndMarker =
        prev !== undefined &&
        Math.floor(lastKeyframe.work / KEYFRAME_OPS) === Math.floor(prev.work / KEYFRAME_OPS);
      if (isTrailingEndMarker) {
        this.keyframes[this.keyframes.length - 1] = this.indexState.clone();
      } else {
        this.keyframes.push(this.indexState.clone());
      }
    }
  }

  /**
   * Seek so billed work applied is the largest prefix with cumulative work <= `t`.
   *
   * `t` may be fractional (work clock cursor); only whole events are applied.
   * When `t` falls between events, {@link state}.`work` is the last applied
   * event's cumulative cost (<= `t`).
   *
   * @param t - Target billed ops; must be finite and >= 0. Clamped to {@link totalWork}.
   * @throws If `t` is not finite or is negative.
   */
  seekWork(t: number): void {
    if (!Number.isFinite(t)) {
      throw new Error(`t must be finite, got ${String(t)}`);
    }
    if (t < 0) {
      throw new Error(`t must be >= 0, got ${String(t)}`);
    }

    const targetWork = Math.min(t, this.totalWork);
    const desiredEventIndex = this.eventIndexForWork(targetWork);

    if (desiredEventIndex === this.state.eventIndex) {
      return;
    }

    if (desiredEventIndex < this.state.eventIndex) {
      const keyframe = this.findKeyframe(targetWork, desiredEventIndex);
      this.state.copyFrom(keyframe);
      while (this.state.eventIndex < desiredEventIndex) {
        this.applyOne();
      }
      return;
    }

    while (this.state.eventIndex < desiredEventIndex) {
      this.applyOne();
    }
  }

  /**
   * Cumulative billed work of the next unapplied event, or null at end of indexed events.
   *
   * @returns `workAfter[eventIndex]` when more events remain; otherwise `null`.
   */
  nextEventWork(): number | null {
    if (this.state.eventIndex >= this.totalEvents) {
      return null;
    }
    const work = this.workAfter[this.state.eventIndex];
    if (work === undefined) {
      throw new Error(`missing workAfter at index ${String(this.state.eventIndex)}`);
    }
    return work;
  }

  /**
   * Apply exactly one event if any remain.
   *
   * @returns `false` when {@link state}.`eventIndex` already equals {@link totalEvents}.
   */
  stepEvent(): boolean {
    if (this.state.eventIndex >= this.totalEvents) {
      return false;
    }
    this.applyOne();
    return true;
  }

  /**
   * Map a global event index to its source chunk and row.
   *
   * @param eventIndex - Event in `[0, totalEvents)`.
   * @throws If `eventIndex` is out of range or tables are inconsistent.
   */
  private locate(eventIndex: number): { chunk: TraceChunk; row: number } {
    if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= this.totalEvents) {
      throw new Error(
        `event index ${String(eventIndex)} out of range [0, ${String(this.totalEvents)})`,
      );
    }

    const chunkIdx = this.chunkOfEvent[eventIndex];
    const row = this.rowOfEvent[eventIndex];
    if (chunkIdx === undefined || row === undefined) {
      throw new Error(`missing locate tables for event ${String(eventIndex)}`);
    }

    const chunk = this.chunks[chunkIdx];
    if (chunk === undefined) {
      throw new Error(`missing chunk ${String(chunkIdx)} for event ${String(eventIndex)}`);
    }

    return { chunk, row };
  }

  /**
   * Apply the event at {@link state}.`eventIndex` and advance the live cursor.
   *
   * @throws On invalid settle/relax payloads or double settle.
   */
  private applyOne(): void {
    this.applyOneTo(this.state);
    this._applyCount += 1;
  }

  /**
   * Apply the event at `target.eventIndex` onto `target` and advance its cursor.
   *
   * @param target - Lane state to mutate (live cursor or index-only state).
   * @throws On invalid settle/relax payloads or double settle.
   */
  private applyOneTo(target: LaneState): void {
    const eventIndex = target.eventIndex;
    const { chunk, row } = this.locate(eventIndex);

    const kind = chunk.kind[row];
    if (kind === undefined) {
      throw new Error(`missing kind at event ${String(eventIndex)}`);
    }

    const cost = chunk.cost[row];
    if (cost === undefined) {
      throw new Error(`missing cost at event ${String(eventIndex)}`);
    }

    switch (kind) {
      case TRACE_KIND.settle: {
        const vertex = chunk.vertex[row];
        const order = chunk.aux0[row];
        if (vertex === undefined || order === undefined) {
          throw new Error(`missing settle fields at event ${String(eventIndex)}`);
        }
        if (vertex < 0 || vertex >= target.n) {
          throw new Error(`settle vertex ${String(vertex)} out of range [0, ${String(target.n)})`);
        }
        if (target.settleOrder[vertex] === UNSETTLED) {
          target.settleOrder[vertex] = order;
          target.frontier[vertex] = 0;
          target.settledCount += 1;
          target.settleWork[vertex] = target.work + cost;
          const dv = target.dist[vertex];
          if (dv < target.maxSettledDist) {
            target.outOfOrderSettles += 1;
            target.outOfOrder[vertex] = 1;
          }
          if (dv > target.maxSettledDist) {
            target.maxSettledDist = dv;
          }
        } else {
          throw new Error(
            `double settle on vertex ${String(vertex)} at event ${String(eventIndex)}`,
          );
        }
        break;
      }

      case TRACE_KIND.relax: {
        const improved = chunk.aux0[row];
        const edge = chunk.edge[row];
        if (improved === undefined || edge === undefined) {
          throw new Error(`missing relax fields at event ${String(eventIndex)}`);
        }
        target.relaxations += 1;
        if (improved === 1) {
          if (!Number.isInteger(edge) || edge < 0 || edge >= target.m) {
            throw new Error(
              `relax edge ${String(edge)} out of range [0, ${String(target.m)}) at event ${String(eventIndex)}`,
            );
          }
          const to = this.graph.targets[edge];
          if (to === undefined) {
            throw new Error(
              `missing relax target for edge ${String(edge)} at event ${String(eventIndex)}`,
            );
          }
          if (to < 0 || to >= target.n) {
            throw new Error(
              `relax target ${String(to)} out of range [0, ${String(target.n)}) at event ${String(eventIndex)}`,
            );
          }
          const from = this.edgeSources[edge];
          if (from === undefined) {
            throw new Error(
              `missing relax source for edge ${String(edge)} at event ${String(eventIndex)}`,
            );
          }
          const weight = this.graph.weights[edge];
          if (weight === undefined || !Number.isFinite(weight)) {
            throw new Error(
              `missing or non-finite relax weight for edge ${String(edge)} at event ${String(eventIndex)}`,
            );
          }
          const fromDist = target.dist[from];
          target.pred[to] = from;
          target.dist[to] = fromDist + weight;
          if (target.settleOrder[to] === UNSETTLED) {
            target.frontier[to] = 1;
          }
          target.lastRelaxWork[edge] = target.work + cost;
          if (target.batchOpen === 1) {
            this.expandBloomForVertex(target, to);
          }
        }
        break;
      }

      case TRACE_KIND.heap:
        target.heapOps += 1;
        break;

      case TRACE_KIND.pivot: {
        const vertex = chunk.vertex[row];
        if (vertex === undefined) {
          throw new Error(`missing pivot vertex at event ${String(eventIndex)}`);
        }
        if (vertex < 0 || vertex >= target.n) {
          throw new Error(
            `pivot vertex ${String(vertex)} out of range [0, ${String(target.n)}) at event ${String(eventIndex)}`,
          );
        }
        target.pivotFlareWork[vertex] = target.work + cost;
        target.pivotsFoundThisCall += 1;
        break;
      }

      case TRACE_KIND.batch: {
        const phase = chunk.aux0[row];
        const level = chunk.aux1[row];
        const size = chunk.aux2[row];
        if (phase === undefined || level === undefined || size === undefined) {
          throw new Error(`missing batch fields at event ${String(eventIndex)}`);
        }
        if (phase === BATCH_PHASE.start) {
          target.batchOpen = 1;
          target.batchLevel = level;
          target.lastBatchSize = size;
          target.batchRound += 1;
          target.bloomVertex.fill(0);
          target.bloomMinX = Infinity;
          target.bloomMinY = Infinity;
          target.bloomMaxX = -Infinity;
          target.bloomMaxY = -Infinity;
          target.bloomActive = 0;
        } else if (phase === BATCH_PHASE.end) {
          target.batchOpen = 0;
          target.lastBatchSize = size;
        } else {
          throw new Error(`invalid batch phase ${String(phase)} at event ${String(eventIndex)}`);
        }
        break;
      }

      case TRACE_KIND.recurse: {
        const dir = chunk.aux0[row];
        const bound = chunk.auxF[row];
        if (dir === undefined || bound === undefined) {
          throw new Error(`missing recurse fields at event ${String(eventIndex)}`);
        }
        if (dir === RECURSE_DIR.in) {
          target.recursionDepth += 1;
          target.currentBound = bound;
          target.findPivotsK = this.findPivotsKParam;
          target.pivotsFoundThisCall = 0;
          target.subtreeCount = 0;
          target.batchRound = 0;
          target.lastPullN = 0;
        } else if (dir === RECURSE_DIR.out) {
          if (target.recursionDepth === 0) {
            throw new Error(`recurse out with empty stack at event ${String(eventIndex)}`);
          }
          target.recursionDepth -= 1;
          target.currentBound = bound;
        } else {
          throw new Error(
            `invalid recurse direction ${String(dir)} at event ${String(eventIndex)}`,
          );
        }
        break;
      }

      case TRACE_KIND.forest: {
        const op = chunk.aux0[row];
        const edge = chunk.edge[row];
        const treeRaw = chunk.aux1[row];
        if (op === undefined || edge === undefined) {
          throw new Error(`missing forest fields at event ${String(eventIndex)}`);
        }
        const tree = this.validateForestTree(treeRaw, eventIndex);
        const workStamp = target.work + cost;
        if (op === FOREST_OP.grow) {
          this.applyForestGrow(target, edge, tree, workStamp, eventIndex);
        } else if (op === FOREST_OP.cut) {
          this.applyForestCut(target, edge, tree, workStamp, eventIndex);
        } else {
          throw new Error(`invalid forest op ${String(op)} at event ${String(eventIndex)}`);
        }
        break;
      }

      case TRACE_KIND.dstruct: {
        target.batchRound = 0;
        const op = chunk.aux0[row];
        const n = chunk.aux1[row];
        if (op === undefined || n === undefined) {
          throw new Error(`missing dstruct fields at event ${String(eventIndex)}`);
        }
        target.dstructOps += 1;
        if (op === DSTRUCT_OP.insert || op === DSTRUCT_OP.merge) {
          this.appendDBlock(target, n);
          target.sortedRegionSize += n;
        } else if (op === DSTRUCT_OP.batchPrepend) {
          this.prependDBlock(target, n);
        } else if (op === DSTRUCT_OP.pull) {
          target.lastPullN = n;
          this.pullDBlockKeys(target, n);
          target.sortedRegionSize = Math.max(0, target.sortedRegionSize - n);
        } else {
          throw new Error(`invalid dstruct op ${String(op)} at event ${String(eventIndex)}`);
        }
        break;
      }

      default:
        throw new Error(`unknown trace kind ${String(kind)} at event ${String(eventIndex)}`);
    }

    target.work += cost;
    target.eventIndex += 1;
  }

  /**
   * Validate forest `tree` id is a non-negative integer.
   *
   * @param tree - Raw `aux1` column value.
   * @param eventIndex - Global event index for error messages.
   * @returns Validated tree id.
   * @throws If `tree` is missing or not a non-negative integer.
   */
  private validateForestTree(tree: number | undefined, eventIndex: number): number {
    if (tree === undefined) {
      throw new Error(`missing forest tree at event ${String(eventIndex)}`);
    }
    if (!Number.isInteger(tree) || tree < 0) {
      throw new Error(
        `forest tree ${String(tree)} must be a non-negative integer at event ${String(eventIndex)}`,
      );
    }
    return tree;
  }

  /**
   * Resolve CSR tail/head for forest edge `e`, validating range.
   *
   * @param target - Lane state supplying `n` and `m`.
   * @param e - CSR edge index.
   * @param eventIndex - Global event index for error messages.
   * @returns Tail and head vertex indices.
   * @throws If `e` or resolved endpoints are out of range.
   */
  private resolveForestEndpoints(
    target: LaneState,
    e: number,
    eventIndex: number,
  ): { from: number; to: number } {
    if (!Number.isInteger(e) || e < 0 || e >= target.m) {
      throw new Error(
        `forest edge ${String(e)} out of range [0, ${String(target.m)}) at event ${String(eventIndex)}`,
      );
    }
    const to = this.graph.targets[e];
    if (to === undefined) {
      throw new Error(`missing forest target for edge ${String(e)} at event ${String(eventIndex)}`);
    }
    if (to < 0 || to >= target.n) {
      throw new Error(
        `forest target ${String(to)} out of range [0, ${String(target.n)}) at event ${String(eventIndex)}`,
      );
    }
    const from = this.edgeSources[e];
    if (from === undefined) {
      throw new Error(`missing forest source for edge ${String(e)} at event ${String(eventIndex)}`);
    }
    if (from < 0 || from >= target.n) {
      throw new Error(
        `forest source ${String(from)} out of range [0, ${String(target.n)}) at event ${String(eventIndex)}`,
      );
    }
    return { from, to };
  }

  /**
   * Apply a spanning-forest grow overlay (paper-notes DMSY-P23).
   *
   * @param target - Lane state whose forest fields are mutated.
   * @param e - CSR edge index being grown.
   * @param tree - Subtree / search id stamped on the head vertex.
   * @param workStamp - Billed work after this event (`target.work + cost`).
   * @param eventIndex - Global event index for error messages.
   */
  private applyForestGrow(
    target: LaneState,
    e: number,
    tree: number,
    workStamp: number,
    eventIndex: number,
  ): void {
    const { to } = this.resolveForestEndpoints(target, e, eventIndex);

    // paper-notes DMSY-P23: last grow per head vertex
    const oldHead = target.forestHeadEdge[to];
    if (oldHead !== UNSETTLED && oldHead !== e) {
      if (!Number.isInteger(oldHead) || oldHead < 0 || oldHead >= target.m) {
        throw new Error(
          `forest head edge ${String(oldHead)} out of range for vertex ${String(to)} at event ${String(eventIndex)}`,
        );
      }
      const oldOp = target.forestEdgeOp[oldHead];
      if (oldOp === FOREST_EDGE_GROW) {
        target.forestGrowCount -= 1;
      }
      target.forestEdgeOp[oldHead] = FOREST_EDGE_NONE;
    }

    if (target.forestEdgeOp[e] !== FOREST_EDGE_GROW) {
      target.forestGrowCount += 1;
    }
    target.forestHeadEdge[to] = e;
    target.forestEdgeOp[e] = FOREST_EDGE_GROW;
    target.forestEdgeWork[e] = workStamp;
    target.forestEdgeTree[e] = tree;
    target.forestTree[to] = tree;
  }

  /**
   * Apply a spanning-forest cut overlay (paper-notes DMSY-P24).
   *
   * @param target - Lane state whose forest fields are mutated.
   * @param e - CSR edge index being cut.
   * @param tree - Subtree / search id (`F_j`) stamped on both endpoints.
   * @param workStamp - Billed work after this event (`target.work + cost`).
   * @param eventIndex - Global event index for error messages.
   */
  private applyForestCut(
    target: LaneState,
    e: number,
    tree: number,
    workStamp: number,
    eventIndex: number,
  ): void {
    const { from, to } = this.resolveForestEndpoints(target, e, eventIndex);

    // paper-notes DMSY-P24: cut.tree is F_j
    if (target.forestEdgeOp[e] === FOREST_EDGE_GROW) {
      target.forestGrowCount -= 1;
    }
    target.forestEdgeOp[e] = FOREST_EDGE_CUT;
    target.forestEdgeWork[e] = workStamp;
    target.forestEdgeTree[e] = tree;
    target.forestTree[from] = tree;
    target.forestTree[to] = tree;
    target.forestCutCount += 1;
    this.appendSubtreeIdIfNew(target, tree);
  }

  /**
   * Append `tree` to the recurse-in subtree id list when not already present.
   *
   * @param target - Lane state whose {@link LaneState.subtreeIds} prefix is updated.
   * @param tree - Distinct cut subtree id to record.
   */
  private appendSubtreeIdIfNew(target: LaneState, tree: number): void {
    for (let i = 0; i < target.subtreeCount; i += 1) {
      const existing = target.subtreeIds[i];
      if (existing === tree) {
        return;
      }
    }
    if (target.subtreeCount < FOREST_SUBTREE_CAP) {
      target.subtreeIds[target.subtreeCount] = tree;
      target.subtreeCount += 1;
    }
  }

  /**
   * Mark vertex `v` in the bloom set and expand the bloom bounding box.
   *
   * @param target - Lane state whose bloom fields are updated.
   * @param v - Vertex index in `[0, target.n)`.
   * @throws If layout coordinates for `v` are missing.
   */
  private expandBloomForVertex(target: LaneState, v: number): void {
    const x = this.graph.x[v];
    const y = this.graph.y[v];
    if (x === undefined || y === undefined) {
      throw new Error(`missing layout coordinates for vertex ${String(v)}`);
    }
    target.bloomVertex[v] = 1;
    if (x < target.bloomMinX) {
      target.bloomMinX = x;
    }
    if (y < target.bloomMinY) {
      target.bloomMinY = y;
    }
    if (x > target.bloomMaxX) {
      target.bloomMaxX = x;
    }
    if (y > target.bloomMaxY) {
      target.bloomMaxY = y;
    }
    target.bloomActive = 1;
  }

  /**
   * Append a schematic D block of size `n` to the tail of `target`'s block list.
   * When at capacity, drops the oldest block.
   *
   * @param target - Lane state whose {@link LaneState.dBlockSizes} list is mutated.
   * @param n - Block size (non-negative integer keys).
   */
  private appendDBlock(target: LaneState, n: number): void {
    if (target.dBlockCount < D_BLOCK_CAP) {
      target.dBlockSizes[target.dBlockCount] = n;
      target.dBlockCount += 1;
      return;
    }
    for (let i = 0; i < D_BLOCK_CAP - 1; i += 1) {
      target.dBlockSizes[i] = target.dBlockSizes[i + 1] ?? 0;
    }
    target.dBlockSizes[D_BLOCK_CAP - 1] = n;
    target.dBlockCount = D_BLOCK_CAP;
  }

  /**
   * Prepend a schematic D block of size `n` to the front of `target`'s block list.
   * When at capacity, drops the tail block before prepending.
   *
   * @param target - Lane state whose {@link LaneState.dBlockSizes} list is mutated.
   * @param n - Block size (non-negative integer keys).
   */
  private prependDBlock(target: LaneState, n: number): void {
    if (target.dBlockCount < D_BLOCK_CAP) {
      for (let i = target.dBlockCount; i > 0; i -= 1) {
        target.dBlockSizes[i] = target.dBlockSizes[i - 1] ?? 0;
      }
      target.dBlockSizes[0] = n;
      target.dBlockCount += 1;
      return;
    }
    for (let i = D_BLOCK_CAP - 1; i > 0; i -= 1) {
      target.dBlockSizes[i] = target.dBlockSizes[i - 1] ?? 0;
    }
    target.dBlockSizes[0] = n;
  }

  /**
   * Remove `n` keys from the front of `target`'s schematic D block list.
   *
   * @param target - Lane state whose {@link LaneState.dBlockSizes} list is mutated.
   * @param n - Number of keys to consume from the front.
   */
  private pullDBlockKeys(target: LaneState, n: number): void {
    let remaining = n;
    while (remaining > 0 && target.dBlockCount > 0) {
      const front = target.dBlockSizes[0];
      if (front === undefined) {
        break;
      }
      if (front <= remaining) {
        remaining -= front;
        for (let i = 0; i < target.dBlockCount - 1; i += 1) {
          target.dBlockSizes[i] = target.dBlockSizes[i + 1] ?? 0;
        }
        target.dBlockCount -= 1;
      } else {
        target.dBlockSizes[0] = front - remaining;
        remaining = 0;
      }
    }
  }

  /**
   * Validate one trace row before indexing.
   *
   * @param chunk - Source slab.
   * @param chunkIdx - Index in {@link chunks}.
   * @param row - Row within the slab.
   * @throws If kind is missing or unknown.
   */
  private validateChunkRow(chunk: TraceChunk, chunkIdx: number, row: number): void {
    const kind = chunk.kind[row];
    if (kind === undefined) {
      throw new Error(`missing kind at chunk ${String(chunkIdx)} row ${String(row)}`);
    }
    if (!isKnownTraceKind(kind)) {
      throw new Error(
        `unknown trace kind ${String(kind)} at chunk ${String(chunkIdx)} row ${String(row)}`,
      );
    }

    const cost = chunk.cost[row];
    if (cost === undefined) {
      throw new Error(`missing cost at chunk ${String(chunkIdx)} row ${String(row)}`);
    }
  }

  /**
   * Largest event count whose inclusive cumulative work is <= `targetWork`.
   */
  private eventIndexForWork(targetWork: number): number {
    if (this.totalEvents === 0) {
      return 0;
    }

    let lo = 0;
    let hi = this.totalEvents - 1;
    let lastMatch = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const work = this.workAfter[mid];
      if (work === undefined) {
        throw new Error(`missing workAfter at index ${String(mid)}`);
      }
      if (work <= targetWork) {
        lastMatch = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (lastMatch === -1) {
      return 0;
    }
    return lastMatch + 1;
  }

  /**
   * Keyframe with the greatest `eventIndex` still <= `desiredEventIndex` and
   * `work` <= `targetWork`.
   */
  private findKeyframe(targetWork: number, desiredEventIndex: number): LaneState {
    const first = this.keyframes[0];
    if (first === undefined) {
      throw new Error("TraceBuffer: no keyframes");
    }

    let best = first;
    for (const keyframe of this.keyframes) {
      if (keyframe.work <= targetWork && keyframe.eventIndex <= desiredEventIndex) {
        if (keyframe.eventIndex >= best.eventIndex) {
          best = keyframe;
        }
      }
    }
    return best;
  }
}

/**
 * Read CSR `offsets[i]`, throwing when the slot is missing.
 */
function offsetAt(offsets: Uint32Array, i: number): number {
  const value = offsets[i];
  if (value === undefined) {
    throw new Error(`offsets[${String(i)}] is missing`);
  }
  return value;
}

/**
 * Build CSR edge index → source vertex lookup for relax pred/dist reconstruction.
 *
 * @param graph - CSR graph whose `offsets` define out-edge ranges.
 * @returns `edgeSources[e]` = tail vertex of edge `e`.
 */
function buildEdgeSources(graph: Graph): Uint32Array {
  const edgeSources = new Uint32Array(graph.m);
  const n = graph.n;
  const offsets = graph.offsets;
  for (let v = 0; v < n; v += 1) {
    const start = offsetAt(offsets, v);
    const end = offsetAt(offsets, v + 1);
    for (let e = start; e < end; e += 1) {
      edgeSources[e] = v;
    }
  }
  return edgeSources;
}

/**
 * @param kind - Numeric kind from a trace chunk column.
 * @returns Whether `kind` is one of the known {@link TRACE_KIND} codes.
 */
function isKnownTraceKind(kind: number): boolean {
  switch (kind) {
    case TRACE_KIND.relax:
    case TRACE_KIND.settle:
    case TRACE_KIND.heap:
    case TRACE_KIND.pivot:
    case TRACE_KIND.batch:
    case TRACE_KIND.recurse:
    case TRACE_KIND.forest:
    case TRACE_KIND.dstruct:
      return true;
    default:
      return false;
  }
}
