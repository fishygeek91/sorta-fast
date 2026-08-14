/**
 * Race mode UI: multi-lane playback with worker-streamed traces (issue #14, #15, #16, #18, #52).
 */

import {
  CITY_MAX_N,
  GRAPH_KINDS,
  SIZE_PRESETS,
  type Graph,
  type GraphKind,
} from "../core/graph.ts";
import { resolveBmsspRunParams } from "../harness/bmsspRunParams.ts";
import { RaceWorkerPool, type RaceSpec } from "../harness/racePool.ts";
import { RaceScheduler } from "../harness/raceScheduler.ts";
import { createDomSurface, wrapDomCanvas } from "../render/domSurface.ts";
import { Renderer } from "../render/renderer.ts";
import { THEMES, type ThemeMode } from "../render/theme.ts";
import { isBmsspUrlMode } from "./bmsspUrl.ts";
import { mountDisclosures } from "./disclosures.ts";
import {
  captureCanvasPng,
  exportPhotoFinishWhenPainted,
  triggerDownload,
} from "./exportDownload.ts";
import {
  canExportPhotoFinish,
  exportCaption,
  exportFilename,
  shareUrlForExport,
} from "./exportMeta.ts";
import { paintRaceExportSheet } from "./exportPaint.ts";
import {
  createCanvasRecorder,
  createStreamRecorder,
  exportKindFromMime,
  pickRecorderMimeType,
} from "./exportRecorder.ts";
import { sheetSize, type ExportSheetSpec } from "./exportSheet.ts";
import { mountLens } from "./lens.ts";
import { mountModeNav } from "./modeNav.ts";
import {
  bestInClassSecondary,
  formatRaceBanner,
  raceCountersFromLane,
  rankLaneIndices,
  settleLead,
  type RaceLaneCounters,
} from "./photoFinish.ts";
import { mountStory } from "./story.ts";
import { DEFAULT_STORY_URL, isStorySearch, serializeStoryUrl } from "./storyUrl.ts";
import { RACE_CHROME_COPY, explainerMeaning, personaTitle } from "./siteCopy.ts";
import { resolveRaceFinishVertex } from "./raceFinish.ts";
import { lanesFromSearch, type RaceLaneConfig } from "./raceLanes.ts";
import { parseRaceUrl, serializeRaceUrl, type RaceAlgoSlug, type RaceUrlState } from "./raceUrl.ts";
import { rollSeed } from "./rollSeed.ts";
import { mountThemeToggle, readStoredTheme } from "./themeToggle.ts";
import { applyRaceCanvasBackingStore, RACE_LANE_CSS_PX } from "./raceLaneSize.ts";

/** Default play-speed multiplier. */
const DEFAULT_SPEED = 8;

/** Source vertex for race SSSP runs. */
const SOURCE_VERTEX = 0;

/** Size presets exposed in the race graph gallery (includes XL). */
const RACE_SIZE_KEYS = ["S", "M", "L", "XL"] as const;

/** Tooltip on the XL option when city is selected (issue #32). */
const CITY_XL_OPTION_TITLE = "City preset caps at L — see #32";

type RaceSizeKey = (typeof RACE_SIZE_KEYS)[number];

/** Lane-count presets in the race gallery select. */
const RACE_LANES_KEYS = ["two", "three"] as const;

type RaceLanesKey = (typeof RACE_LANES_KEYS)[number];

/** Two-lane race: Dijkstra vs BMSSP. */
const TWO_LANE_RACE: readonly RaceAlgoSlug[] = ["dijkstra", "bmssp"];

/** Three-lane race: Dijkstra vs BMSSP vs Dijkstra B. */
const THREE_LANE_RACE: readonly RaceAlgoSlug[] = ["dijkstra", "bmssp", "dijkstra"];

/** Minimum interval between URL `t` writes while playback is running. */
const URL_WRITE_THROTTLE_MS = 250;

/**
 * Milliseconds to keep painting the export sheet after photo-freeze before stopping WebM capture.
 * Ensures MediaRecorder encodes the winner banner frame (captureStream often misses same-turn paints).
 */
const EXPORT_BANNER_HOLD_MS = 1500;

/** Photo-finish winner chip copy (issue #63). Lower billed work wins. */
const WINNER_CHIP_TEXT = "Winner — lowest work";

/** Visually-hidden suffix appended to a best-in-class secondary counter (issue #63). */
const BEST_IN_CLASS_NOTE = " — lowest on this race";

/** Next suffix for unique `race-counter-desc-*` element ids. */
let raceCounterDescSeq = 0;

/** DOM handles for one race lane panel. */
type LaneUi = {
  laneEl: HTMLDivElement;
  winnerEl: HTMLSpanElement;
  leadEl: HTMLSpanElement;
  comparisonsValue: HTMLSpanElement;
  heapBlock: HTMLDivElement;
  heapValue: HTMLSpanElement;
  dstructBlock: HTMLDivElement;
  dstructValue: HTMLSpanElement;
  relaxBlock: HTMLDivElement;
  relaxValue: HTMLSpanElement;
  outOfOrderBlock: HTMLDivElement;
  outOfOrderValue: HTMLSpanElement;
  progress: HTMLProgressElement;
  settledLabel: HTMLSpanElement;
  canvas: HTMLCanvasElement;
  renderer: Renderer | null;
};

/**
 * Mount Race mode into `#app`: multi-lane worker-streamed playback and renderers.
 *
 * Parses and canonicalizes race URL params on boot. When `mode=story`, delegates
 * to {@link mountStory} (peek via {@link isStorySearch}; {@link RaceUrlState.mode}
 * stays `race` | `lens`). When `mode=lens`, delegates to {@link mountLens}. Transport,
 * scrubber, photo-finish banner, and per-lane counters mirror issue #14.
 *
 * @throws If `#app` is missing from `index.html`.
 */
