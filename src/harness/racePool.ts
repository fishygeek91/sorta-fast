/**
 * Multi-lane trace worker pool: spawn per-algo workers and route messages (issue #13).
 *
 * Headless-friendly — inject {@link SpawnRaceWorker} in Node tests. No DOM beyond
 * the default `Worker` constructor, no `Math.random()`, no `Date.now()`.
 */

import { type BmsspParamMode } from "../core/bmssp/params.ts";
import { GRAPH_KINDS, type Graph, type GraphKind } from "../core/graph.ts";
import { type TraceChunk } from "../core/trace.ts";
import {
  graphFromTraceMessage,
  parseWorkerToMain,
  type TraceAlgo,
  type TraceRunRequest,
} from "../workers/protocol.ts";

/** Parameters for a multi-lane trace race. */
export type RaceSpec = {
  kind: GraphKind;
  n: number;
  seed: number;
  source: number;
  /** BMSSP only: `"demo"` or `"paper"`; omitted → demo {@link bmsspParams}(n). Dijkstra ignores. */
  mode?: BmsspParamMode;
  /** BMSSP only: optional level parameter k; omitted → mode default. Dijkstra ignores. */
  k?: number;
  /** BMSSP only: optional block parameter t; omitted → mode default. Dijkstra ignores. */
  t?: number;
  /** Lane algorithms in race order; length 2 or 3. */
  lanes: readonly TraceAlgo[];
};

/**
 * Resolved BMSSP k/t echoed on the first worker graph message.
 * Omitted when the first graph arrives from a Dijkstra lane (no k/t on message).
 */
export type EchoedBmsspParams = {
  k: number;
  t: number;
};

/** Callbacks invoked as workers stream graph, chunks, and completion per lane. */
export type RacePoolHandlers = {
  onGraph: (graph: Graph, bmssp?: EchoedBmsspParams) => void;
  onChunk: (lane: number, chunk: TraceChunk) => void;
  onLaneDone: (lane: number) => void;
  onError: (lane: number, message: string) => void;
  /** Optional graph-generation progress ratio in [0, 1] (issue #20). */
  onProgress?: (ratio: number) => void;
};

/**
 * Minimal worker surface so Node tests can inject fakes without a real `Worker`.
 */
export type RaceWorkerHandle = {
  postMessage: (message: TraceRunRequest) => void;
  terminate: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
};

/** Factory for one trace worker per lane algorithm. */
export type SpawnRaceWorker = (algo: TraceAlgo) => RaceWorkerHandle;

/**
 * Spawn and route trace workers for a multi-lane race.
 *
 * Callers (issue #14) wire pool output into {@link RaceScheduler}; this class
 * only manages worker lifecycle and message demux by lane index.
 */
export class RaceWorkerPool {
  private readonly spawnWorker: SpawnRaceWorker;
  private workers: RaceWorkerHandle[] = [];
  private graphN: number | null = null;
  private graphM: number | null = null;

  /**
   * @param spawnWorker - Optional worker factory; defaults to browser `Worker` URLs
   *   matching Lens (`dijkstraTrace.ts` / `bmsspTrace.ts`).
   */
  constructor(spawnWorker?: SpawnRaceWorker) {
    this.spawnWorker = spawnWorker ?? defaultSpawnWorker;
  }

  /**
   * Terminate any prior workers, spawn one per lane, and post identical graph
   * parameters with per-lane `algo`.
   *
   * @param spec - Race graph parameters and lane algorithms.
   * @param handlers - Graph/chunk/done/error callbacks keyed by lane index.
   * @throws When {@link RaceSpec} fails validation.
   */
  start(spec: RaceSpec, handlers: RacePoolHandlers): void {
    validateRaceSpec(spec);
    this.terminateWorkers();
    this.graphN = null;
    this.graphM = null;

    const nextWorkers: RaceWorkerHandle[] = [];

    for (let lane = 0; lane < spec.lanes.length; lane += 1) {
      const algo = spec.lanes[lane];
      if (algo === undefined) {
        throw new Error(`missing lane algorithm at index ${String(lane)}`);
      }

      const worker = this.spawnWorker(algo);
      worker.onmessage = (event: { data: unknown }): void => {
        this.handleWorkerMessage(lane, event.data, handlers);
      };
      worker.onerror = (event: { message: string }): void => {
        const detail = event.message !== "" ? event.message : "worker error";
        handlers.onError(lane, detail);
      };

      const runMessage: TraceRunRequest = {
        type: "run",
        algo,
        kind: spec.kind,
        n: spec.n,
        seed: spec.seed,
        source: spec.source,
      };
      if (spec.mode !== undefined) {
        runMessage.mode = spec.mode;
      }
      if (spec.k !== undefined) {
        runMessage.k = spec.k;
      }
      if (spec.t !== undefined) {
        runMessage.t = spec.t;
      }
      worker.postMessage(runMessage);
      nextWorkers.push(worker);
    }

    this.workers = nextWorkers;
  }

  /** Terminate all active workers and clear handles. Safe to call repeatedly. */
  terminate(): void {
    this.terminateWorkers();
    this.graphN = null;
    this.graphM = null;
  }

