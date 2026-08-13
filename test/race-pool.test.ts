import { describe, expect, it } from "vitest";

import { allocateChunk } from "../src/core/trace.ts";
import {
  RaceWorkerPool,
  type RacePoolHandlers,
  type RaceSpec,
  type RaceWorkerHandle,
  type SpawnRaceWorker,
} from "../src/harness/racePool.ts";
import {
  type TraceAlgo,
  type TraceGraphMessage,
  type TraceRunRequest,
} from "../src/workers/protocol.ts";

/** Shared race parameters for pool tests. */
const BASE_SPEC = {
  kind: "maze" as const,
  n: 8,
  seed: 7,
  source: 0,
};

/** Record of one injected fake worker. */
type FakeWorkerRecord = {
  handle: RaceWorkerHandle;
  algo: TraceAlgo;
  posts: TraceRunRequest[];
  terminated: boolean;
};

/**
 * Build a spawn factory that records algos and posted run payloads.
 *
 * @returns Injectable spawn function and per-lane worker records.
 */
function createFakeSpawn(): { spawn: SpawnRaceWorker; records: FakeWorkerRecord[] } {
  const records: FakeWorkerRecord[] = [];

  const spawn: SpawnRaceWorker = (algo: TraceAlgo): RaceWorkerHandle => {
    const posts: TraceRunRequest[] = [];
    let messageHandler: ((event: { data: unknown }) => void) | null = null;
    let errorHandler: ((event: { message: string }) => void) | null = null;
    let terminated = false;

    const handle: RaceWorkerHandle = {
      postMessage: (message: TraceRunRequest): void => {
        posts.push(message);
      },
      terminate: (): void => {
        terminated = true;
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

    records.push({
      handle,
      algo,
      posts,
      get terminated() {
        return terminated;
      },
      set terminated(value: boolean) {
        terminated = value;
      },
    });

    return handle;
  };

  return { spawn, records };
}

/** Minimal valid CSR graph message for simulated worker replies. */
function sampleGraphMessage(n = 2, m = 1): TraceGraphMessage {
  return {
    type: "graph",
    n,
    m,
    offsets: new Uint32Array([0, 1, 1]),
    targets: new Uint32Array([1]),
    weights: new Float64Array([3.5]),
    x: new Float64Array([0, 1]),
    y: new Float64Array([0, 0]),
  };
}

/**
 * Start a pool with fake workers and no-op handlers unless overridden.
 *
 * @param lanes - Lane algorithm list.
 * @param handlers - Optional handler overrides.
 */
function startPool(
  lanes: readonly TraceAlgo[],
  handlers: Partial<RacePoolHandlers> = {},
): { pool: RaceWorkerPool; records: FakeWorkerRecord[] } {
  const { spawn, records } = createFakeSpawn();
  const pool = new RaceWorkerPool(spawn);

  const spec: RaceSpec = {
    ...BASE_SPEC,
    lanes,
  };

  pool.start(spec, {
    onGraph: () => {},
    onChunk: () => {},
    onLaneDone: () => {},
    onError: () => {},
    ...handlers,
  });

  return { pool, records };
}

describe("RaceWorkerPool start", () => {
  it("posts two run messages with identical spec and per-lane algo for two lanes", () => {
    const { records } = startPool(["dijkstra", "bmssp"]);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.algo)).toEqual(["dijkstra", "bmssp"]);

    for (const record of records) {
      expect(record.posts).toHaveLength(1);
      const message = record.posts[0];
      if (message === undefined) {
        throw new Error("expected run message");
      }
      expect(message).toEqual({
        type: "run",
        algo: record.algo,
        kind: BASE_SPEC.kind,
        n: BASE_SPEC.n,
        seed: BASE_SPEC.seed,
        source: BASE_SPEC.source,
      });
    }
  });

  it("supports three lanes including duplicate algorithms", () => {
    const { records } = startPool(["dijkstra", "bmssp", "dijkstra"]);

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.algo)).toEqual(["dijkstra", "bmssp", "dijkstra"]);
    expect(records.every((record) => record.posts.length === 1)).toBe(true);
  });
});

