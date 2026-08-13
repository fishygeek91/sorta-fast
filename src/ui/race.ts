/**
 * Race mode UI: multi-lane playback with worker-streamed traces (issue #14).
 */

import { RaceWorkerPool, type RaceSpec } from "../harness/racePool.ts";
import { RaceScheduler } from "../harness/raceScheduler.ts";
import { createDomSurface, wrapDomCanvas } from "../render/domSurface.ts";
import { Renderer } from "../render/renderer.ts";
import { mountLens } from "./lens.ts";
import { formatRaceBanner, raceCountersFromLane } from "./photoFinish.ts";
import { resolveRaceFinishVertex } from "./raceFinish.ts";
import { lanesFromSearch, type RaceLaneConfig } from "./raceLanes.ts";
import { parseRaceUrl, serializeRaceUrl, type RaceUrlState } from "./raceUrl.ts";

/** Visible canvas edge length in CSS pixels per lane. */
const CANVAS_SIZE = 400;

/** Default play-speed multiplier. */
const DEFAULT_SPEED = 8;

/** Source vertex for race SSSP runs. */
const SOURCE_VERTEX = 0;

/** DOM handles for one race lane panel. */
type LaneUi = {
  comparisonsValue: HTMLSpanElement;
  heapValue: HTMLSpanElement;
  dstructValue: HTMLSpanElement;
  relaxValue: HTMLSpanElement;
  outOfOrderValue: HTMLSpanElement;
  progress: HTMLProgressElement;
  canvas: HTMLCanvasElement;
  renderer: Renderer | null;
};

/**
 * Mount Race mode into `#app`: multi-lane worker-streamed playback and renderers.
 *
 * Parses and canonicalizes race URL params on boot. When `mode=lens`, delegates
 * to {@link mountLens}. Transport, scrubber, photo-finish banner, and per-lane
 * counters mirror issue #14.
 *
 * @throws If `#app` is missing from `index.html`.
 */
