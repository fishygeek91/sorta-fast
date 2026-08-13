/**
 * Story mode UI: guided tour playback without gallery, export, or scrubber (issue #19).
 */

import { resolveBmsspRunParams } from "../harness/bmsspRunParams.ts";
import { RaceWorkerPool, type RaceSpec } from "../harness/racePool.ts";
import { RaceScheduler } from "../harness/raceScheduler.ts";
import { createDomSurface, wrapDomCanvas } from "../render/domSurface.ts";
import { Renderer } from "../render/renderer.ts";
import { THEMES, type ThemeMode } from "../render/theme.ts";
import { formatBmsspNarration } from "./narration.ts";
import { raceCountersFromLane } from "./photoFinish.ts";
import { DEFAULT_RACE_URL, serializeRaceUrl } from "./raceUrl.ts";
import { applyStoryStep, type StoryDrive, type StoryLaneTotals } from "./storyDrive.ts";
import {
  nextStoryStepId,
  prevStoryStepId,
  STORY_SCROLL_THRESHOLD_PX,
  STORY_SPEED,
  storyStepById,
  type StoryStepId,
} from "./storyScript.ts";
import { parseStoryUrl, serializeStoryUrl, type StoryUrlState } from "./storyUrl.ts";
import { mountThemeToggle, readStoredTheme } from "./themeToggle.ts";
import { serializeLensUrl } from "./urlState.ts";

const CANVAS_SIZE = 400;
const SOURCE_VERTEX = 0;
const URL_WRITE_THROTTLE_MS = 250;

type StoryLaneUi = {
  laneEl: HTMLDivElement;
  comparisonsBlock: HTMLDivElement;
  comparisonsValue: HTMLSpanElement;
  canvas: HTMLCanvasElement;
  renderer: Renderer | null;
};

/**
 * Mount Story mode into `#app`: guided-tour beats with dual-lane worker playback.
 *
 * Parses and canonicalizes story URL params on boot. Slim shell — no gallery,
 * export, disclosures, or scrubber. Exits to Race via Skip, final Next, or mode nav.
 *
 * @throws If `#app` is missing from `index.html`.
 */
