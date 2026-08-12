import "./style.css";

import { run } from "./core/dijkstra.ts";
import { generateGraph, SIZE_PRESETS } from "./core/graph.ts";
import { TraceWriter } from "./core/trace.ts";
import { Playback } from "./harness/playback.ts";
import { createDomSurface, wrapDomCanvas } from "./render/domSurface.ts";
import { Renderer } from "./render/renderer.ts";

/** Visible race canvas edge length in CSS pixels. */
const CANVAS_SIZE = 720;

/** Default play-speed multiplier (watchable on a 5k-node maze). */
const DEFAULT_SPEED = 8;

/** Source vertex for the single-lane Dijkstra demo. */
const SOURCE_VERTEX = 0;

/**
 * Format billed work for the scrubber label.
 *
 * @param work - Current work cursor.
 * @param total - Total billed ops in the lane trace.
 */
function formatWorkLabel(work: number, total: number): string {
  return `${String(Math.floor(work))} / ${String(total)}`;
}

/**
 * Drain a Dijkstra run into trace chunks for playback.
 *
 * @param graph - CSR graph to run on.
 * @returns Completed trace slabs for {@link Playback}.
 */
function traceChunksFromDijkstra(
  graph: ReturnType<typeof generateGraph>,
): ReturnType<TraceWriter["takeChunks"]> {
  const writer = new TraceWriter();
  for (const event of run(graph, SOURCE_VERTEX)) {
    writer.append(event);
  }
  return writer.takeChunks();
}

/**
 * Mount the temporary single-lane playback scaffold (issues #6/#7; replaced by Lens in #8).
 *
 * @throws If `#app` is missing from `index.html`.
 */
function mountDemo(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root === null) {
    throw new Error("Missing #app root element in index.html");
  }

  root.replaceChildren();

  const note = document.createElement("p");
  note.className = "demo-note";
  note.textContent = "Scaffold demo for #6/#7 — Lens UI is #8.";

  const canvas = document.createElement("canvas");
  canvas.className = "demo-canvas";
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  const controls = document.createElement("div");
  controls.className = "demo-controls";

  const transport = document.createElement("div");
  transport.className = "demo-transport";

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
  speedLabel.className = "demo-speed";
  speedLabel.textContent = "Speed ";

  const speedSelect = document.createElement("select");
  speedSelect.id = "speed-select";
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
  scrubLabel.className = "demo-scrub";

  const scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.className = "demo-scrubber";
  scrubber.min = "0";
  scrubber.step = "1";
  scrubber.value = "0";

  const workLabel = document.createElement("span");
  workLabel.className = "demo-work";
  workLabel.textContent = "0 / 0";

  scrubLabel.append(scrubber, workLabel);
  controls.append(transport, speedLabel, scrubLabel);

  root.append(note, canvas, controls);

  const graph = generateGraph("maze", SIZE_PRESETS.M, 1729);
  const chunks = traceChunksFromDijkstra(graph);
  const playback = new Playback(graph, chunks);
  playback.setSpeed(DEFAULT_SPEED);

  const target = wrapDomCanvas(canvas);
  const renderer = new Renderer({
    target,
    createSurface: createDomSurface,
    graph,
  });

  const totalWork = playback.totalWork;
  scrubber.max = String(totalWork);
  workLabel.textContent = formatWorkLabel(playback.state.work, totalWork);

  /**
   * Sync the scrubber and label to the current playback cursor.
   */
  function syncScrubberUi(): void {
    if (document.activeElement === scrubber) {
      return;
    }
    const work = playback.state.work;
    scrubber.value = String(Math.floor(work));
    workLabel.textContent = formatWorkLabel(work, totalWork);
  }

  /**
   * Paint the lane at the current playback state and refresh controls.
   */
  function drawFrame(): void {
    renderer.draw(playback.state);
    syncScrubberUi();
  }

  drawFrame();

  playBtn.addEventListener("click", () => {
    playback.play();
  });

  pauseBtn.addEventListener("click", () => {
    playback.pause();
  });

  stepEventBtn.addEventListener("click", () => {
    playback.pause();
    playback.stepEvent();
    drawFrame();
  });

  stepOpBtn.addEventListener("click", () => {
    playback.pause();
    playback.stepOp();
    drawFrame();
  });

  speedSelect.addEventListener("change", () => {
    const speed = Number(speedSelect.value);
    if (!Number.isFinite(speed)) {
      throw new Error(`invalid speed select value: ${speedSelect.value}`);
    }
    playback.setSpeed(speed);
  });

  scrubber.addEventListener("input", () => {
    const t = Number(scrubber.value);
    if (!Number.isFinite(t)) {
      throw new Error(`invalid scrubber value: ${scrubber.value}`);
    }
    playback.seek(t);
    workLabel.textContent = formatWorkLabel(playback.state.work, totalWork);
    renderer.draw(playback.state);
  });

  let lastFrameMs = performance.now();

  /**
   * Animation frame: advance playback when playing, then redraw.
   */
  function frame(nowMs: number): void {
    const dtSeconds = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;

    if (playback.clock.playing) {
      playback.advance(dtSeconds);
      drawFrame();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

mountDemo();