export function mountRace(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root === null) {
    throw new Error("Missing #app root element in index.html");
  }

  const raceState: RaceUrlState = parseRaceUrl(window.location.search);
  if (raceState.mode === "lens") {
    mountLens();
    return;
  }

  history.replaceState(null, "", serializeRaceUrl(raceState) + window.location.hash);

  const configs = lanesFromSearch(window.location.search);
  root.replaceChildren();

  const header = document.createElement("header");
  header.className = "lens-header";

  const title = document.createElement("h1");
  title.className = "lens-title";
  title.textContent = "Sorta Fast";

  const subtitle = document.createElement("p");
  subtitle.className = "lens-subtitle";
  subtitle.textContent = "Race";

  const modeNav = document.createElement("div");
  modeNav.className = "lens-mode-nav";

  const raceModeBtn = document.createElement("button");
  raceModeBtn.type = "button";
  raceModeBtn.textContent = "Race";
  raceModeBtn.disabled = true;

  const lensModeBtn = document.createElement("button");
  lensModeBtn.type = "button";
  lensModeBtn.textContent = "Lens";
  lensModeBtn.addEventListener("click", () => {
    const next: RaceUrlState = { ...raceState, mode: "lens" };
    history.replaceState(null, "", serializeRaceUrl(next) + window.location.hash);
    teardown();
    mountLens();
  });

  modeNav.append(raceModeBtn, lensModeBtn);
  header.append(title, subtitle, modeNav);

  const raceRoot = document.createElement("div");
  raceRoot.className = "race-root";

  const lanesEl = document.createElement("div");
  lanesEl.className = "race-lanes";
  lanesEl.dataset.lanes = String(configs.length);

  const laneUis: LaneUi[] = [];

  for (const config of configs) {
    laneUis.push(buildLanePanel(lanesEl, config));
  }

  const transport = document.createElement("div");
  transport.className = "race-transport";

  const skipStartBtn = document.createElement("button");
  skipStartBtn.type = "button";
  skipStartBtn.textContent = "Skip start";

  const stepBackBtn = document.createElement("button");
  stepBackBtn.type = "button";
  stepBackBtn.textContent = "Step back";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.textContent = "Play";

  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.textContent = "Pause";

  const skipEndBtn = document.createElement("button");
  skipEndBtn.type = "button";
  skipEndBtn.textContent = "Skip end";

  const stepEventBtn = document.createElement("button");
  stepEventBtn.type = "button";
  stepEventBtn.textContent = "Step event";

  const stepOpBtn = document.createElement("button");
  stepOpBtn.type = "button";
  stepOpBtn.textContent = "Step op";

  const transportButtons = document.createElement("div");
  transportButtons.className = "lens-transport";
  transportButtons.append(
    skipStartBtn,
    stepBackBtn,
    playBtn,
    pauseBtn,
    skipEndBtn,
    stepEventBtn,
    stepOpBtn,
  );

  const speedLabel = document.createElement("label");
  speedLabel.className = "lens-speed";
  speedLabel.textContent = "Speed ";

  const speedSelect = document.createElement("select");
  speedSelect.id = "race-speed-select";
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

  const bannerEl = document.createElement("p");
  bannerEl.className = "race-banner";
  bannerEl.hidden = true;

  const statusEl = document.createElement("p");
  statusEl.className = "lens-status";
  statusEl.hidden = true;

  transport.append(transportButtons, speedLabel, scrubLabel, bannerEl, statusEl);
  raceRoot.append(lanesEl, transport);
  root.append(header, raceRoot);

  const pool = new RaceWorkerPool();
  let race: RaceScheduler | null = null;
  let finishVertex: number | null = null;
  let rafId = 0;
  let stopped = false;

  /** True while the user is dragging the scrubber thumb. */
  let scrubberPointerDown = false;

  /**
   * @param work - Current applied work cursor.
   * @param total - Upper bound on billed ops for the scrubber.
   */
  function formatWorkLabel(work: number, total: number): string {
    return `${String(Math.floor(work))} / ${String(total)}`;
  }

  /**
   * Scrubber max: full trace when every lane is done, otherwise stream cap.
   */
  function scrubberTotal(): number {
    if (race === null) {
      return 0;
    }
    if (race.allComplete) {
      return race.maxTotalWork;
    }
    return Math.max(race.streamCap, 1);
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
   * Sync scrubber and work label to the live race cursor.
   */
  function syncScrubberUi(): void {
    if (race === null) {
      workLabel.textContent = "0 / 0";
      if (!scrubberPointerDown) {
        scrubber.value = "0";
      }
      return;
    }

    const total = scrubberTotal();
    workLabel.textContent = formatWorkLabel(race.appliedCursor, total);
    scrubber.max = String(total);
    if (!scrubberPointerDown) {
      scrubber.value = String(Math.floor(race.appliedCursor));
    }
  }

  /**
   * Update photo-finish banner visibility and text.
   */
  function syncBanner(): void {
    if (race === null || finishVertex === null || !race.allPhotoFrozen()) {
      bannerEl.hidden = true;
      return;
    }

    bannerEl.hidden = false;
    const activeRace = race;
    bannerEl.textContent = formatRaceBanner(
      configs.map((config, lane) => ({
        label: config.label,
        work: activeRace.laneState(lane).work,
      })),
    );
  }

  /**
   * Paint every lane and refresh counters, scrubber, and banner.
   */
  function drawFrame(): void {
    if (race === null || finishVertex === null) {
      return;
    }

    for (let lane = 0; lane < configs.length; lane += 1) {
      const ui = laneUis[lane];
      if (ui === undefined) {
        continue;
      }

      const state = race.laneState(lane);
      const renderer = ui.renderer;
      if (renderer !== null) {
        renderer.draw(state, {
          source: SOURCE_VERTEX,
          finish: finishVertex,
          photoFinish: race.lanePhotoFrozen(lane),
        });
      }

      const counters = raceCountersFromLane(state);
      ui.comparisonsValue.textContent = String(counters.comparisons);
      ui.heapValue.textContent = String(counters.heapOps);
      ui.dstructValue.textContent = String(counters.dstructOps);
      ui.relaxValue.textContent = String(counters.relaxations);
      ui.outOfOrderValue.textContent = String(counters.outOfOrderSettles);
      ui.progress.value =
        counters.n === 0 ? 0 : Math.round((100 * counters.settledCount) / counters.n);
    }

    syncScrubberUi();
    syncBanner();
  }

  /**
   * Terminate any in-flight workers and post a fresh multi-lane trace run.
   */
  function startRun(): void {
    pool.terminate();
    race = null;
    finishVertex = null;
    scrubber.value = "0";
    scrubber.max = "0";
    workLabel.textContent = "0 / 0";
    bannerEl.hidden = true;

    for (const ui of laneUis) {
      ui.comparisonsValue.textContent = "0";
      ui.heapValue.textContent = "0";
      ui.dstructValue.textContent = "0";
      ui.relaxValue.textContent = "0";
      ui.outOfOrderValue.textContent = "0";
      ui.progress.value = 0;
      ui.renderer = null;
    }

    clearStatus();

    const speed = Number(speedSelect.value);
    if (!Number.isFinite(speed)) {
      showStatus(`invalid speed select value: ${speedSelect.value}`);
      return;
    }

    const spec: RaceSpec = {
      kind: raceState.g,
      n: raceState.n,
      seed: raceState.seed,
      source: SOURCE_VERTEX,
      lanes: configs.map((config) => config.algo),
    };

    pool.start(spec, {
      onGraph: (graph) => {
        race = new RaceScheduler(graph, configs.length, SOURCE_VERTEX);
        race.setSpeed(speed);

        const resolution = resolveRaceFinishVertex(graph, SOURCE_VERTEX, raceState.target);
        if (resolution.status !== null) {
          showStatus(resolution.status);
        } else {
          clearStatus();
        }
        if (resolution.finish === null) {
          return;
        }

        finishVertex = resolution.finish;
        race.setFinishVertex(resolution.finish);

        for (let lane = 0; lane < configs.length; lane += 1) {
          const ui = laneUis[lane];
          if (ui === undefined) {
            continue;
          }
          ui.renderer = new Renderer({
            target: wrapDomCanvas(ui.canvas),
            createSurface: createDomSurface,
            graph,
          });
        }

        drawFrame();
      },
      onChunk: (lane, chunk) => {
        if (race === null) {
          showStatus("chunk received before graph");
          return;
        }
        race.appendChunk(lane, chunk);
        syncScrubberUi();
        drawFrame();
      },
      onLaneDone: (lane) => {
        if (race === null) {
          showStatus("done received before graph");
          return;
        }
        race.markLaneComplete(lane);
        syncScrubberUi();
        drawFrame();
      },
      onError: (_lane, message) => {
        showStatus(message);
      },
    });
  }

  scrubber.addEventListener("pointerdown", () => {
    scrubberPointerDown = true;
  });

  const onScrubberPointerRelease = (): void => {
    scrubberPointerDown = false;
  };

  window.addEventListener("pointerup", onScrubberPointerRelease);
  window.addEventListener("pointercancel", onScrubberPointerRelease);

  skipStartBtn.addEventListener("click", () => {
    race?.pause();
    race?.seek(0);
    drawFrame();
  });

  stepBackBtn.addEventListener("click", () => {
    if (race === null) {
      return;
    }
    race.pause();
    race.seek(Math.max(0, race.appliedCursor - 1));
    drawFrame();
  });

  playBtn.addEventListener("click", () => {
    race?.play();
  });

  pauseBtn.addEventListener("click", () => {
    race?.pause();
  });

  skipEndBtn.addEventListener("click", () => {
    if (race === null) {
      return;
    }
    race.pause();
    const end = race.allComplete ? race.maxTotalWork : race.streamCap;
    race.seek(end);
    drawFrame();
  });

  stepEventBtn.addEventListener("click", () => {
    race?.pause();
    race?.stepEvent();
    drawFrame();
  });

  stepOpBtn.addEventListener("click", () => {
    race?.pause();
    race?.stepOp();
    drawFrame();
  });

  speedSelect.addEventListener("change", () => {
    const speed = Number(speedSelect.value);
    if (!Number.isFinite(speed)) {
      showStatus(`invalid speed select value: ${speedSelect.value}`);
      return;
    }
    race?.setSpeed(speed);
  });

  scrubber.addEventListener("input", () => {
    if (race === null) {
      return;
    }
    const t = Number(scrubber.value);
    if (!Number.isFinite(t)) {
      showStatus(`invalid scrubber value: ${scrubber.value}`);
      return;
    }
    race.seek(t);
    drawFrame();
  });

  let lastFrameMs = performance.now();

  /**
   * Stop rAF loop, terminate workers, and remove global pointer listeners.
   */
  function teardown(): void {
    stopped = true;
    cancelAnimationFrame(rafId);
    pool.terminate();
    race = null;
    window.removeEventListener("pointerup", onScrubberPointerRelease);
    window.removeEventListener("pointercancel", onScrubberPointerRelease);
  }

  /**
   * Animation frame: advance race when playing, then redraw when ready.
   */
  function frame(nowMs: number): void {
    if (stopped) {
      return;
    }

    const dtSeconds = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;

    if (race !== null && race.clock.playing) {
      race.advance(dtSeconds);
      drawFrame();
    }

    rafId = requestAnimationFrame(frame);
  }

  startRun();
  rafId = requestAnimationFrame(frame);
}