  /**
   * @param lane - Lane index that produced `data`.
   * @param data - Raw worker payload.
   * @param handlers - Active race callbacks.
   */
  private handleWorkerMessage(lane: number, data: unknown, handlers: RacePoolHandlers): void {
    const message = parseWorkerToMain(data);
    if (message === null) {
      handlers.onError(lane, "unrecognized worker message");
      return;
    }

    switch (message.type) {
      case "graph": {
        if (this.graphN === null || this.graphM === null) {
          this.graphN = message.n;
          this.graphM = message.m;
          const graph = graphFromTraceMessage(message);
          if (typeof message.k === "number" && typeof message.t === "number") {
            handlers.onGraph(graph, { k: message.k, t: message.t });
          } else {
            handlers.onGraph(graph);
          }
          return;
        }

        if (message.n !== this.graphN || message.m !== this.graphM) {
          handlers.onError(
            lane,
            `graph n/m mismatch from worker (expected n=${String(this.graphN)} m=${String(this.graphM)}, got n=${String(message.n)} m=${String(message.m)})`,
          );
          return;
        }
        break;
      }
      case "chunk":
        handlers.onChunk(lane, message.chunk);
        break;
      case "progress":
        handlers.onProgress?.(message.ratio);
        break;
      case "done":
        handlers.onLaneDone(lane);
        break;
      case "error":
        handlers.onError(lane, message.message);
        break;
      default: {
        const unexpected: never = message;
        handlers.onError(lane, `unhandled worker message: ${String(unexpected)}`);
      }
    }
  }

  /** Terminate tracked workers without resetting graph dedup state. */
  private terminateWorkers(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
  }
}

/**
 * Validate {@link RaceSpec} before spawning workers.
 *
 * @throws When lane count, algorithms, or graph parameters are invalid.
 */
function validateRaceSpec(spec: RaceSpec): void {
  const laneCount = spec.lanes.length;
  if (laneCount !== 2 && laneCount !== 3) {
    throw new Error(`lanes.length must be 2 or 3, got ${String(laneCount)}`);
  }

  for (let lane = 0; lane < spec.lanes.length; lane += 1) {
    const algo = spec.lanes[lane];
    if (algo !== "dijkstra" && algo !== "bmssp") {
      throw new Error(`lanes[${String(lane)}] must be "dijkstra" or "bmssp", got ${String(algo)}`);
    }
  }

  if (!isGraphKind(spec.kind)) {
    throw new Error(`unknown graph kind: ${String(spec.kind)}`);
  }

  if (!Number.isInteger(spec.n) || spec.n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(spec.n)}`);
  }

  if (!Number.isInteger(spec.seed) || !Number.isFinite(spec.seed)) {
    throw new Error(`seed must be a finite integer, got ${String(spec.seed)}`);
  }

  if (!Number.isInteger(spec.source) || spec.source < 0 || spec.source >= spec.n) {
    throw new Error(`source must be an integer in [0, n), got ${String(spec.source)}`);
  }

  if (spec.mode !== undefined && spec.mode !== "demo" && spec.mode !== "paper") {
    throw new Error(`mode must be "demo" or "paper", got ${String(spec.mode)}`);
  }

  if (spec.k !== undefined) {
    if (!Number.isInteger(spec.k) || spec.k < 1) {
      throw new Error(`k must be an integer >= 1, got ${String(spec.k)}`);
    }
  }

  if (spec.t !== undefined) {
    if (!Number.isInteger(spec.t) || spec.t < 1) {
      throw new Error(`t must be an integer >= 1, got ${String(spec.t)}`);
    }
  }
}

/**
 * @param value - Candidate graph kind from a race spec.
 */
function isGraphKind(value: string): value is GraphKind {
  for (const kind of GRAPH_KINDS) {
    if (value === kind) {
      return true;
    }
  }
  return false;
}

/**
 * Default browser worker factory — script URL chosen by algorithm, not request field.
 *
 * Vite only emits a worker chunk when `new Worker(new URL("…", import.meta.url), { type: "module" })`
 * is written inline with a static path. Do not assign the URL to a variable first (#48).
 *
 * @param algo - Lane algorithm selector.
 */
function defaultSpawnWorker(algo: TraceAlgo): RaceWorkerHandle {
  const worker =
    algo === "bmssp"
      ? new Worker(new URL("../workers/bmsspTrace.ts", import.meta.url), {
          type: "module",
        })
      : new Worker(new URL("../workers/dijkstraTrace.ts", import.meta.url), {
          type: "module",
        });

  return wrapDomWorker(worker);
}

/**
 * Adapt a DOM `Worker` to {@link RaceWorkerHandle} for tests and production.
 *
 * @param worker - Browser worker instance.
 */
function wrapDomWorker(worker: Worker): RaceWorkerHandle {
  let messageHandler: ((event: { data: unknown }) => void) | null = null;
  let errorHandler: ((event: { message: string }) => void) | null = null;

  worker.onmessage = (event: MessageEvent<unknown>): void => {
    if (messageHandler !== null) {
      messageHandler({ data: event.data });
    }
  };

  worker.onerror = (event: ErrorEvent): void => {
    if (errorHandler !== null) {
      errorHandler({ message: event.message });
    }
  };

  return {
    postMessage: (message: TraceRunRequest): void => {
      worker.postMessage(message);
    },
    terminate: (): void => {
      worker.terminate();
    },
    get onmessage(): ((event: { data: unknown }) => void) | null {
      return messageHandler;
    },
    set onmessage(handler: ((event: { data: unknown }) => void) | null) {
      messageHandler = handler;
    },
    get onerror(): ((event: { message: string }) => void) | null {
      return errorHandler;
    },
    set onerror(handler: ((event: { message: string }) => void) | null) {
      errorHandler = handler;
    },
  };
}
