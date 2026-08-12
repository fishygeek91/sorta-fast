/**
 * Headless trace playback buffer (issue #7, design.md §4.3).
 *
 * Applies column-native SoA trace chunks onto {@link LaneState} for scrub-safe
 * playback. Keyframe snapshots every {@link KEYFRAME_OPS} billed ops make
 * backward seeks cheap. No DOM, `Date.now()`, or `Math.random()`.
 */

import { type Graph } from "../core/graph.ts";
import { TRACE_KIND, type TraceChunk } from "../core/trace.ts";
import { LaneState, UNSETTLED } from "./laneState.ts";

/** Keyframe interval in billed ops for backward scrub restores (design.md §4.3). */
export const KEYFRAME_OPS = 250_000;

/**
 * Playback buffer over one lane's trace chunks.
 *
 * Holds prefix tables (`chunkOfEvent`, `rowOfEvent`, `workAfter`) for O(1)
 * event locate and binary-search seek. {@link state} is the live cursor;
 * {@link seekWork} restores from keyframes when scrubbing backward.
 */
export class TraceBuffer {
  readonly graph: Graph;
  readonly totalEvents: number;
  readonly totalWork: number;
  readonly state: LaneState;

  private readonly chunks: readonly TraceChunk[];
  private readonly chunkOfEvent: Uint32Array;
  private readonly rowOfEvent: Uint32Array;
  private readonly workAfter: Uint32Array;
  private readonly keyframes: LaneState[];

  /**
   * Build indices, keyframes, and an empty playback cursor.
   *
   * @param graph - CSR graph for relax target lookup.
   * @param chunks - Completed trace slabs (array copied; column buffers shared).
   * @throws If `graph.n` is invalid, a row cost is missing, or a kind is unknown.
   */
  constructor(graph: Graph, chunks: readonly TraceChunk[]) {
    if (!Number.isInteger(graph.n) || graph.n < 0) {
      throw new Error(`graph.n must be an integer >= 0, got ${String(graph.n)}`);
    }

    this.graph = graph;
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

        cumulativeWork += cost;
        this.chunkOfEvent[eventIndex] = chunkIdx;
        this.rowOfEvent[eventIndex] = row;
        this.workAfter[eventIndex] = cumulativeWork;
        eventIndex += 1;
      }
    }

    this.totalWork = cumulativeWork;
    this.state = new LaneState(graph.n);

    this.keyframes = [];
    const t0 = this.state.clone();
    this.keyframes.push(t0);

    let lastKeyframeK = 0;

    while (this.state.eventIndex < this.totalEvents) {
      this.applyOne();

      const k = Math.floor(this.state.work / KEYFRAME_OPS);
      if (k > lastKeyframeK) {
        this.keyframes.push(this.state.clone());
        lastKeyframeK = k;
      }
    }

    const lastKeyframe = this.keyframes[this.keyframes.length - 1];
    if (lastKeyframe === undefined) {
      throw new Error("TraceBuffer: missing initial keyframe");
    }
    if (lastKeyframe.eventIndex !== this.totalEvents) {
      this.keyframes.push(this.state.clone());
    }

    this.state.copyFrom(t0);
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
   * Apply the event at {@link state}.`eventIndex` and advance the cursor.
   *
   * @throws On invalid settle/relax payloads or double settle.
   */
  private applyOne(): void {
    const { chunk, row } = this.locate(this.state.eventIndex);

    const kind = chunk.kind[row];
    if (kind === undefined) {
      throw new Error(`missing kind at event ${String(this.state.eventIndex)}`);
    }

    const cost = chunk.cost[row];
    if (cost === undefined) {
      throw new Error(`missing cost at event ${String(this.state.eventIndex)}`);
    }

    switch (kind) {
      case TRACE_KIND.settle: {
        const vertex = chunk.vertex[row];
        const order = chunk.aux0[row];
        if (vertex === undefined || order === undefined) {
          throw new Error(`missing settle fields at event ${String(this.state.eventIndex)}`);
        }
        if (vertex < 0 || vertex >= this.state.n) {
          throw new Error(
            `settle vertex ${String(vertex)} out of range [0, ${String(this.state.n)})`,
          );
        }
        if (this.state.settleOrder[vertex] === UNSETTLED) {
          this.state.settleOrder[vertex] = order;
          this.state.frontier[vertex] = 0;
          this.state.settledCount += 1;
        } else {
          throw new Error(
            `double settle on vertex ${String(vertex)} at event ${String(this.state.eventIndex)}`,
          );
        }
        break;
      }

      case TRACE_KIND.relax: {
        const improved = chunk.aux0[row];
        const edge = chunk.edge[row];
        if (improved === undefined || edge === undefined) {
          throw new Error(`missing relax fields at event ${String(this.state.eventIndex)}`);
        }
        if (improved === 1) {
          const to = this.graph.targets[edge];
          if (to === undefined) {
            throw new Error(
              `missing relax target for edge ${String(edge)} at event ${String(this.state.eventIndex)}`,
            );
          }
          if (to < 0 || to >= this.state.n) {
            throw new Error(
              `relax target ${String(to)} out of range [0, ${String(this.state.n)}) at event ${String(this.state.eventIndex)}`,
            );
          }
          if (this.state.settleOrder[to] === UNSETTLED) {
            this.state.frontier[to] = 1;
          }
        }
        break;
      }

      case TRACE_KIND.heap:
      case TRACE_KIND.pivot:
      case TRACE_KIND.batch:
      case TRACE_KIND.recurse:
      case TRACE_KIND.forest:
      case TRACE_KIND.dstruct:
        break;

      default:
        throw new Error(
          `unknown trace kind ${String(kind)} at event ${String(this.state.eventIndex)}`,
        );
    }

    this.state.work += cost;
    this.state.eventIndex += 1;
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