/**
 * Build one lane panel and append it to the lanes container.
 *
 * @param parent - `.race-lanes` element.
 * @param config - Lane label, persona, and algorithm binding.
 */
function buildLanePanel(parent: HTMLElement, config: RaceLaneConfig): LaneUi {
  const laneEl = document.createElement("div");
  laneEl.className = "race-lane";
  laneEl.dataset.persona = config.persona;

  const labelEl = document.createElement("span");
  labelEl.className = "race-lane-label";
  labelEl.textContent = config.label;

  const canvas = document.createElement("canvas");
  canvas.className = "race-canvas";
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  const counters = document.createElement("div");
  counters.className = "race-counters";

  const comparisonsBlock = createCounterBlock("Comparisons", "race-counter-headline");
  const heapBlock = createCounterBlock("Heap ops", "race-counter-secondary");
  const dstructBlock = createCounterBlock("D ops", "race-counter-secondary");
  const relaxBlock = createCounterBlock("Relaxations", "race-counter-secondary");
  const outOfOrderBlock = createCounterBlock("Out of order", "race-counter-secondary");

  const secondaryRow = document.createElement("div");
  secondaryRow.className = "lens-counter-row";
  secondaryRow.append(heapBlock.block, dstructBlock.block, relaxBlock.block, outOfOrderBlock.block);

  counters.append(comparisonsBlock.block, secondaryRow);

  const progress = document.createElement("progress");
  progress.className = "race-progress";
  progress.max = 100;
  progress.value = 0;

  laneEl.append(labelEl, canvas, counters, progress);
  parent.append(laneEl);

  return {
    comparisonsValue: comparisonsBlock.value,
    heapValue: heapBlock.value,
    dstructValue: dstructBlock.value,
    relaxValue: relaxBlock.value,
    outOfOrderValue: outOfOrderBlock.value,
    progress,
    canvas,
    renderer: null,
  };
}

/**
 * @param labelText - Counter label shown beside the value.
 * @param className - Additional class on the counter block.
 */
function createCounterBlock(
  labelText: string,
  className: string,
): { block: HTMLDivElement; value: HTMLSpanElement } {
  const block = document.createElement("div");
  block.className = `lens-counter ${className}`;

  const label = document.createElement("span");
  label.className = "lens-counter-label";
  label.textContent = labelText;

  const value = document.createElement("span");
  value.className = "race-counter-value";
  value.textContent = "0";

  block.append(label, value);
  return { block, value };
}
