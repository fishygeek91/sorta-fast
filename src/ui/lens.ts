/**
 * Lens mode UI: single-lane playback with worker-streamed traces (issue #8, #12, #16, #52).
 */

import { CITY_MAX_N, GRAPH_KINDS, SIZE_PRESETS, type GraphKind } from "../core/graph.ts";
import { findPivotsKFromEcho } from "../harness/bmsspRunParams.ts";
import { Playback } from "../harness/playback.ts";
import { createDomSurface, wrapDomCanvas } from "../render/domSurface.ts";
import { Renderer, type OverlayFlags } from "../render/renderer.ts";
import { THEMES, type ThemeMode } from "../render/theme.ts";
import {
  graphFromTraceMessage,
  parseWorkerToMain,
  type TraceRunRequest,
} from "../workers/protocol.ts";
import { isBmsspUrlMode } from "./bmsspUrl.ts";
import { mountDisclosures } from "./disclosures.ts";
import { mountModeNav } from "./modeNav.ts";
import { formatBmsspNarration } from "./narration.ts";
import { parseRaceUrl, serializeRaceUrl } from "./raceUrl.ts";
import { DEFAULT_STORY_URL, serializeStoryUrl } from "./storyUrl.ts";
import { rollSeed } from "./rollSeed.ts";
import { RACE_CHROME_COPY } from "./siteCopy.ts";
import { mountThemeToggle, readStoredTheme } from "./themeToggle.ts";
import { parseLensUrl, serializeLensUrl, type LensAlgo, type LensUrlState } from "./urlState.ts";

/** Visible canvas edge length in CSS pixels. */
const CANVAS_SIZE = 720;

/** Default play-speed multiplier. */
const DEFAULT_SPEED = 8;

/** Source vertex for Lens Dijkstra runs. */
const SOURCE_VERTEX = 0;

/** Size presets exposed in the graph controls. */
const LENS_SIZE_KEYS = ["S", "M", "L", "XL"] as const;

/** Tooltip on the XL option when city is selected (issue #32). */
const CITY_XL_OPTION_TITLE = "City preset caps at L — see #32";

type LensSizeKey = (typeof LENS_SIZE_KEYS)[number];

/**
 * Lens location query string: canonical lens fields plus `mode=lens`.
 *
 * Race is the default app mount; without `mode=lens` a refresh would load Race
 * even while Lens UI is active (#14).
 */
function lensLocationQuery(state: LensUrlState): string {
  return `${serializeLensUrl(state)}&mode=lens`;
}

/**
 * Mount Lens mode into `#app`: worker-streamed single-lane playback and renderer.
 *
 * Parses and canonicalizes `?g=&n=&seed=&algo=` on boot. Algorithm and graph
 * controls rewrite the URL and restart the worker. Transport, scrubber, overlay
 * toggles, narration, and live counters mirror issues #8 and #12.
 *
 * @throws If `#app` is missing from `index.html`.
 */
