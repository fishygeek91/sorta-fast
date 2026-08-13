/// <reference lib="webworker" />

/**
 * Vite worker entry: stream BMSSP trace chunks to the main thread (issue #12).
 */

import { transferables } from "../core/trace.ts";
import { runBmsspTraceJob } from "./bmsspTraceJob.ts";
import { type TraceGraphMessage, type TraceRunRequest } from "./protocol.ts";

self.onmessage = (event: MessageEvent<TraceRunRequest>): void => {
  const request = event.data;
  if (request.type !== "run") {
    self.postMessage({ type: "error", message: "expected run request" });
    return;
  }

  const { kind, n, seed, source, mode, k, t } = request;

  try {
    runBmsspTraceJob(
      { kind, n, seed, source, mode, k, t },
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
      },
    );
    self.postMessage({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker failed";
    self.postMessage({ type: "error", message });
  }
};