describe("RaceWorkerPool graph handling", () => {
  it("fires onGraph once; ignores matching repeat; errors on n mismatch", () => {
    let graphCount = 0;
    const errors: Array<{ lane: number; message: string }> = [];

    const { spawn, records } = createFakeSpawn();
    const pool = new RaceWorkerPool(spawn);
    pool.start(
      { ...BASE_SPEC, lanes: ["dijkstra", "bmssp"] },
      {
        onGraph: () => {
          graphCount += 1;
        },
        onChunk: () => {},
        onLaneDone: () => {},
        onError: (lane, message) => {
          errors.push({ lane, message });
        },
      },
    );

    const lane0 = records[0];
    const lane1 = records[1];
    if (lane0 === undefined || lane1 === undefined) {
      throw new Error("expected two fake workers");
    }

    lane0.handle.onmessage?.({ data: sampleGraphMessage(4, 3) });
    expect(graphCount).toBe(1);

    lane1.handle.onmessage?.({ data: sampleGraphMessage(4, 3) });
    expect(graphCount).toBe(1);

    lane1.handle.onmessage?.({ data: sampleGraphMessage(5, 3) });
    expect(graphCount).toBe(1);
    expect(errors).toEqual([
      {
        lane: 1,
        message: "graph n/m mismatch from worker (expected n=4 m=3, got n=5 m=3)",
      },
    ]);
  });
});

describe("RaceWorkerPool message routing", () => {
  it("routes chunk and done to the correct lane index", () => {
    const chunk = allocateChunk(2);
    const chunks: Array<{ lane: number; chunk: typeof chunk }> = [];
    const doneLanes: number[] = [];

    const { records } = startPool(["dijkstra", "bmssp"], {
      onChunk: (lane, receivedChunk) => {
        chunks.push({ lane, chunk: receivedChunk });
      },
      onLaneDone: (lane) => {
        doneLanes.push(lane);
      },
    });

    const lane0 = records[0];
    const lane1 = records[1];
    if (lane0 === undefined || lane1 === undefined) {
      throw new Error("expected two fake workers");
    }

    lane1.handle.onmessage?.({ data: { type: "chunk", chunk } });
    lane0.handle.onmessage?.({ data: { type: "done" } });

    expect(chunks).toEqual([{ lane: 1, chunk }]);
    expect(doneLanes).toEqual([0]);
  });
});

describe("RaceWorkerPool terminate", () => {
  it("calls terminate on every worker handle", () => {
    const { pool, records } = startPool(["dijkstra", "bmssp"]);

    pool.terminate();

    expect(records.every((record) => record.terminated)).toBe(true);

    pool.terminate();
    expect(records.every((record) => record.terminated)).toBe(true);
  });
});

describe("RaceWorkerPool validation", () => {
  it("throws when lanes.length is 1", () => {
    const { spawn } = createFakeSpawn();
    const pool = new RaceWorkerPool(spawn);

    expect(() =>
      pool.start(
        { ...BASE_SPEC, lanes: ["dijkstra"] },
        {
          onGraph: () => {},
          onChunk: () => {},
          onLaneDone: () => {},
          onError: () => {},
        },
      ),
    ).toThrow(/lanes\.length must be 2 or 3/);
  });

  it("forwards optional BMSSP mode, k, and t on every lane", () => {
    const { spawn, records } = createFakeSpawn();
    const pool = new RaceWorkerPool(spawn);

    pool.start(
      { ...BASE_SPEC, lanes: ["dijkstra", "bmssp"], mode: "paper", k: 8, t: 3 },
      {
        onGraph: () => {},
        onChunk: () => {},
        onLaneDone: () => {},
        onError: () => {},
      },
    );

    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.posts).toHaveLength(1);
      const message = record.posts[0];
      if (message === undefined) {
        throw new Error("expected run message");
      }
      expect(message.mode).toBe("paper");
      expect(message.k).toBe(8);
      expect(message.t).toBe(3);
    }
  });
});
