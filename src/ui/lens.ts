/**
 * Lens mode UI: single-lane Dijkstra playback with worker-streamed traces (issue #8).
 */

import { GRAPH_KINDS, SIZE_PRESETS, type Graph, type GraphKind } from "../core/graph.ts";
import { Playback } from "../harness/playback.ts";
import { createDomSurface, wrapDomCanvas } from "../render/domSurface.ts";
import { Renderer } from "../render/renderer.ts";
import {
  type TraceChunkMessage,
  type TraceGraphMessage,
  type WorkerToMain,
} from "../workers/protocol.ts";
import { parseLensUrl, serializeLensUrl, type LensUrlState } from "./urlState.ts";

/** Visible canvas edge length in CSS pixels. */
const CANVAS_SIZE = 720;

/** Default play-speed multiplier. */
const DEFAULT_SPEED = 8;

/** Source vertex for Lens Dijkstra runs. */
const SOURCE_VERTEX = 0;

/** Size presets exposed in the graph controls (XL omitted). */
const LENS_SIZE_KEYS = ["S", "M", "L"] as const;

type LensSizeKey = (typeof LENS_SIZE_KEYS)[number];

/**
 * Mount Lens mode into `#app`: worker-streamed Dijkstra, playback, and renderer.
 *
 * Parses and canonicalizes `?g=&n=&seed=` on boot. Graph controls rewrite the URL
 * and restart the worker. Transport, scrubber, overlay toggles, and live counters
 * mirror the issue #8 spec.
 *
 * @throws If `#app` is missing from `index.html`.
 */