export function mountStory(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root === null) {
    throw new Error("Missing #app root element in index.html");
  }
  let storyState: StoryUrlState = parseStoryUrl(window.location.search);
  history.replaceState(null, "", serializeStoryUrl(storyState) + window.location.hash);
  let bootPendingT = storyState.t;
  root.replaceChildren();
  const shell = document.createElement("div");
  shell.className = "story-root";
  const header = document.createElement("header");
  header.className = "lens-header";
  const title = document.createElement("h1");
  title.className = "lens-title";
  title.textContent = "Sorta Fast";
  const subtitle = document.createElement("p");
  subtitle.className = "lens-subtitle";
  subtitle.textContent = "Story";
  const modeNav = document.createElement("div");
  modeNav.className = "lens-mode-nav";
  const raceModeBtn = document.createElement("button");
  raceModeBtn.type = "button";
  raceModeBtn.textContent = "Race";
  const lensModeBtn = document.createElement("button");
  lensModeBtn.type = "button";
  lensModeBtn.textContent = "Lens";
  const storyModeBtn = document.createElement("button");
  storyModeBtn.type = "button";
  storyModeBtn.textContent = "Story";
  storyModeBtn.disabled = true;
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.id = "story-skip";
  skipBtn.className = "story-skip";
  skipBtn.textContent = "Skip";
  skipBtn.setAttribute("aria-label", "Skip story");
  modeNav.append(raceModeBtn, lensModeBtn, storyModeBtn, skipBtn);
  header.append(title, subtitle, modeNav);
  const captionEl = document.createElement("p");
  captionEl.id = "story-caption";
  captionEl.className = "story-caption";
  captionEl.setAttribute("aria-live", "polite");
  captionEl.textContent = storyStepById(storyState.step).caption;
  const narrationEl = document.createElement("p");
  narrationEl.id = "story-narration";
  narrationEl.className = "story-narration";
  narrationEl.hidden = true;
  const lanesEl = document.createElement("div");
  lanesEl.className = "race-lanes story-lanes";
  lanesEl.dataset.lanes = "1";
  const laneUis: [StoryLaneUi, StoryLaneUi] = [
    buildStoryLane(lanesEl, "Dijkstra", "marble", "story-dijkstra-comparisons"),
    buildStoryLane(lanesEl, "BMSSP", "ember", "story-bmssp-comparisons"),
  ];
  const transport = document.createElement("div");
  transport.className = "story-nav";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.id = "story-back";
  backBtn.textContent = "Back";
  backBtn.disabled = true;
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.id = "story-next";
  nextBtn.textContent = "Next";
  nextBtn.disabled = true;
  transport.append(backBtn, nextBtn);
  const statusEl = document.createElement("p");
  statusEl.id = "story-status";
  statusEl.className = "story-status";
  statusEl.hidden = true;
  shell.append(header, captionEl, narrationEl, lanesEl, transport, statusEl);
  root.append(shell);
  const pool = new RaceWorkerPool();
  let race: RaceScheduler | null = null;
  let currentDrive: StoryDrive | null = null;
  let stepNeedsSeek = true;
  let rafId = 0;
  let stopped = false;
  let lastUrlWriteMs = 0;
  let lastFrameMs = performance.now();
  let wheelAccumulator = 0;
  let pointerStartX = 0;
  let pointerTracking = false;
  mountThemeToggle(modeNav, (mode: ThemeMode) => {
    for (const ui of laneUis) {
      if (ui.renderer !== null) {
        ui.renderer.setChrome(THEMES[mode]);
      }
    }
    drawFrame();
  });
  function writeStoryUrl(): void {
    history.replaceState(null, "", serializeStoryUrl(storyState) + window.location.hash);
  }
  function writeClockToUrl(): void {
    if (race === null) {
      return;
    }
    const t = Math.floor(race.appliedCursor);
    if (t === storyState.t) {
      return;
    }
    storyState = { ...storyState, t };
    writeStoryUrl();
  }
  function showStatus(message: string): void {
    statusEl.textContent = message;
    statusEl.hidden = false;
  }
  function clearStatus(): void {
    statusEl.textContent = "";
    statusEl.hidden = true;
  }
  function syncNavButtons(): void {
    const ready = race !== null && race.allComplete;
    backBtn.disabled = !ready || prevStoryStepId(storyState.step) === null;
    nextBtn.disabled = !ready;
  }
  function syncNarration(): void {
    if (race === null || storyState.step !== "pivots") {
      narrationEl.textContent = "";
      narrationEl.hidden = true;
      return;
    }
    narrationEl.textContent = formatBmsspNarration(race.laneState(1));
    narrationEl.hidden = false;
  }
  function enterFreePlay(): void {
    teardown();
    history.replaceState(null, "", serializeRaceUrl(DEFAULT_RACE_URL) + window.location.hash);
    window.location.reload();
  }
  function enterLens(): void {
    teardown();
    const lensQuery = serializeLensUrl({
      g: storyState.g,
      n: storyState.n,
      seed: storyState.seed,
      algo: "dijkstra",
      bmssp: "demo",
      bk: null,
      bt: null,
    });
    history.replaceState(null, "", lensQuery + "&mode=lens" + window.location.hash);
    window.location.reload();
  }
  function tryApplyStep(): void {
    if (race === null || !race.allComplete) {
      return;
    }
    const totals: StoryLaneTotals = {
      dijkstraWork: race.laneTotalWork(0),
      bmsspWork: race.laneTotalWork(1),
    };
    const drive = applyStoryStep(storyState.step, totals);
    currentDrive = drive;
    captionEl.textContent = drive.caption;
    syncNarration();
    laneUis[0].laneEl.hidden = !drive.showDijkstra;
    laneUis[1].laneEl.hidden = !drive.showBmssp;
    if (drive.callout === "comparisons") {
      laneUis[0].comparisonsBlock.dataset.callout = "comparisons";
    } else {
      delete laneUis[0].comparisonsBlock.dataset.callout;
    }
    lanesEl.dataset.lanes = String((drive.showDijkstra ? 1 : 0) + (drive.showBmssp ? 1 : 0));
    if (bootPendingT > 0) {
      race.seek(bootPendingT);
      bootPendingT = 0;
    } else if (stepNeedsSeek) {
      race.seek(drive.seekT);
      stepNeedsSeek = false;
    }
    if (race.appliedCursor < drive.endT) {
      race.setSpeed(STORY_SPEED);
      race.play();
    } else {
      race.pause();
    }
  }
  function goToStep(step: StoryStepId): void {
    race?.pause();
    storyState = { ...storyState, step, t: 0 };
    writeStoryUrl();
    stepNeedsSeek = true;
    tryApplyStep();
    drawFrame();
    syncNavButtons();
  }
  function goNext(): void {
    const nextId = nextStoryStepId(storyState.step);
    if (nextId === null) {
      enterFreePlay();
    } else {
      goToStep(nextId);
    }
  }
  function goBack(): void {
    const prevId = prevStoryStepId(storyState.step);
    if (prevId !== null) {
      goToStep(prevId);
    }
  }
  function drawFrame(): void {
    if (race === null) {
      return;
    }
    for (let lane = 0; lane < 2; lane += 1) {
      const ui = laneUis[lane];
      const state = race.laneState(lane);
      if (ui.renderer !== null) {
        ui.renderer.draw(state, { source: SOURCE_VERTEX });
      }
      ui.comparisonsValue.textContent = String(raceCountersFromLane(state).comparisons);
    }
    if (storyState.step === "pivots") {
      syncNarration();
    }
  }
  function startRun(): void {
    pool.terminate();
    race = null;
    currentDrive = null;
    clearStatus();
    for (const ui of laneUis) {
      ui.comparisonsValue.textContent = "0";
      ui.renderer = null;
    }
    const params = resolveBmsspRunParams(storyState.n, "demo", null, null);
    const spec: RaceSpec = {
      kind: storyState.g,
      n: storyState.n,
      seed: storyState.seed,
      source: SOURCE_VERTEX,
      mode: "demo",
      lanes: ["dijkstra", "bmssp"],
    };
    pool.start(spec, {
      onGraph: (graph) => {
        race = new RaceScheduler(graph, 2, SOURCE_VERTEX, params.k);
        race.setSpeed(STORY_SPEED);
        for (const ui of laneUis) {
          ui.renderer = new Renderer({
            target: wrapDomCanvas(ui.canvas),
            createSurface: createDomSurface,
            graph,
          });
          ui.renderer.setChrome(THEMES[readStoredTheme()]);
        }
        tryApplyStep();
        syncNavButtons();
        drawFrame();
      },
      onChunk: (lane, chunk) => {
        if (race === null) {
          showStatus("chunk received before graph");
          return;
        }
        race.appendChunk(lane, chunk);
        tryApplyStep();
        drawFrame();
      },
      onLaneDone: (lane) => {
        if (race === null) {
          showStatus("done received before graph");
          return;
        }
        race.markLaneComplete(lane);
        tryApplyStep();
        syncNavButtons();
        drawFrame();
      },
      onError: (_lane, message) => {
        showStatus(message);
      },
    });
  }
  function teardown(): void {
    stopped = true;
    cancelAnimationFrame(rafId);
    pool.terminate();
    race = null;
    shell.removeEventListener("wheel", onWheel);
    lanesEl.removeEventListener("pointerdown", onPointerDown);
    lanesEl.removeEventListener("pointerup", onPointerUp);
    lanesEl.removeEventListener("pointercancel", onPointerCancel);
  }
  function onWheel(event: WheelEvent): void {
    if (race === null || !race.allComplete) {
      return;
    }
    wheelAccumulator += event.deltaY;
    if (Math.abs(wheelAccumulator) < STORY_SCROLL_THRESHOLD_PX) {
      return;
    }
    if (wheelAccumulator > 0) {
      goNext();
    } else {
      goBack();
    }
    wheelAccumulator = 0;
  }
  function onPointerDown(event: PointerEvent): void {
    if (event.target instanceof Element && event.target.closest("button") !== null) {
      return;
    }
    pointerStartX = event.clientX;
    pointerTracking = true;
  }
  function onPointerUp(event: PointerEvent): void {
    if (!pointerTracking) {
      return;
    }
    pointerTracking = false;
    if (race === null || !race.allComplete) {
      return;
    }
    if (event.target instanceof Element && event.target.closest("button") !== null) {
      return;
    }
    const dx = event.clientX - pointerStartX;
    if (Math.abs(dx) < STORY_SCROLL_THRESHOLD_PX) {
      return;
    }
    if (dx < 0) {
      goNext();
    } else {
      goBack();
    }
  }
  function onPointerCancel(): void {
    pointerTracking = false;
  }
  function frame(nowMs: number): void {
    if (stopped) {
      return;
    }
    const dtSeconds = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;
    if (race !== null && race.clock.playing && currentDrive !== null) {
      race.advance(dtSeconds);
      if (race.appliedCursor >= currentDrive.endT) {
        race.pause();
        race.seek(currentDrive.endT);
        writeClockToUrl();
      }
      drawFrame();
      if (nowMs - lastUrlWriteMs >= URL_WRITE_THROTTLE_MS) {
        writeClockToUrl();
        lastUrlWriteMs = nowMs;
      }
    }
    rafId = requestAnimationFrame(frame);
  }
  raceModeBtn.addEventListener("click", () => enterFreePlay());
  lensModeBtn.addEventListener("click", () => enterLens());
  skipBtn.addEventListener("click", () => enterFreePlay());
  backBtn.addEventListener("click", () => goBack());
  nextBtn.addEventListener("click", () => goNext());
  shell.addEventListener("wheel", onWheel, { passive: true });
  lanesEl.addEventListener("pointerdown", onPointerDown);
  lanesEl.addEventListener("pointerup", onPointerUp);
  lanesEl.addEventListener("pointercancel", onPointerCancel);
  startRun();
  rafId = requestAnimationFrame(frame);
}

