/// <reference lib="webworker" />

/**
 * Vite worker entry: stream Dijkstra trace chunks to the main thread (issue #8).
 */

import { transferables } from "../core/trace.ts";
import { runDijkstraTraceJob } from "./dijkstraTraceJob.ts";
import { type TraceGraphMessage, type TraceRunRequest } from "./protocol.ts";

self.onmessage = (event: MessageEvent<TraceRunRequest>): void => {
  const request = event.data;
  if (request.type !== "run") {
    self.postMessage({ type: "error", message: "expected run request" });
    return;
  }

  const { kind, n, seed, source } = request;

  try {
    runDijkstraTraceJob(
      { kind, n, seed, source },
      {
        onGraph(graph) {
          const offsets = graph.offsets.slice();
          const targets = graph.targets.slice();
          const weights = graph.weights.slice();
          const x = graph.x.slice();
          const y = graph.y.slice();
          const msg: TraceGraphMessage = {
            type: "graph",
            n: graph.n,
            m: graph.m,
            offsets,
            targets,
            weights,
            x,
            y,
          };
          const buffers = [offsets.buffer, targets.buffer, weights.buffer, x.buffer, y.buffer];
          self.postMessage(msg, buffers);
        },
        onChunk(chunk) {
          self.postMessage({ type: "chunk", chunk }, transferables(chunk));
        },
        onProgress(ratio) {
          self.postMessage({ type: "progress", phase: "generate", ratio });
        },
      },
    );
    self.postMessage({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker failed";
    self.postMessage({ type: "error", message });
  }
};