export function mountLens(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root === null) {
    throw new Error("Missing #app root element in index.html");
  }

  let lensState: LensUrlState = parseLensUrl(window.location.search);
  history.replaceState(null, "", serializeLensUrl(lensState) + window.location.hash);

  root.replaceChildren();

  const header = document.createElement("header");
  header.className = "lens-header";

  const title = document.createElement("h1");
  title.className = "lens-title";
  title.textContent = "Sorta Fast";

  const subtitle = document.createElement("p");
  subtitle.className = "lens-subtitle";
  subtitle.textContent = "Lens · Dijkstra";

  header.append(title, subtitle);

  const canvas = document.createElement("canvas");
  canvas.className = "lens-canvas";
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  const counters = document.createElement("div");
  counters.className = "lens-counters";

  const comparisonsBlock = document.createElement("div");
  comparisonsBlock.className = "lens-counter lens-counter-headline";

  const comparisonsLabel = document.createElement("span");
  comparisonsLabel.className = "lens-counter-label";
  comparisonsLabel.textContent = "Comparisons";

  const comparisonsValue = document.createElement("span");
  comparisonsValue.className = "lens-counter-value";
  comparisonsValue.textContent = "0";

  comparisonsBlock.append(comparisonsLabel, comparisonsValue);

  const secondaryCounters = document.createElement("div");
  secondaryCounters.className = "lens-counter-row";

  const heapBlock = document.createElement("div");
  heapBlock.className = "lens-counter lens-counter-secondary";

  const heapLabel = document.createElement("span");
  heapLabel.className = "lens-counter-label";
  heapLabel.textContent = "Heap ops";

  const heapValue = document.createElement("span");
  heapValue.className = "lens-counter-value";
  heapValue.textContent = "0";

  heapBlock.append(heapLabel, heapValue);

  const relaxBlock = document.createElement("div");
  relaxBlock.className = "lens-counter lens-counter-secondary";

  const relaxLabel = document.createElement("span");
  relaxLabel.className = "lens-counter-label";
  relaxLabel.textContent = "Relaxations";

  const relaxValue = document.createElement("span");
  relaxValue.className = "lens-counter-value";
  relaxValue.textContent = "0";

  relaxBlock.append(relaxLabel, relaxValue);
  secondaryCounters.append(heapBlock, relaxBlock);
  counters.append(comparisonsBlock, secondaryCounters);

  const controls = document.createElement("div");
  controls.className = "lens-controls";

  const transport = document.createElement("div");
  transport.className = "lens-transport";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.textContent = "Play";

  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.textContent = "Pause";

  const stepEventBtn = document.createElement("button");
  stepEventBtn.type = "button";
  stepEventBtn.textContent = "Step event";

  const stepOpBtn = document.createElement("button");
  stepOpBtn.type = "button";
  stepOpBtn.textContent = "Step op";

  transport.append(playBtn, pauseBtn, stepEventBtn, stepOpBtn);

  const speedLabel = document.createElement("label");
  speedLabel.className = "lens-speed";
  speedLabel.textContent = "Speed ";

  const speedSelect = document.createElement("select");
  speedSelect.id = "lens-speed-select";
  for (const value of [1, 8, 64] as const) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    if (value === DEFAULT_SPEED) {
      option.selected = true;
    }
    speedSelect.append(option);
  }
  speedLabel.append(speedSelect);

  const scrubLabel = document.createElement("label");
  scrubLabel.className = "lens-scrub";

  const scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.className = "lens-scrubber";
  scrubber.min = "0";
  scrubber.step = "1";
  scrubber.value = "0";
  scrubber.max = "0";

  const workLabel = document.createElement("span");
  workLabel.className = "lens-work";
  workLabel.textContent = "0 / 0";

  scrubLabel.append(scrubber, workLabel);

  const overlaysEl = document.createElement("div");
  overlaysEl.className = "lens-overlays";

  const frontierLabel = document.createElement("label");
  frontierLabel.className = "lens-overlay-toggle";

  const frontierCheckbox = document.createElement("input");
  frontierCheckbox.type = "checkbox";
  frontierCheckbox.checked = true;
  frontierLabel.append(frontierCheckbox, document.createTextNode(" Frontier"));

  const relaxedLabel = document.createElement("label");
  relaxedLabel.className = "lens-overlay-toggle";

  const relaxedCheckbox = document.createElement("input");
  relaxedCheckbox.type = "checkbox";
  relaxedCheckbox.checked = true;
  relaxedLabel.append(relaxedCheckbox, document.createTextNode(" Relaxed edges"));

  overlaysEl.append(frontierLabel, relaxedLabel);

  const graphControls = document.createElement("div");
  graphControls.className = "lens-graph-controls";

  const kindLabel = document.createElement("label");
  kindLabel.className = "lens-graph-field";
  kindLabel.textContent = "Graph ";

  const kindSelect = document.createElement("select");
  kindSelect.id = "lens-kind-select";
  for (const kind of GRAPH_KINDS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }
  kindLabel.append(kindSelect);

  const sizeLabel = document.createElement("label");
  sizeLabel.className = "lens-graph-field";
  sizeLabel.textContent = "Size ";

  const sizeSelect = document.createElement("select");
  sizeSelect.id = "lens-size-select";
  for (const key of LENS_SIZE_KEYS) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = key;
    sizeSelect.append(option);
  }
  sizeLabel.append(sizeSelect);

  const seedLabel = document.createElement("label");
  seedLabel.className = "lens-graph-field";
  seedLabel.textContent = "Seed ";

  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.className = "lens-seed-input";
  seedInput.step = "1";
  seedLabel.append(seedInput);

  graphControls.append(kindLabel, sizeLabel, seedLabel);

  const statusEl = document.createElement("p");
  statusEl.className = "lens-status";
  statusEl.hidden = true;

  controls.append(transport, speedLabel, scrubLabel, overlaysEl, graphControls, statusEl);

  root.append(header, canvas, counters, controls);

  const target = wrapDomCanvas(canvas);
  let playback: Playback | null = null;
  let renderer: Renderer | null = null;
  let worker: Worker | null = null;

  const overlays = { frontier: true, relaxedEdges: true };

  /** True while the user is dragging the scrubber thumb. */
  let scrubberPointerDown = false;

  /**
   * @param work - Current work cursor.
   * @param total - Total billed ops in the lane trace.
   */
  function formatWorkLabel(work: number, total: number): string {
    return `${String(Math.floor(work))} / ${String(total)}`;
  }

  /**
   * @param n - Node count from URL state.
   * @returns Matching S/M/L preset key, or `"M"` when `n` is not a preset value.
   */
  function sizeKeyForN(n: number): LensSizeKey {
    for (const key of LENS_SIZE_KEYS) {
      if (SIZE_PRESETS[key] === n) {
        return key;
      }
    }
    return "M";
  }

  /**
   * Sync graph control widgets to the current Lens URL state.
   */
  function syncGraphControls(): void {
    kindSelect.value = lensState.g;
    sizeSelect.value = sizeKeyForN(lensState.n);
    seedInput.value = String(lensState.seed);
  }

  syncGraphControls();

  /**
   * @param message - Worker graph payload.
   * @returns CSR graph for playback and renderer.
   */
  function graphFromMessage(message: TraceGraphMessage): Graph {
    return {
      n: message.n,
      m: message.m,
      offsets: message.offsets,
      targets: message.targets,
      weights: message.weights,
      x: message.x,
      y: message.y,
    };
  }

  /**
   * Show a worker or validation error in the status line.
   *
   * @param message - Safe user-facing text.
   */
  function showStatus(message: string): void {
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  /**
   * Clear the status line after a successful graph handoff.
   */
  function clearStatus(): void {
    statusEl.textContent = "";
    statusEl.hidden = true;
  }

  /**
   * Sync scrubber and work label to the live playback cursor.
   */
  function syncScrubberUi(): void {
    if (playback === null) {
      workLabel.textContent = "0 / 0";
      if (!scrubberPointerDown) {
        scrubber.value = "0";
      }
      return;
    }

    const work = playback.clock.cursor;
    const total = playback.totalWork;
    workLabel.textContent = formatWorkLabel(work, total);
    scrubber.max = String(total);
    if (!scrubberPointerDown) {
      scrubber.value = String(Math.floor(work));
    }
  }

  /**
   * Refresh headline and secondary counter elements from lane state.
   */
  function syncCounters(): void {
    if (playback === null) {
      comparisonsValue.textContent = "0";
      heapValue.textContent = "0";
      relaxValue.textContent = "0";
      return;
    }

    const state = playback.state;
    comparisonsValue.textContent = String(Math.floor(state.work));
    heapValue.textContent = String(state.heapOps);
    relaxValue.textContent = String(state.relaxations);
  }

  /**
   * Paint the current frame and refresh scrubber + counters.
   */
  function drawFrame(): void {
    if (playback === null || renderer === null) {
      return;
    }
    renderer.draw(playback.state, overlays);
    syncScrubberUi();
    syncCounters();
  }

  /**
   * @param data - Raw `MessageEvent.data` from the trace worker.
   * @returns A narrowed worker payload, or null when unrecognized.
   */
  function parseWorkerMessage(data: unknown): WorkerToMain | null {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const record: Record<string, unknown> = Object(data);

    switch (record["type"]) {
      case "graph": {
        const n = record["n"];
        const m = record["m"];
        const offsets = record["offsets"];
        const targets = record["targets"];
        const weights = record["weights"];
        const x = record["x"];
        const y = record["y"];
        if (
          typeof n !== "number" ||
          typeof m !== "number" ||
          !(offsets instanceof Uint32Array) ||
          !(targets instanceof Uint32Array) ||
          !(weights instanceof Float64Array) ||
          !(x instanceof Float64Array) ||
          !(y instanceof Float64Array)
        ) {
          return null;
        }
        return {
          type: "graph",
          n,
          m,
          offsets,
          targets,
          weights,
          x,
          y,
        };
      }
      case "chunk": {
        const chunk = record["chunk"];
        if (!isTraceChunk(chunk)) {
          return null;
        }
        return { type: "chunk", chunk };
      }
      case "done":
        return { type: "done" };
      case "error": {
        const message = record["message"];
        if (typeof message !== "string") {
          return null;
        }
        return { type: "error", message };
      }
      default:
        return null;
    }
  }

  /**
   * Terminate any in-flight worker and post a fresh Dijkstra trace run.
   */
  function startRun(): void {
    if (worker !== null) {
      worker.terminate();
      worker = null;
    }

    playback = null;
    scrubber.value = "0";
    scrubber.max = "0";
    workLabel.textContent = "0 / 0";
    comparisonsValue.textContent = "0";
    heapValue.textContent = "0";
    relaxValue.textContent = "0";
    clearStatus();

    const speed = Number(speedSelect.value);
    if (!Number.isFinite(speed)) {
      showStatus(`invalid speed select value: ${speedSelect.value}`);
      return;
    }

    const nextWorker = new Worker(new URL("../workers/dijkstraTrace.ts", import.meta.url), {
      type: "module",
    });
    worker = nextWorker;

    nextWorker.onmessage = (event: MessageEvent<unknown>): void => {
      const message = parseWorkerMessage(event.data);
      if (message === null) {
        showStatus("unrecognized worker message");
        return;
      }

      switch (message.type) {
        case "graph": {
          const graph = graphFromMessage(message);
          playback = new Playback(graph, []);
          playback.beginStreaming();

          const graphSpeed = Number(speedSelect.value);
          if (!Number.isFinite(graphSpeed)) {
            showStatus(`invalid speed select value: ${speedSelect.value}`);
          } else {
            playback.setSpeed(graphSpeed);
          }

          if (renderer === null) {
            renderer = new Renderer({
              target,
              createSurface: createDomSurface,
              graph,
            });
          } else {
            renderer.setGraph(graph);
          }

          clearStatus();
          syncScrubberUi();
          drawFrame();
          break;
        }
        case "chunk": {
          if (playback === null) {
            showStatus("chunk received before graph");
            return;
          }
          playback.appendChunk(message.chunk);
          scrubber.max = String(playback.totalWork);
          break;
        }
        case "done": {
          if (playback === null) {
            showStatus("done received before graph");
            return;
          }
          playback.markComplete();
          syncScrubberUi();
          break;
        }
        case "error":
          showStatus(message.message);
          break;
        default: {
          const _exhaustive: never = message;
          showStatus(`unhandled worker message: ${String(_exhaustive)}`);
        }
      }
    };

    nextWorker.onerror = (event: ErrorEvent): void => {
      const detail = event.message !== "" ? event.message : "worker error";
      showStatus(detail);
    };

    const runMessage = {
      type: "run" as const,
      kind: lensState.g,
      n: lensState.n,
      seed: lensState.seed,
      source: SOURCE_VERTEX,
    };
    nextWorker.postMessage(runMessage);
  }

  /**
   * Rewrite the URL and restart the worker with updated gallery state.
   *
   * @param next - New Lens URL fields.
   */
  function applyLensState(next: LensUrlState): void {
    lensState = next;
    history.replaceState(null, "", serializeLensUrl(lensState) + window.location.hash);
    syncGraphControls();
    startRun();
  }

  scrubber.addEventListener("pointerdown", () => {
    scrubberPointerDown = true;
  });

  const onScrubberPointerRelease = (): void => {
    scrubberPointerDown = false;
  };

  window.addEventListener("pointerup", onScrubberPointerRelease);
  window.addEventListener("pointercancel", onScrubberPointerRelease);

  playBtn.addEventListener("click", () => {
    playback?.play();
  });

  pauseBtn.addEventListener("click", () => {
    playback?.pause();
  });

  stepEventBtn.addEventListener("click", () => {
    playback?.pause();
    playback?.stepEvent();
    drawFrame();
  });

  stepOpBtn.addEventListener("click", () => {
    playback?.pause();
    playback?.stepOp();
    drawFrame();
  });

  speedSelect.addEventListener("change", () => {
    const speed = Number(speedSelect.value);
    if (!Number.isFinite(speed)) {
      showStatus(`invalid speed select value: ${speedSelect.value}`);
      return;
    }
    playback?.setSpeed(speed);
  });

  scrubber.addEventListener("input", () => {
    if (playback === null) {
      return;
    }
    const t = Number(scrubber.value);
    if (!Number.isFinite(t)) {
      showStatus(`invalid scrubber value: ${scrubber.value}`);
      return;
    }
    playback.seek(t);
    if (renderer !== null) {
      renderer.draw(playback.state, overlays);
    }
    workLabel.textContent = formatWorkLabel(playback.state.work, playback.totalWork);
    syncCounters();
  });

  frontierCheckbox.addEventListener("change", () => {
    overlays.frontier = frontierCheckbox.checked;
    drawFrame();
  });

  relaxedCheckbox.addEventListener("change", () => {
    overlays.relaxedEdges = relaxedCheckbox.checked;
    drawFrame();
  });

  kindSelect.addEventListener("change", () => {
    const raw = kindSelect.value;
    if (!isGraphKind(raw)) {
      showStatus(`invalid graph kind: ${raw}`);
      return;
    }
    applyLensState({ ...lensState, g: raw });
  });

  sizeSelect.addEventListener("change", () => {
    const raw = sizeSelect.value;
    if (!isLensSizeKey(raw)) {
      showStatus(`invalid size preset: ${raw}`);
      return;
    }
    applyLensState({ ...lensState, n: SIZE_PRESETS[raw] });
  });

  seedInput.addEventListener("change", () => {
    const parsed = Number(seedInput.value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      showStatus(`invalid seed: ${seedInput.value}`);
      syncGraphControls();
      return;
    }
    applyLensState({ ...lensState, seed: parsed });
  });

  let lastFrameMs = performance.now();

  /**
   * Animation frame: advance playback when playing, then redraw when ready.
   */
  function frame(nowMs: number): void {
    const dtSeconds = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;

    if (playback !== null && playback.clock.playing) {
      playback.advance(dtSeconds);
      if (renderer !== null) {
        renderer.draw(playback.state, overlays);
        syncScrubberUi();
        syncCounters();
      }
    }

    requestAnimationFrame(frame);
  }

  startRun();
  requestAnimationFrame(frame);
}