export function mountLens(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root === null) {
    throw new Error("Missing #app root element in index.html");
  }

  let lensState: LensUrlState = parseLensUrl(window.location.search);
  history.replaceState(null, "", lensLocationQuery(lensState) + window.location.hash);

  root.replaceChildren();

  const header = document.createElement("header");
  header.className = "lens-header";

  const title = document.createElement("h1");
  title.className = "lens-title";
  title.textContent = "Sorta Fast";

  header.append(title);

  const {
    chrome,
    race: raceModeBtn,
    story: storyModeBtn,
  } = mountModeNav(header, "lens", {
    storyButtonId: "lens-story-button",
  });

  raceModeBtn.addEventListener("click", () => {
    const raceState = parseRaceUrl(window.location.search);
    history.replaceState(
      null,
      "",
      serializeRaceUrl({ ...raceState, mode: "race" }) + window.location.hash,
    );
    window.location.reload();
  });

  storyModeBtn.addEventListener("click", () => {
    history.replaceState(null, "", serializeStoryUrl(DEFAULT_STORY_URL) + window.location.hash);
    window.location.reload();
  });

  const canvas = document.createElement("canvas");
  canvas.className = "lens-canvas";
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  /**
   * Sync lens canvas persona chrome to the active algorithm.
   *
   * @param algo - Lens algorithm slug from URL state.
   */
  function syncLensPersona(algo: LensAlgo): void {
    canvas.dataset.persona = algo === "dijkstra" ? "marble" : "ember";
  }

  syncLensPersona(lensState.algo);

  mountThemeToggle(chrome, (mode: ThemeMode) => {
    if (renderer !== null) {
      renderer.setChrome(THEMES[mode]);
      drawFrame();
    }
  });

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

  const bmsspCounters = document.createElement("div");
  bmsspCounters.className = "lens-counter-row lens-counter-bmssp";

  const depthBlock = document.createElement("div");
  depthBlock.className = "lens-counter lens-counter-secondary";

  const depthLabel = document.createElement("span");
  depthLabel.className = "lens-counter-label";
  depthLabel.textContent = "Recursion";

  const depthValue = document.createElement("span");
  depthValue.className = "lens-counter-value";
  depthValue.textContent = "0";

  depthBlock.append(depthLabel, depthValue);

  const boundBlock = document.createElement("div");
  boundBlock.className = "lens-counter lens-counter-secondary";

  const boundLabel = document.createElement("span");
  boundLabel.className = "lens-counter-label";
  boundLabel.textContent = "Bound";

  const boundValue = document.createElement("span");
  boundValue.className = "lens-counter-value";
  boundValue.textContent = "∞";

  boundBlock.append(boundLabel, boundValue);

  const pullBlock = document.createElement("div");
  pullBlock.className = "lens-counter lens-counter-secondary";

  const pullLabel = document.createElement("span");
  pullLabel.className = "lens-counter-label";
  pullLabel.textContent = "Last pull n";

  const pullValue = document.createElement("span");
  pullValue.className = "lens-counter-value";
  pullValue.textContent = "0";

  pullBlock.append(pullLabel, pullValue);

  const dstructBlock = document.createElement("div");
  dstructBlock.className = "lens-counter lens-counter-secondary";

  const dstructLabel = document.createElement("span");
  dstructLabel.className = "lens-counter-label";
  dstructLabel.textContent = "D ops";

  const dstructValue = document.createElement("span");
  dstructValue.className = "lens-counter-value";
  dstructValue.textContent = "0";

  dstructBlock.append(dstructLabel, dstructValue);
  bmsspCounters.append(depthBlock, boundBlock, pullBlock, dstructBlock);

  counters.append(comparisonsBlock, secondaryCounters, bmsspCounters);

  const narrationEl = document.createElement("p");
  narrationEl.className = "lens-narration";
  narrationEl.textContent = "BMSSP idle";

  const controls = document.createElement("div");
  controls.className = "lens-controls";

  const transport = document.createElement("div");
  transport.className = "lens-transport";

  const playPauseBtn = document.createElement("button");
  playPauseBtn.type = "button";
  playPauseBtn.className = "transport-play";
  playPauseBtn.textContent = "Play";
  playPauseBtn.setAttribute("aria-pressed", "false");

  const stepEventBtn = document.createElement("button");
  stepEventBtn.type = "button";
  stepEventBtn.textContent = "Step event";
  stepEventBtn.title = RACE_CHROME_COPY.stepEventTitle;

  const stepOpBtn = document.createElement("button");
  stepOpBtn.type = "button";
  stepOpBtn.textContent = "Step op";
  stepOpBtn.title = RACE_CHROME_COPY.stepOpTitle;

  transport.append(playPauseBtn, stepEventBtn, stepOpBtn);

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

  const recursionLabel = document.createElement("label");
  recursionLabel.className = "lens-overlay-toggle";

  const recursionCheckbox = document.createElement("input");
  recursionCheckbox.type = "checkbox";
  recursionCheckbox.checked = true;
  recursionLabel.append(recursionCheckbox, document.createTextNode(" Recursion tint"));

  const pivotLabel = document.createElement("label");
  pivotLabel.className = "lens-overlay-toggle";

  const pivotCheckbox = document.createElement("input");
  pivotCheckbox.type = "checkbox";
  pivotCheckbox.checked = true;
  pivotLabel.append(pivotCheckbox, document.createTextNode(" Pivot flares"));

  const bloomLabel = document.createElement("label");
  bloomLabel.className = "lens-overlay-toggle";

  const bloomCheckbox = document.createElement("input");
  bloomCheckbox.type = "checkbox";
  bloomCheckbox.checked = true;
  bloomLabel.append(bloomCheckbox, document.createTextNode(" Batch blooms"));

  const dstructStripLabel = document.createElement("label");
  dstructStripLabel.className = "lens-overlay-toggle";

  const dstructCheckbox = document.createElement("input");
  dstructCheckbox.type = "checkbox";
  dstructCheckbox.checked = true;
  dstructStripLabel.append(dstructCheckbox, document.createTextNode(" D-structure strip"));

  overlaysEl.append(
    frontierLabel,
    relaxedLabel,
    recursionLabel,
    pivotLabel,
    bloomLabel,
    dstructStripLabel,
  );

  const graphControls = document.createElement("div");
  graphControls.className = "lens-graph-controls";

  const algoLabel = document.createElement("label");
  algoLabel.className = "lens-graph-field";
  algoLabel.textContent = "Algorithm ";

  const algoSelect = document.createElement("select");
  algoSelect.id = "lens-algo-select";
  for (const algo of ["dijkstra", "bmssp"] as const) {
    const option = document.createElement("option");
    option.value = algo;
    option.textContent = algo === "dijkstra" ? "Dijkstra" : "BMSSP";
    algoSelect.append(option);
  }
  algoLabel.append(algoSelect);

  const bmsspLabel = document.createElement("label");
  bmsspLabel.className = "lens-graph-field";
  bmsspLabel.textContent = "BMSSP ";

  const bmsspSelect = document.createElement("select");
  bmsspSelect.id = "lens-bmssp-select";
  bmsspSelect.setAttribute("aria-label", "BMSSP parameter mode");
  const demoOption = document.createElement("option");
  demoOption.value = "demo";
  demoOption.textContent = "Demo (browser-scale)";
  const paperOption = document.createElement("option");
  paperOption.value = "paper";
  paperOption.textContent = "Paper (asymptotic)";
  bmsspSelect.append(demoOption, paperOption);
  bmsspLabel.append(bmsspSelect);

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
  let xlSizeOption: HTMLOptionElement | null = null;
  for (const key of LENS_SIZE_KEYS) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = key === "XL" ? "XL (stress)" : key;
    if (key === "XL") {
      xlSizeOption = option;
    }
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

  const diceButton = document.createElement("button");
  diceButton.type = "button";
  diceButton.id = "lens-dice-button";
  diceButton.textContent = "Dice";
  diceButton.setAttribute("aria-label", "Roll a new seed");

  seedLabel.append(seedInput);

  graphControls.append(algoLabel, bmsspLabel, kindLabel, sizeLabel, seedLabel, diceButton);

  const genProgressWrap = document.createElement("div");
  genProgressWrap.className = "lens-gen-progress-wrap";
  genProgressWrap.hidden = true;

  const genProgressLabel = document.createElement("span");
  genProgressLabel.className = "lens-gen-progress-label";
  genProgressLabel.textContent = "Generating graph";

  const genProgress = document.createElement("progress");
  genProgress.id = "lens-gen-progress";
  genProgress.className = "lens-gen-progress";
  genProgress.max = 100;
  genProgress.value = 0;

  genProgressWrap.append(genProgressLabel, genProgress);

  const statusEl = document.createElement("p");
  statusEl.className = "lens-status";
  statusEl.hidden = true;

  controls.append(
    transport,
    speedLabel,
    scrubLabel,
    overlaysEl,
    graphControls,
    genProgressWrap,
    statusEl,
  );

  root.append(header, canvas, counters, narrationEl, controls);
  mountDisclosures(root);

  const target = wrapDomCanvas(canvas);
  let playback: Playback | null = null;
  let renderer: Renderer | null = null;
  let worker: Worker | null = null;

  const overlays: OverlayFlags = {
    frontier: true,
    relaxedEdges: true,
    recursionTint: true,
    pivotFlares: true,
    batchBlooms: true,
    dstructStrip: true,
  };

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
   * @returns Matching S/M/L/XL preset key, or `"M"` when `n` is not a preset value.
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
   * @param bound - Active BMSSP bound B, or `Infinity` when unset.
   */
  function formatBound(bound: number): string {
    if (!Number.isFinite(bound)) {
      return "∞";
    }
    return String(bound);
  }

  /**
   * Disable XL for city graphs (Delaunay is O(n²); issue #32).
   */
  function syncCityXlOption(): void {
    if (xlSizeOption === null) {
      return;
    }
    if (kindSelect.value === "city") {
      xlSizeOption.disabled = true;
      xlSizeOption.title = CITY_XL_OPTION_TITLE;
    } else {
      xlSizeOption.disabled = false;
      xlSizeOption.removeAttribute("title");
    }
  }

  /**
   * Sync graph control widgets to the current Lens URL state.
   */
  function syncGraphControls(): void {
    algoSelect.value = lensState.algo;
    bmsspSelect.value = lensState.bmssp;
    kindSelect.value = lensState.g;
    sizeSelect.value = sizeKeyForN(lensState.n);
    seedInput.value = String(lensState.seed);
    syncCityXlOption();
  }

  /**
   * Sync canvas persona and BMSSP-only counter row for the active algo.
   */
  function syncAlgoUi(): void {
    syncLensPersona(lensState.algo);
    bmsspCounters.hidden = lensState.algo !== "bmssp";
  }

  /**
   * Refresh the narration strip from playback state and active algorithm.
   */
  function syncNarration(): void {
    if (playback === null) {
      narrationEl.textContent = lensState.algo === "bmssp" ? "BMSSP idle" : "Dijkstra";
      return;
    }
    if (lensState.algo === "bmssp") {
      narrationEl.textContent = formatBmsspNarration(playback.state);
    } else {
      narrationEl.textContent = "Dijkstra";
    }
  }

  syncGraphControls();
  syncAlgoUi();

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
   * Show graph-generation progress from worker ratio in [0, 1].
   *
   * @param ratio - Generation progress fraction.
   */
  function showGenProgress(ratio: number): void {
    genProgressWrap.hidden = false;
    genProgress.value = Math.round(100 * ratio);
  }

  /**
   * Hide the graph-generation progress bar after handoff or restart.
   */
  function hideGenProgress(): void {
    genProgress.value = 100;
    genProgressWrap.hidden = true;
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
      depthValue.textContent = "0";
      boundValue.textContent = "∞";
      pullValue.textContent = "0";
      dstructValue.textContent = "0";
      return;
    }

    const state = playback.state;
    comparisonsValue.textContent = String(Math.floor(state.work));
    heapValue.textContent = String(state.heapOps);
    relaxValue.textContent = String(state.relaxations);

    if (lensState.algo === "bmssp") {
      depthValue.textContent = String(state.recursionDepth);
      boundValue.textContent = formatBound(state.currentBound);
      pullValue.textContent = String(state.lastPullN);
      dstructValue.textContent = String(state.dstructOps);
    }
  }

  /**
   * Sync Play/Pause toggle label and aria-pressed to the work clock.
   */
  function syncPlayPauseUi(): void {
    const playing = playback !== null && playback.clock.playing;
    playPauseBtn.textContent = playing ? "Pause" : "Play";
    playPauseBtn.setAttribute("aria-pressed", playing ? "true" : "false");
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
    syncNarration();
    syncPlayPauseUi();
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
    depthValue.textContent = "0";
    boundValue.textContent = "∞";
    pullValue.textContent = "0";
    dstructValue.textContent = "0";
    syncNarration();
    syncPlayPauseUi();
    clearStatus();
    showGenProgress(0);

    const speed = Number(speedSelect.value);
    if (!Number.isFinite(speed)) {
      showStatus(`invalid speed select value: ${speedSelect.value}`);
      return;
    }

    // Vite only emits a worker chunk when new Worker(new URL("…", import.meta.url), { type: "module" })
    // is written inline with a static path. Do not assign the URL to a variable first (#48).
    const nextWorker =
      lensState.algo === "bmssp"
        ? new Worker(new URL("../workers/bmsspTrace.ts", import.meta.url), {
            type: "module",
          })
        : new Worker(new URL("../workers/dijkstraTrace.ts", import.meta.url), {
            type: "module",
          });
    worker = nextWorker;

    nextWorker.onmessage = (event: MessageEvent<unknown>): void => {
      const message = parseWorkerToMain(event.data);
      if (message === null) {
        showStatus("unrecognized worker message");
        return;
      }

      switch (message.type) {
        case "progress":
          showGenProgress(message.ratio);
          break;
        case "graph": {
          hideGenProgress();
          const graph = graphFromTraceMessage(message);
          const findPivotsK = findPivotsKFromEcho(
            graph.n,
            message.k,
            lensState.bmssp,
            lensState.bk,
            lensState.bt,
          );
          playback = new Playback(graph, [], findPivotsK);
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
          renderer.setChrome(THEMES[readStoredTheme()]);

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

    const runMessage: TraceRunRequest = {
      type: "run",
      algo: lensState.algo,
      kind: lensState.g,
      n: lensState.n,
      seed: lensState.seed,
      source: SOURCE_VERTEX,
      mode: lensState.bmssp,
    };
    if (lensState.bk !== null) {
      runMessage.k = lensState.bk;
    }
    if (lensState.bt !== null) {
      runMessage.t = lensState.bt;
    }
    nextWorker.postMessage(runMessage);
  }

  /**
   * Rewrite the URL and restart the worker with updated gallery state.
   *
   * @param next - New Lens URL fields.
   */
  function applyLensState(next: LensUrlState): void {
    lensState = next;
    history.replaceState(null, "", lensLocationQuery(lensState) + window.location.hash);
    syncGraphControls();
    syncAlgoUi();
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

  playPauseBtn.addEventListener("click", () => {
    if (playback === null) {
      return;
    }
    if (playback.clock.playing) {
      playback.pause();
    } else {
      playback.play();
    }
    syncPlayPauseUi();
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
    syncNarration();
  });

  frontierCheckbox.addEventListener("change", () => {
    overlays.frontier = frontierCheckbox.checked;
    drawFrame();
  });

  relaxedCheckbox.addEventListener("change", () => {
    overlays.relaxedEdges = relaxedCheckbox.checked;
    drawFrame();
  });

  recursionCheckbox.addEventListener("change", () => {
    overlays.recursionTint = recursionCheckbox.checked;
    drawFrame();
  });

  pivotCheckbox.addEventListener("change", () => {
    overlays.pivotFlares = pivotCheckbox.checked;
    drawFrame();
  });

  bloomCheckbox.addEventListener("change", () => {
    overlays.batchBlooms = bloomCheckbox.checked;
    drawFrame();
  });

  dstructCheckbox.addEventListener("change", () => {
    overlays.dstructStrip = dstructCheckbox.checked;
    drawFrame();
  });

  algoSelect.addEventListener("change", () => {
    const raw = algoSelect.value;
    if (!isLensAlgo(raw)) {
      showStatus(`invalid algorithm: ${raw}`);
      syncGraphControls();
      return;
    }
    applyLensState({ ...lensState, algo: raw });
  });

  bmsspSelect.addEventListener("change", () => {
    const raw = bmsspSelect.value;
    if (!isBmsspUrlMode(raw)) {
      showStatus(`invalid bmssp mode: ${raw}`);
      syncGraphControls();
      return;
    }
    applyLensState({ ...lensState, bmssp: raw });
  });

  kindSelect.addEventListener("change", () => {
    const raw = kindSelect.value;
    if (!isGraphKind(raw)) {
      showStatus(`invalid graph kind: ${raw}`);
      syncGraphControls();
      return;
    }
    let nextN = lensState.n;
    if (raw === "city" && (lensState.n === SIZE_PRESETS.XL || lensState.n > CITY_MAX_N)) {
      nextN = CITY_MAX_N;
    }
    applyLensState({ ...lensState, g: raw, n: nextN });
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

  diceButton.addEventListener("click", () => {
    applyLensState({ ...lensState, seed: rollSeed() });
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
        syncNarration();
      }
    }

    requestAnimationFrame(frame);
  }

  startRun();
  requestAnimationFrame(frame);
}

/**
 * @param value - Candidate lens algorithm slug from a select option.
 */
function isLensAlgo(value: string): value is LensAlgo {
  return value === "dijkstra" || value === "bmssp";
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