export function mountRace(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root === null) {
    throw new Error("Missing #app root element in index.html");
  }

  if (isStorySearch(window.location.search)) {
    mountStory();
    return;
  }

  let raceState: RaceUrlState = parseRaceUrl(window.location.search);
  if (raceState.mode === "lens") {
    mountLens();
    return;
  }

  history.replaceState(null, "", serializeRaceUrl(raceState) + window.location.hash);

  const configs = lanesFromRaceState(raceState);
  let pendingT = raceState.t;
  root.replaceChildren();
  root.dataset.mode = "race";

  const header = document.createElement("header");
  header.className = "lens-header";

  const title = document.createElement("h1");
  title.className = "lens-title";
  title.textContent = "Sorta Fast";

  header.append(title);

  const {
    chrome,
    lens: lensModeBtn,
    story: storyModeBtn,
  } = mountModeNav(header, "race", {
    storyButtonId: "race-story-button",
  });

  lensModeBtn.addEventListener("click", () => {
    const next: RaceUrlState = { ...raceState, mode: "lens" };
    history.replaceState(null, "", serializeRaceUrl(next) + window.location.hash);
    teardown();
    mountLens();
  });

  storyModeBtn.addEventListener("click", () => {
    history.replaceState(null, "", serializeStoryUrl(DEFAULT_STORY_URL) + window.location.hash);
    teardown();
    mountStory();
  });

  const graphControls = document.createElement("div");
  graphControls.className = "lens-graph-controls race-gallery";

  const kindLabel = document.createElement("label");
  kindLabel.className = "lens-graph-field";
  kindLabel.textContent = "Graph ";

  const kindSelect = document.createElement("select");
  kindSelect.id = "race-kind-select";
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
  sizeSelect.id = "race-size-select";
  let xlSizeOption: HTMLOptionElement | null = null;
  for (const key of RACE_SIZE_KEYS) {
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
  seedInput.className = "race-seed-input";
  seedInput.step = "1";
  seedLabel.append(seedInput);

  const diceButton = document.createElement("button");
  diceButton.type = "button";
  diceButton.id = "race-dice-button";
  diceButton.textContent = "Dice";
  diceButton.setAttribute("aria-label", "Roll a new seed");
  diceButton.title = RACE_CHROME_COPY.diceTitle;

  const lanesLabel = document.createElement("label");
  lanesLabel.className = "lens-graph-field";
  lanesLabel.textContent = "Lanes ";

  const lanesSelect = document.createElement("select");
  lanesSelect.id = "race-lanes-select";
  const twoLanesOption = document.createElement("option");
  twoLanesOption.value = "two";
  twoLanesOption.textContent = "Dijkstra vs BMSSP";
  const threeLanesOption = document.createElement("option");
  threeLanesOption.value = "three";
  threeLanesOption.textContent = "Dijkstra vs BMSSP vs Dijkstra B";
  lanesSelect.append(twoLanesOption, threeLanesOption);
  lanesLabel.append(lanesSelect);

  const bmsspLabel = document.createElement("label");
  bmsspLabel.className = "lens-graph-field";
  bmsspLabel.textContent = "BMSSP ";

  const bmsspSelect = document.createElement("select");
  bmsspSelect.id = "race-bmssp-select";
  bmsspSelect.setAttribute("aria-label", "BMSSP parameter mode");
  const demoOption = document.createElement("option");
  demoOption.value = "demo";
  demoOption.textContent = "Demo (browser-scale)";
  const paperOption = document.createElement("option");
  paperOption.value = "paper";
  paperOption.textContent = "Paper (asymptotic)";
  bmsspSelect.append(demoOption, paperOption);
  bmsspSelect.title = RACE_CHROME_COPY.bmsspSelectTitle;
  bmsspLabel.append(bmsspSelect);

  graphControls.append(kindLabel, sizeLabel, seedLabel, diceButton, lanesLabel, bmsspLabel);
  header.append(graphControls);

  const raceRoot = document.createElement("div");
  raceRoot.className = "race-root";

  const lanesEl = document.createElement("div");
  lanesEl.className = "race-lanes";
  lanesEl.dataset.lanes = String(configs.length);

  const laneUis: LaneUi[] = [];

  for (const config of configs) {
    laneUis.push(buildLanePanel(lanesEl, config));
  }

  let activeGraph: Graph | null = null;
  let laneResizeObserver: ResizeObserver | null = null;
  let resizeRafId = 0;
  let pendingBackingRebuild = false;

  mountThemeToggle(chrome, (mode: ThemeMode) => {
    for (const ui of laneUis) {
      if (ui.renderer !== null) {
        ui.renderer.setChrome(THEMES[mode]);
      }
    }
    drawFrame();
  });

  const transport = document.createElement("div");
  transport.className = "race-transport";

  const skipStartBtn = document.createElement("button");
  skipStartBtn.type = "button";
  skipStartBtn.textContent = "Skip start";

  const stepBackBtn = document.createElement("button");
  stepBackBtn.type = "button";
  stepBackBtn.textContent = "Step back";

  const playPauseBtn = document.createElement("button");
  playPauseBtn.type = "button";
  playPauseBtn.className = "transport-play";
  playPauseBtn.textContent = "Play";
  playPauseBtn.setAttribute("aria-pressed", "false");

  const skipEndBtn = document.createElement("button");
  skipEndBtn.type = "button";
  skipEndBtn.textContent = "Skip end";

  const stepEventBtn = document.createElement("button");
  stepEventBtn.type = "button";
  stepEventBtn.textContent = "Step event";
  stepEventBtn.title = RACE_CHROME_COPY.stepEventTitle;

  const stepOpBtn = document.createElement("button");
  stepOpBtn.type = "button";
  stepOpBtn.textContent = "Step op";
  stepOpBtn.title = RACE_CHROME_COPY.stepOpTitle;

  const exportPngBtn = document.createElement("button");
  exportPngBtn.type = "button";
  exportPngBtn.id = "race-export-png";
  exportPngBtn.textContent = "PNG";
  exportPngBtn.disabled = true;
  exportPngBtn.setAttribute("aria-label", "Export photo-finish PNG");
  exportPngBtn.title = RACE_CHROME_COPY.exportDisabledTitle;

  const exportWebmBtn = document.createElement("button");
  exportWebmBtn.type = "button";
  exportWebmBtn.id = "race-export-webm";
  exportWebmBtn.textContent = "WebM";
  exportWebmBtn.disabled = true;
  exportWebmBtn.setAttribute("aria-label", "Export race video");
  exportWebmBtn.title = RACE_CHROME_COPY.exportDisabledTitle;

  const playbackGroup = document.createElement("div");
  playbackGroup.className = "transport-playback";
  playbackGroup.append(
    skipStartBtn,
    stepBackBtn,
    playPauseBtn,
    stepEventBtn,
    stepOpBtn,
    skipEndBtn,
  );

  const exportGroup = document.createElement("div");
  exportGroup.className = "transport-export";
  exportGroup.append(exportPngBtn, exportWebmBtn);

  const transportButtons = document.createElement("div");
  transportButtons.className = "lens-transport";
  transportButtons.append(playbackGroup, exportGroup);

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

  const genProgressWrap = document.createElement("div");
  genProgressWrap.className = "race-gen-progress-wrap";
  genProgressWrap.hidden = true;

  const genProgressLabel = document.createElement("span");
  genProgressLabel.className = "race-gen-progress-label";
  genProgressLabel.textContent = "Generating graph";

  const genProgress = document.createElement("progress");
  genProgress.id = "race-gen-progress";
  genProgress.className = "race-gen-progress";
  genProgress.max = 100;
  genProgress.value = 0;

  genProgressWrap.append(genProgressLabel, genProgress);

  const statusEl = document.createElement("p");
  statusEl.className = "lens-status";
  statusEl.hidden = true;

  transport.append(transportButtons, speedLabel, scrubLabel, genProgressWrap, statusEl);

  const legendEl = mountRaceLegend();
  raceRoot.append(bannerEl, lanesEl, legendEl, transport);
  mountDisclosures(raceRoot);
  root.append(header, raceRoot);

  applyAllLaneBackingStores();
  laneResizeObserver = new ResizeObserver(() => {
    onLanesResized();
  });
  laneResizeObserver.observe(lanesEl);

  const pool = new RaceWorkerPool();
  let race: RaceScheduler | null = null;
  let finishVertex: number | null = null;
  let rafId = 0;
  let stopped = false;

  /** True while the user is dragging the scrubber thumb. */
  let scrubberPointerDown = false;

  /** Last time `t` was written to the URL during playback (for throttling). */
  let lastUrlWriteMs = 0;

  /** True while a WebM replay capture is in progress. */
  let recording = false;

  /** True while awaiting {@link finishVideoRecording} after photo-finish freeze. */
  let finishingVideo = false;

  /**
   * True from recording start until {@link RaceScheduler.seek}(0) + play;
   * prevents finishing before the replay begins.
   */
  let recordingAwaitingReplay = false;

  /** MIME type passed to the active canvas recorder. */
  let recordingMimeType = "";

  /** Active canvas recorder during WebM export, or null when idle. */
  let activeCanvasRecorder: ReturnType<typeof createCanvasRecorder> | null = null;

  /** Wall-clock deadline for banner hold before {@link finishVideoRecording}, or null when idle. */
  let recordingHoldUntilMs: number | null = null;

  /** Offscreen sheet canvas reused for PNG and WebM export compositing. */
  let exportSheet: HTMLCanvasElement | null = null;

  /**
   * @param n - Node count from URL state.
   * @returns Matching S/M/L/XL preset key, or `"M"` when `n` is not a preset value.
   */
  function sizeKeyForN(n: number): RaceSizeKey {
    for (const key of RACE_SIZE_KEYS) {
      if (SIZE_PRESETS[key] === n) {
        return key;
      }
    }
    return "M";
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
   * Sync graph gallery widgets to the current race URL state.
   */
  function syncGalleryControls(): void {
    kindSelect.value = raceState.g;
    sizeSelect.value = sizeKeyForN(raceState.n);
    seedInput.value = String(raceState.seed);
    lanesSelect.value = lanesKeyForRace(raceState.race);
    bmsspSelect.value = raceState.bmssp;
    syncCityXlOption();
  }

  /**
   * Write the applied work-clock position into the URL when it changes.
   */
  function writeClockToUrl(): void {
    if (race === null) {
      return;
    }
    const t = Math.floor(race.appliedCursor);
    if (t === raceState.t) {
      return;
    }
    raceState = { ...raceState, t };
    history.replaceState(null, "", serializeRaceUrl(raceState) + window.location.hash);
  }

  /**
   * Seek to {@link pendingT} once enough trace data has streamed in.
   */
  function applyPendingSeek(): void {
    if (race === null || pendingT <= 0) {
      return;
    }
    race.seek(pendingT);
    if (race.appliedCursor >= pendingT || race.allComplete) {
      pendingT = 0;
      writeClockToUrl();
    }
  }

  /**
   * Apply gallery / URL state: remount when lane layout changes, else restart workers.
   *
   * @param next - New race URL fields.
   */
  function applyRaceState(next: RaceUrlState): void {
    const needsRemount =
      next.race.length !== configs.length || !raceCompositionEqual(raceState.race, next.race);

    if (graphGalleryChanged(raceState, next)) {
      next = { ...next, t: 0 };
      pendingT = 0;
    }

    raceState = next;
    history.replaceState(null, "", serializeRaceUrl(raceState) + window.location.hash);
    syncGalleryControls();

    if (needsRemount) {
      teardown();
      mountRace();
      return;
    }

    startRun();
  }

  syncGalleryControls();

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

  /** True when a coalesced paint is already scheduled for the next frame. */
  let paintScheduled = false;

  /**
   * Coalesce multiple chunk/done updates into one paint per animation frame.
   */
  function schedulePaint(): void {
    if (paintScheduled) {
      return;
    }
    paintScheduled = true;
    requestAnimationFrame(() => {
      paintScheduled = false;
      drawFrame();
    });
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
   * Set or clear best-in-class marks on a secondary counter block (dirty-checked).
   *
   * Uses a visually-hidden note so the counter label and value stay the
   * accessible name (an `aria-label` on the block would replace them).
   *
   * @param block - Secondary counter container element.
   * @param isBest - Whether this lane ties for the lowest value on that counter.
   */
  function applyBestMark(block: HTMLElement, isBest: boolean): void {
    if (isBest) {
      if (block.dataset.best !== "true") {
        block.dataset.best = "true";
      }
    } else if (block.dataset.best !== undefined) {
      delete block.dataset.best;
    }

    const note = block.querySelector(".race-best-note");
    if (!(note instanceof HTMLElement)) {
      return;
    }
    if (note.hidden === isBest) {
      note.hidden = !isBest;
    }
  }

  /**
   * Hide winner/lead chips and clear best-in-class marks on every lane.
   */
  function clearStanding(): void {
    for (const ui of laneUis) {
      if (ui.winnerEl.hidden !== true) {
        ui.winnerEl.hidden = true;
      }
      if (ui.leadEl.hidden !== true) {
        ui.leadEl.hidden = true;
      }
      applyBestMark(ui.heapBlock, false);
      applyBestMark(ui.dstructBlock, false);
      applyBestMark(ui.relaxBlock, false);
      applyBestMark(ui.outOfOrderBlock, false);
    }
  }

  /**
   * Sync per-lane winner chip, settle-count lead, and best-in-class secondary marks.
   *
   * @param counterRows - Per-lane counters already read in {@link drawFrame}.
   */
  function syncStanding(counterRows: readonly RaceLaneCounters[]): void {
    if (race === null || finishVertex === null) {
      clearStanding();
      return;
    }

    const activeRace = race;

    const allFrozen = activeRace.allPhotoFrozen();
    let anyFrozen = false;
    for (let lane = 0; lane < configs.length; lane += 1) {
      if (activeRace.lanePhotoFrozen(lane)) {
        anyFrozen = true;
        break;
      }
    }

    if (allFrozen) {
      for (const ui of laneUis) {
        if (ui.leadEl.hidden !== true) {
          ui.leadEl.hidden = true;
        }
      }

      const bannerLanes = configs.map((config, lane) => {
        const row = counterRows[lane];
        return {
          label: config.label,
          work: row === undefined ? 0 : row.comparisons,
        };
      });
      const ranked = rankLaneIndices(bannerLanes);
      const winnerIndex = ranked[0];

      for (let lane = 0; lane < laneUis.length; lane += 1) {
        const ui = laneUis[lane];
        if (ui === undefined) {
          continue;
        }

        const isWinner = winnerIndex !== undefined && lane === winnerIndex;
        if (ui.winnerEl.hidden === isWinner) {
          ui.winnerEl.hidden = !isWinner;
        }
        if (isWinner && ui.winnerEl.textContent !== WINNER_CHIP_TEXT) {
          ui.winnerEl.textContent = WINNER_CHIP_TEXT;
        }
      }

      const flags = bestInClassSecondary(counterRows);
      for (let lane = 0; lane < laneUis.length; lane += 1) {
        const ui = laneUis[lane];
        const laneFlags = flags[lane];
        if (ui === undefined || laneFlags === undefined) {
          continue;
        }
        applyBestMark(ui.heapBlock, laneFlags.heapOps);
        applyBestMark(ui.dstructBlock, laneFlags.dstructOps);
        applyBestMark(ui.relaxBlock, laneFlags.relaxations);
        applyBestMark(ui.outOfOrderBlock, laneFlags.outOfOrderSettles);
      }
      return;
    }

    if (!anyFrozen) {
      for (const ui of laneUis) {
        if (ui.winnerEl.hidden !== true) {
          ui.winnerEl.hidden = true;
        }
        applyBestMark(ui.heapBlock, false);
        applyBestMark(ui.dstructBlock, false);
        applyBestMark(ui.relaxBlock, false);
        applyBestMark(ui.outOfOrderBlock, false);
      }

      const lead = settleLead(counterRows.map((c) => c.settledCount));
      if (lead === null) {
        for (const ui of laneUis) {
          if (ui.leadEl.hidden !== true) {
            ui.leadEl.hidden = true;
          }
        }
        return;
      }

      const leadText = `Ahead by ${String(lead.margin)} settles`;
      for (let lane = 0; lane < laneUis.length; lane += 1) {
        const ui = laneUis[lane];
        if (ui === undefined) {
          continue;
        }
        const isLeader = lane === lead.leaderIndex;
        if (ui.leadEl.hidden === isLeader) {
          ui.leadEl.hidden = !isLeader;
        }
        if (isLeader && ui.leadEl.textContent !== leadText) {
          ui.leadEl.textContent = leadText;
        }
      }
      return;
    }

    // Partial freeze: first frozen lane stops settling while others continue, so
    // settle-count leadership would invert — hide winner/lead and best marks.
    for (const ui of laneUis) {
      if (ui.winnerEl.hidden !== true) {
        ui.winnerEl.hidden = true;
      }
      if (ui.leadEl.hidden !== true) {
        ui.leadEl.hidden = true;
      }
      applyBestMark(ui.heapBlock, false);
      applyBestMark(ui.dstructBlock, false);
      applyBestMark(ui.relaxBlock, false);
      applyBestMark(ui.outOfOrderBlock, false);
    }
  }

  /**
   * @returns Whether PNG/WebM export buttons should be interactive.
   */
  function exportButtonsEnabled(): boolean {
    return race !== null && canExportPhotoFinish(race.allPhotoFrozen()) && !recording;
  }

  /**
   * Sync PNG/WebM export button disabled state.
   */
  function syncExportButtons(): void {
    const enabled = exportButtonsEnabled();
    exportPngBtn.disabled = !enabled;
    exportWebmBtn.disabled = !enabled;
    exportPngBtn.title = enabled ? "Export photo-finish PNG" : RACE_CHROME_COPY.exportDisabledTitle;
    exportWebmBtn.title = enabled ? "Export race video" : RACE_CHROME_COPY.exportDisabledTitle;
  }

  /**
   * Sync Play/Pause toggle label and aria-pressed to the work clock.
   */
  function syncPlayPauseUi(): void {
    const playing = race !== null && race.clock.playing;
    playPauseBtn.textContent = playing ? "Pause" : "Play";
    playPauseBtn.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  /**
   * Enable or disable gallery and transport controls during WebM recording.
   */
  function syncRecordingControls(): void {
    const disabled = recording;
    kindSelect.disabled = disabled;
    sizeSelect.disabled = disabled;
    seedInput.disabled = disabled;
    diceButton.disabled = disabled;
    lanesSelect.disabled = disabled;
    bmsspSelect.disabled = disabled;
    speedSelect.disabled = disabled;
    skipStartBtn.disabled = disabled;
    stepBackBtn.disabled = disabled;
    playPauseBtn.disabled = disabled;
    skipEndBtn.disabled = disabled;
    stepEventBtn.disabled = disabled;
    stepOpBtn.disabled = disabled;
    scrubber.disabled = disabled;
    if (recording) {
      exportWebmBtn.dataset.recording = "true";
    } else {
      delete exportWebmBtn.dataset.recording;
    }
    exportWebmBtn.textContent = recording ? "Recording…" : "WebM";
  }

  /**
   * Reset recording state and re-enable controls after WebM export ends or is aborted.
   */
  function restoreRecordingUi(): void {
    recording = false;
    recordingAwaitingReplay = false;
    recordingMimeType = "";
    recordingHoldUntilMs = null;
    activeCanvasRecorder = null;
    exportWebmBtn.textContent = "WebM";
    syncRecordingControls();
    syncExportButtons();
    syncPlayPauseUi();
    if (pendingBackingRebuild) {
      pendingBackingRebuild = false;
      applyAllLaneBackingStores();
      rebuildLaneRenderers();
      drawFrame();
    }
  }

  /**
   * Create or resize the offscreen export sheet canvas for the current lane count.
   *
   * @returns Sheet canvas, or null when `document` is unavailable.
   */
  function ensureSheetCanvas(): HTMLCanvasElement | null {
    if (typeof document === "undefined") {
      return null;
    }
    const { width, height } = sheetSize(configs.length);
    if (exportSheet === null) {
      exportSheet = document.createElement("canvas");
    }
    if (exportSheet.width !== width || exportSheet.height !== height) {
      exportSheet.width = width;
      exportSheet.height = height;
    }
    return exportSheet;
  }

  /**
   * Build export sheet content from the live race and gallery state.
   *
   * @throws When no race is mounted.
   */
  function buildExportSheetSpec(): ExportSheetSpec {
    const activeRace = race;
    if (activeRace === null) {
      throw new Error("cannot build export sheet without active race");
    }

    const theme = THEMES[readStoredTheme()];
    const shareUrl = shareUrlForExport(raceState);
    const caption = exportCaption(raceState, shareUrl);

    const lanes = configs.map((config, lane) => {
      const ui = laneUis[lane];
      if (ui === undefined) {
        throw new Error(`missing lane UI at index ${String(lane)}`);
      }
      const state = activeRace.laneState(lane);
      return {
        label: config.label,
        comparisons: raceCountersFromLane(state).comparisons,
        canvas: ui.canvas,
      };
    });

    return {
      lanes,
      banner: activeRace.allPhotoFrozen()
        ? formatRaceBanner(
            configs.map((config, lane) => ({
              label: config.label,
              work: activeRace.laneState(lane).work,
            })),
          )
        : "",
      seedLine: caption.seedLine,
      urlLine: caption.urlLine,
      chrome: {
        paper: theme.paper,
        ink: theme.ink,
        muted: theme.muted,
        gold: theme.gold,
      },
    };
  }

  /**
   * Composite lane tiles and footer onto the offscreen export sheet.
   *
   * @returns `true` when the sheet was painted; `false` when status was shown instead.
   */
  function paintExportSheet(): boolean {
    const sheet = ensureSheetCanvas();
    if (sheet === null) {
      showStatus("export sheet canvas unavailable");
      return false;
    }
    try {
      paintRaceExportSheet(sheet, buildExportSheetSpec());
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showStatus(message);
      return false;
    }
  }

  /**
   * Stop an in-flight WebM capture, download the blob, and restore UI.
   *
   * Idempotent: guarded by the `recording` flag.
   */
  async function finishVideoRecording(): Promise<void> {
    if (!recording || finishingVideo) {
      return;
    }

    recordingHoldUntilMs = null;
    finishingVideo = true;
    recordingAwaitingReplay = false;
    race?.pause();

    const recorder = activeCanvasRecorder;
    const mime = recordingMimeType;
    activeCanvasRecorder = null;
    recordingMimeType = "";

    try {
      if (recorder !== null) {
        const blob = await recorder.stop();
        triggerDownload(blob, exportFilename(raceState, exportKindFromMime(mime)));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showStatus(message);
    } finally {
      finishingVideo = false;
      restoreRecordingUi();
    }
  }

  /**
   * Paint every lane and refresh counters, scrubber, and banner.
   */
  function drawFrame(): void {
    if (race === null || finishVertex === null) {
      return;
    }

    const counterRows: RaceLaneCounters[] = [];
    for (let lane = 0; lane < configs.length; lane += 1) {
      const state = race.laneState(lane);
      const counters = raceCountersFromLane(state);
      counterRows.push(counters);

      const ui = laneUis[lane];
      if (ui === undefined) {
        continue;
      }

      const renderer = ui.renderer;
      if (renderer !== null) {
        renderer.draw(state, {
          source: SOURCE_VERTEX,
          finish: finishVertex,
          photoFinish: race.lanePhotoFrozen(lane),
        });
      }

      ui.comparisonsValue.textContent = String(counters.comparisons);
      ui.heapValue.textContent = String(counters.heapOps);
      ui.dstructValue.textContent = String(counters.dstructOps);
      ui.relaxValue.textContent = String(counters.relaxations);
      ui.outOfOrderValue.textContent = String(counters.outOfOrderSettles);
      const settledPct =
        counters.n === 0 ? 0 : Math.round((100 * counters.settledCount) / counters.n);
      ui.progress.value = settledPct;
      const settledText = `${String(settledPct)}% ${RACE_CHROME_COPY.settledLabel}`;
      ui.settledLabel.textContent = settledText;
      ui.progress.setAttribute("aria-label", settledText);
    }

    syncScrubberUi();
    syncBanner();
    syncStanding(counterRows);
    syncExportButtons();
    syncPlayPauseUi();

    if (recording) {
      if (paintExportSheet()) {
        if (!recordingAwaitingReplay && !finishingVideo && race !== null && race.allPhotoFrozen()) {
          if (recordingHoldUntilMs === null) {
            recordingHoldUntilMs = performance.now() + EXPORT_BANNER_HOLD_MS;
          }
          if (performance.now() >= recordingHoldUntilMs) {
            void finishVideoRecording();
          }
        }
      }
    }
  }

  /**
   * Apply DPR-aware backing-store dimensions to every live lane canvas.
   *
   * @returns True if any canvas backing store changed.
   */
  function applyAllLaneBackingStores(): boolean {
    let changed = false;
    for (const ui of laneUis) {
      if (applyRaceCanvasBackingStore(ui.canvas)) {
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Rebuild lane {@link Renderer}s after a backing-store resize when a graph is mounted.
   */
  function rebuildLaneRenderers(): void {
    if (activeGraph === null) {
      return;
    }
    const graph = activeGraph;
    for (const ui of laneUis) {
      ui.renderer = new Renderer({
        target: wrapDomCanvas(ui.canvas),
        createSurface: createDomSurface,
        graph,
      });
      ui.renderer.setChrome(THEMES[readStoredTheme()]);
    }
  }

  /**
   * Sync lane backing stores and rebuild renderers when not recording.
   *
   * Must check {@link recording} before touching `canvas.width` — assigning
   * width clears the bitmap and would corrupt in-flight WebM frames (#77).
   */
  function syncLaneBackingStoresAndRenderers(): void {
    if (recording) {
      pendingBackingRebuild = true;
      return;
    }
    const changed = applyAllLaneBackingStores();
    if (!changed) {
      return;
    }
    if (activeGraph !== null) {
      rebuildLaneRenderers();
      drawFrame();
    }
  }

  /**
   * Coalesce lane container resize notifications into one backing-store sync per frame.
   */
  function onLanesResized(): void {
    if (resizeRafId !== 0) {
      return;
    }
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      syncLaneBackingStoresAndRenderers();
    });
  }

  /**
   * Terminate any in-flight workers and post a fresh multi-lane trace run.
   */
  function startRun(): void {
    if (recording) {
      const recorder = activeCanvasRecorder;
      activeCanvasRecorder = null;
      finishingVideo = false;
      restoreRecordingUi();
      if (recorder !== null) {
        try {
          void recorder.stop().catch(() => undefined);
        } catch {
          // already stopped
        }
      }
    }
    pool.terminate();
    race = null;
    activeGraph = null;
    finishVertex = null;
    scrubber.value = "0";
    scrubber.max = "0";
    workLabel.textContent = "0 / 0";
    bannerEl.hidden = true;
    syncExportButtons();
    syncPlayPauseUi();

    for (const ui of laneUis) {
      ui.comparisonsValue.textContent = "0";
      ui.heapValue.textContent = "0";
      ui.dstructValue.textContent = "0";
      ui.relaxValue.textContent = "0";
      ui.outOfOrderValue.textContent = "0";
      ui.progress.value = 0;
      ui.renderer = null;
      if (ui.winnerEl.hidden !== true) {
        ui.winnerEl.hidden = true;
      }
      if (ui.leadEl.hidden !== true) {
        ui.leadEl.hidden = true;
      }
      applyBestMark(ui.heapBlock, false);
      applyBestMark(ui.dstructBlock, false);
      applyBestMark(ui.relaxBlock, false);
      applyBestMark(ui.outOfOrderBlock, false);
    }

    clearStatus();
    showGenProgress(0);

    const speed = Number(speedSelect.value);
    if (!Number.isFinite(speed)) {
      showStatus(`invalid speed select value: ${speedSelect.value}`);
      return;
    }

    const params = resolveBmsspRunParams(raceState.n, raceState.bmssp, raceState.bk, raceState.bt);

    const spec: RaceSpec = {
      kind: raceState.g,
      n: raceState.n,
      seed: raceState.seed,
      source: SOURCE_VERTEX,
      mode: raceState.bmssp,
      lanes: configs.map((config) => config.algo),
    };
    if (raceState.bk !== null) {
      spec.k = raceState.bk;
    }
    if (raceState.bt !== null) {
      spec.t = raceState.bt;
    }

    pool.start(spec, {
      onProgress: (ratio) => {
        showGenProgress(ratio);
      },
      onGraph: (graph) => {
        hideGenProgress();
        activeGraph = graph;
        race = new RaceScheduler(graph, configs.length, SOURCE_VERTEX, params.k);
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

        applyAllLaneBackingStores();
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
          ui.renderer.setChrome(THEMES[readStoredTheme()]);
        }

        applyPendingSeek();
        drawFrame();
      },
      onChunk: (lane, chunk) => {
        if (race === null) {
          showStatus("chunk received before graph");
          return;
        }
        race.appendChunk(lane, chunk);
        applyPendingSeek();
        syncScrubberUi();
        schedulePaint();
      },
      onLaneDone: (lane) => {
        if (race === null) {
          showStatus("done received before graph");
          return;
        }
        race.markLaneComplete(lane);
        applyPendingSeek();
        syncScrubberUi();
        schedulePaint();
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
    writeClockToUrl();
    drawFrame();
  });

  stepBackBtn.addEventListener("click", () => {
    if (race === null) {
      return;
    }
    race.pause();
    race.seek(Math.max(0, race.appliedCursor - 1));
    writeClockToUrl();
    drawFrame();
  });

  playPauseBtn.addEventListener("click", () => {
    if (race === null) {
      return;
    }
    if (race.clock.playing) {
      race.pause();
      writeClockToUrl();
    } else {
      race.play();
    }
    syncPlayPauseUi();
  });

  skipEndBtn.addEventListener("click", () => {
    if (race === null) {
      return;
    }
    race.pause();
    const end = race.allComplete ? race.maxTotalWork : race.streamCap;
    race.seek(end);
    writeClockToUrl();
    drawFrame();
  });

  stepEventBtn.addEventListener("click", () => {
    race?.pause();
    race?.stepEvent();
    writeClockToUrl();
    drawFrame();
  });

  stepOpBtn.addEventListener("click", () => {
    race?.pause();
    race?.stepOp();
    writeClockToUrl();
    drawFrame();
  });

  exportPngBtn.addEventListener("click", () => {
    if (!exportButtonsEnabled()) {
      return;
    }

    drawFrame();

    const sheet = ensureSheetCanvas();
    if (sheet === null) {
      showStatus("export sheet canvas unavailable");
      return;
    }

    const painted = paintExportSheet();
    void (async () => {
      try {
        await exportPhotoFinishWhenPainted(painted, {
          filename: exportFilename(raceState, "png"),
          capturePng: () => captureCanvasPng(sheet),
          download: triggerDownload,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        showStatus(message);
      }
    })();
  });

  exportWebmBtn.addEventListener("click", () => {
    if (!exportButtonsEnabled()) {
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      showStatus("Video export is not supported in this browser; PNG export still works.");
      return;
    }

    const mimeType = pickRecorderMimeType((mime) => MediaRecorder.isTypeSupported(mime));
    if (mimeType === null) {
      showStatus("Video export is not supported in this browser; PNG export still works.");
      return;
    }

    const sheet = ensureSheetCanvas();
    if (sheet === null) {
      showStatus("export sheet canvas unavailable");
      return;
    }

    if (typeof sheet.captureStream !== "function") {
      showStatus("Video export is not supported in this browser; PNG export still works.");
      return;
    }

    recording = true;
    recordingAwaitingReplay = true;
    recordingMimeType = mimeType;
    syncExportButtons();
    syncRecordingControls();

    drawFrame();
    if (!paintExportSheet()) {
      restoreRecordingUi();
      return;
    }

    const stream = sheet.captureStream(30);
    const recorder = createCanvasRecorder({
      mimeType,
      createRecorder: (mt) => createStreamRecorder(stream, mt),
    });
    activeCanvasRecorder = recorder;

    try {
      recorder.start();
    } catch (error: unknown) {
      restoreRecordingUi();
      const message = error instanceof Error ? error.message : String(error);
      showStatus(message);
      return;
    }

    if (race !== null) {
      race.pause();
      race.seek(0);
      race.play();
      recordingAwaitingReplay = false;
    }

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
    writeClockToUrl();
    drawFrame();
  });

  diceButton.addEventListener("click", () => {
    applyRaceState({ ...raceState, seed: rollSeed(), t: 0 });
  });

  kindSelect.addEventListener("change", () => {
    const raw = kindSelect.value;
    if (!isGraphKind(raw)) {
      showStatus(`invalid graph kind: ${raw}`);
      syncGalleryControls();
      return;
    }
    let nextN = raceState.n;
    if (raw === "city" && (raceState.n === SIZE_PRESETS.XL || raceState.n > CITY_MAX_N)) {
      nextN = CITY_MAX_N;
    }
    applyRaceState({ ...raceState, g: raw, n: nextN });
  });

  sizeSelect.addEventListener("change", () => {
    const raw = sizeSelect.value;
    if (!isRaceSizeKey(raw)) {
      showStatus(`invalid size preset: ${raw}`);
      syncGalleryControls();
      return;
    }
    applyRaceState({ ...raceState, n: SIZE_PRESETS[raw] });
  });

  seedInput.addEventListener("change", () => {
    const parsed = Number(seedInput.value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      showStatus(`invalid seed: ${seedInput.value}`);
      syncGalleryControls();
      return;
    }
    applyRaceState({ ...raceState, seed: parsed });
  });

  lanesSelect.addEventListener("change", () => {
    const raw = lanesSelect.value;
    if (!isRaceLanesKey(raw)) {
      showStatus(`invalid lanes preset: ${raw}`);
      syncGalleryControls();
      return;
    }
    applyRaceState({ ...raceState, race: raceFromLanesKey(raw) });
  });

  bmsspSelect.addEventListener("change", () => {
    const raw = bmsspSelect.value;
    if (!isBmsspUrlMode(raw)) {
      showStatus(`invalid bmssp mode: ${raw}`);
      syncGalleryControls();
      return;
    }
    applyRaceState({ ...raceState, bmssp: raw });
  });

  let lastFrameMs = performance.now();

  /**
   * Stop rAF loop, terminate workers, and remove global pointer listeners.
   */
  function teardown(): void {
    stopped = true;
    cancelAnimationFrame(rafId);
    if (laneResizeObserver !== null) {
      laneResizeObserver.disconnect();
      laneResizeObserver = null;
    }
    if (resizeRafId !== 0) {
      cancelAnimationFrame(resizeRafId);
      resizeRafId = 0;
    }
    activeGraph = null;
    pool.terminate();
    race = null;
    if (root !== null) {
      delete root.dataset.mode;
    }
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
      if (nowMs - lastUrlWriteMs >= URL_WRITE_THROTTLE_MS) {
        writeClockToUrl();
        lastUrlWriteMs = nowMs;
      }
    } else if (recording) {
      // Photo-finish pauses the clock; keep painting so the banner hold can
      // elapse and MediaRecorder encodes the frozen export sheet.
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

  const heading = document.createElement("div");
  heading.className = "race-lane-heading";

  const labelEl = document.createElement("span");
  labelEl.className = "race-lane-label";
  labelEl.textContent = config.label;
  if (config.persona === "stub") {
    labelEl.title = RACE_CHROME_COPY.stubPersonaTitle;
  } else {
    labelEl.title = personaTitle(config.persona);
  }

  const winnerEl = document.createElement("span");
  winnerEl.className = "race-lane-winner";
  winnerEl.textContent = WINNER_CHIP_TEXT;
  winnerEl.hidden = true;

  const leadEl = document.createElement("span");
  leadEl.className = "race-lane-lead";
  leadEl.hidden = true;

  heading.append(labelEl, winnerEl, leadEl);

  const canvas = document.createElement("canvas");
  canvas.className = "race-canvas";
  canvas.width = RACE_LANE_CSS_PX;
  canvas.height = RACE_LANE_CSS_PX;

  const counters = document.createElement("div");
  counters.className = "race-counters";

  const comparisonsBlock = createCounterBlock(
    "Comparisons",
    "race-counter-headline",
    RACE_CHROME_COPY.counterTitles.comparisons,
  );
  const heapBlock = createCounterBlock(
    "Heap ops",
    "race-counter-secondary",
    RACE_CHROME_COPY.counterTitles.heapOps,
  );
  const dstructBlock = createCounterBlock(
    "D ops",
    "race-counter-secondary",
    RACE_CHROME_COPY.counterTitles.dOps,
  );
  const relaxBlock = createCounterBlock(
    "Relaxations",
    "race-counter-secondary",
    RACE_CHROME_COPY.counterTitles.relaxations,
  );
  const outOfOrderBlock = createCounterBlock(
    "Out of order",
    "race-counter-secondary",
    RACE_CHROME_COPY.counterTitles.outOfOrder,
  );

  const secondaryRow = document.createElement("div");
  secondaryRow.className = "lens-counter-row";
  secondaryRow.append(heapBlock.block, dstructBlock.block, relaxBlock.block, outOfOrderBlock.block);

  counters.append(comparisonsBlock.block, secondaryRow);

  const settledWrap = document.createElement("div");
  settledWrap.className = "race-settled-wrap";

  const settledLabel = document.createElement("span");
  settledLabel.className = "race-settled-label";
  const initialSettledText = `0% ${RACE_CHROME_COPY.settledLabel}`;
  settledLabel.textContent = initialSettledText;

  const progress = document.createElement("progress");
  progress.className = "race-progress";
  progress.max = 100;
  progress.value = 0;
  progress.setAttribute("aria-label", initialSettledText);

  settledWrap.append(settledLabel, progress);

  laneEl.append(heading, canvas, counters, settledWrap);
  parent.append(laneEl);

  return {
    laneEl,
    winnerEl,
    leadEl,
    comparisonsValue: comparisonsBlock.value,
    heapBlock: heapBlock.block,
    heapValue: heapBlock.value,
    dstructBlock: dstructBlock.block,
    dstructValue: dstructBlock.value,
    relaxBlock: relaxBlock.block,
    relaxValue: relaxBlock.value,
    outOfOrderBlock: outOfOrderBlock.block,
    outOfOrderValue: outOfOrderBlock.value,
    progress,
    settledLabel,
    canvas,
    renderer: null,
  };
}

/**
 * Mount shared race legend row with swatches and explainer tooltips.
 *
 * @returns Legend container for `.race-root`.
 */
function mountRaceLegend(): HTMLDivElement {
  const legend = document.createElement("div");
  legend.className = "race-legend";

  const items: ReadonlyArray<{ swatch: string; label: string; term: string }> = [
    { swatch: "frontier", label: RACE_CHROME_COPY.legendFrontier, term: "Frontier" },
    {
      swatch: "settled",
      label: RACE_CHROME_COPY.legendSettled,
      term: "settle-order gradient",
    },
    {
      swatch: "unreached",
      label: RACE_CHROME_COPY.legendUnreached,
      term: "Unreached",
    },
    {
      swatch: "gold",
      label: RACE_CHROME_COPY.legendShortestPath,
      term: "photo-finish gold path",
    },
  ];

  for (const item of items) {
    const itemEl = document.createElement("span");
    itemEl.className = "race-legend-item";
    itemEl.title = explainerMeaning(item.term);

    const swatchEl = document.createElement("span");
    swatchEl.className = "race-legend-swatch";
    swatchEl.dataset.swatch = item.swatch;
    swatchEl.setAttribute("aria-hidden", "true");

    itemEl.append(swatchEl, document.createTextNode(item.label));
    legend.append(itemEl);
  }

  return legend;
}

/**
 * @param labelText - Counter label shown beside the value.
 * @param className - Additional class on the counter block.
 * @param titleText - Tooltip and visually-hidden description for the counter.
 */
function createCounterBlock(
  labelText: string,
  className: string,
  titleText: string,
): { block: HTMLDivElement; value: HTMLSpanElement } {
  const block = document.createElement("div");
  block.className = `lens-counter ${className}`;
  block.title = titleText;

  const label = document.createElement("span");
  label.className = "lens-counter-label";
  label.textContent = labelText;

  const value = document.createElement("span");
  value.className = "race-counter-value";
  value.textContent = "0";

  const bestNote = document.createElement("span");
  bestNote.className = "visually-hidden race-best-note";
  bestNote.textContent = BEST_IN_CLASS_NOTE;
  bestNote.hidden = true;

  const desc = document.createElement("span");
  desc.className = "visually-hidden race-counter-desc";
  desc.id = `race-counter-desc-${String(raceCounterDescSeq)}`;
  raceCounterDescSeq += 1;
  desc.textContent = titleText;
  block.setAttribute("aria-describedby", desc.id);

  block.append(label, value, bestNote, desc);
  return { block, value };
}

/**
 * Build lane configs from parsed race URL state (uses `race` list only).
 *
 * @param state - Current race URL state.
 */
function lanesFromRaceState(state: RaceUrlState): RaceLaneConfig[] {
  const params = new URLSearchParams();
  params.set("race", state.race.join(","));
  return lanesFromSearch(params);
}

/**
 * @param race - Canonical race lane slug list from URL state.
 * @returns Gallery select value: `"three"` when length is 3, otherwise `"two"`.
 */
function lanesKeyForRace(race: readonly RaceAlgoSlug[]): RaceLanesKey {
  return race.length === 3 ? "three" : "two";
}

/**
 * @param key - Gallery lanes select value.
 * @returns Canonical race slug list for two or three lanes.
 */
function raceFromLanesKey(key: RaceLanesKey): readonly RaceAlgoSlug[] {
  if (key === "three") {
    return THREE_LANE_RACE;
  }
  return TWO_LANE_RACE;
}

/**
 * @param a - First race lane list.
 * @param b - Second race lane list.
 * @returns Whether both lists have the same length and tokens in order.
 */
function raceCompositionEqual(a: readonly RaceAlgoSlug[], b: readonly RaceAlgoSlug[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * @param prev - Previous race URL state.
 * @param next - Candidate next state.
 * @returns Whether graph kind, size, seed, lanes, or BMSSP params changed.
 */
function graphGalleryChanged(prev: RaceUrlState, next: RaceUrlState): boolean {
  return (
    prev.g !== next.g ||
    prev.n !== next.n ||
    prev.seed !== next.seed ||
    !raceCompositionEqual(prev.race, next.race) ||
    prev.bmssp !== next.bmssp ||
    prev.bk !== next.bk ||
    prev.bt !== next.bt
  );
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
function isRaceSizeKey(value: string): value is RaceSizeKey {
  for (const key of RACE_SIZE_KEYS) {
    if (key === value) {
      return true;
    }
  }
  return false;
}

/**
 * @param value - Candidate lanes preset key from a select option.
 */
function isRaceLanesKey(value: string): value is RaceLanesKey {
  for (const key of RACE_LANES_KEYS) {
    if (key === value) {
      return true;
    }
  }
  return false;
}