/** Build one story lane panel and append it to the lanes container. */
function buildStoryLane(
  parent: HTMLElement,
  labelText: string,
  persona: string,
  comparisonsId: string,
): StoryLaneUi {
  const laneEl = document.createElement("div");
  laneEl.className = "race-lane";
  laneEl.dataset.persona = persona;
  const labelEl = document.createElement("span");
  labelEl.className = "race-lane-label";
  labelEl.textContent = labelText;
  const canvas = document.createElement("canvas");
  canvas.className = "race-canvas";
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const counters = document.createElement("div");
  counters.className = "race-counters";
  const comparisonsBlock = document.createElement("div");
  comparisonsBlock.className = "lens-counter race-counter-headline";
  const comparisonsLabel = document.createElement("span");
  comparisonsLabel.className = "lens-counter-label";
  comparisonsLabel.textContent = "Comparisons";
  const comparisonsValue = document.createElement("span");
  comparisonsValue.className = "race-counter-value";
  comparisonsValue.id = comparisonsId;
  comparisonsValue.textContent = "0";
  comparisonsBlock.append(comparisonsLabel, comparisonsValue);
  counters.append(comparisonsBlock);
  laneEl.append(labelEl, canvas, counters);
  parent.append(laneEl);
  return { laneEl, comparisonsBlock, comparisonsValue, canvas, renderer: null };
}