/**
 * @param value - Candidate graph-kind slug from a select option.
 */
function isGraphKind(value: string): value is GraphKind {
  for (const kind of GRAPH_KINDS) {
    if (kind === value) {
      return true;
    }
  }
  return false;
}

/**
 * @param value - Candidate size preset key from a select option.
 */
function isLensSizeKey(value: string): value is LensSizeKey {
  for (const key of LENS_SIZE_KEYS) {
    if (key === value) {
      return true;
    }
  }
  return false;
}

/**
 * @param value - Candidate trace slab from a worker chunk message.
 */
function isTraceChunk(value: unknown): value is TraceChunkMessage["chunk"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record: Record<string, unknown> = Object(value);
  const count = record["count"];
  const kind = record["kind"];
  const vertex = record["vertex"];
  const edge = record["edge"];
  const aux0 = record["aux0"];
  const aux1 = record["aux1"];
  const aux2 = record["aux2"];
  const auxF = record["auxF"];
  const cost = record["cost"];
  return (
    typeof count === "number" &&
    kind instanceof Uint8Array &&
    vertex instanceof Int32Array &&
    edge instanceof Int32Array &&
    aux0 instanceof Int32Array &&
    aux1 instanceof Int32Array &&
    aux2 instanceof Int32Array &&
    auxF instanceof Float64Array &&
    cost instanceof Uint32Array
  );
}
