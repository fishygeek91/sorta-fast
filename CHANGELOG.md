# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Sorta Fast is pre-v1.0 (`package.json` is `0.0.0`); entries land under **Unreleased** until a version is tagged.

## [Unreleased]

### Fixed

- `.race-lane[hidden]` now sets `display: none`, so Story single-lane beats actually hide the unused algorithm (author `display: flex` was defeating the `hidden` attribute) (#60).
- Story wheel navigation uses a 600ms cooldown and never exits to Race free play from scroll, so one flick cannot skip the whole tour (#60).
- WebM export holds ~1.5s after both lanes photo-freeze so the winner banner is captured, and the rAF loop keeps painting while the clock is paused (MediaRecorder was stopping on the freeze frame, then the hold never elapsed) (#21).

### Added

- Launch README with hero GIF, live Pages link, seed challenge, paper links, and a pointer at the differential-test suite (#21).
- Wall-clock benchmark page (`/sorta-fast/bench/`) plus headless harness (`npm run bench:wall-clock`) with committed S–XL sparse timings and the work-clock vs milliseconds caveat (#21).
- v1.0 launch checklist in `docs/launch-checklist.md` (#21).
- Adversarial gallery kind (`g=adversarial`): Θ(√n) chain + wide fans, seeded, property-tested (#20).
- City graphs reject n > L (25000); Race/Lens disable XL for city with #32 tooltip and clamp on kind switch (#20, #32).
- Aggregated render at ≥25k nodes: 2px ImageData settle squares, undirected-once edge prerender, simplified overlays (#20).
- Worker generate-progress messages + Race/Lens generating bar; chunk paints coalesced to rAF (#20).
- XL labeled "XL (stress)" in pickers (#20).
- Headless tests: generators, picker scans, protocol progress, aggregated renderer, `test/render-perf-xl.test.ts` (33.3ms XL draw), `test/race-xl-stall.test.ts` (50ms append+draw stall) (#20).
- Story mode: click/scroll-driven four-step tour (Dijkstra wavefront → sorting-cost callout → BMSSP pivots/batches → side-by-side race) on the seeded city/500/1729 gallery graph with live `RaceScheduler` playback; skippable to Race free play, with the `forest` step reserved for #27 (#19).
- Shared `src/ui/bmsspUrl.ts` helpers for Race/Lens `bmssp`/`bk`/`bt` parse so the two codecs stay in sync (#52).
- Race and Lens gallery control Demo (browser-scale) vs Paper (asymptotic) writes `bmssp=` and restarts the BMSSP worker; `Playback` takes optional `findPivotsK` so Lens narration matches paper/override k (#52).
- `resolveBmsspRunParams` harness helper so Race/Lens can resolve k/t without importing `src/core/bmssp/` (#52).
- Headless proof that the default race (sparse / 25k / seed 4, demo k/t) has BMSSP billed work below Dijkstra (`test/bmssp-demo-win.test.ts`) (#52).
- Race and Lens URL codecs encode BMSSP mode (`bmssp=demo|paper`) and optional block overrides (`bk`, `bt`); work-clock scrub stays on `t` (#52).
- Default race/lens gallery URL preset is sparse / 25k / seed 4 (sweep-winning config) (#52).
- Optional BMSSP `k`/`t` on `BmsspTraceSpec`, `TraceJobSpec`, `TraceRunRequest`, and `RaceSpec`; workers and `RaceWorkerPool` forward overrides into `bmsspParams(n, { k, t })` (#52).
- `TraceBuffer` / `RaceScheduler` accept optional `findPivotsK` so Lens narration uses the race's k instead of always recomputing `bmsspParams(n).k` (#52).
- Headless BMSSP k/t sweep bench (`bench/bmssp-kt-sweep.ts`, `npm run bench:bmssp-kt`) comparing billed work vs Dijkstra across graph kinds, sizes, seeds, k values, and t variants; smoke via `--quick` (#52).
- Committed BMSSP k/t sweep results table and write-up in `bench/bmssp-kt-sweep.md` with raw TSV artifacts; sparse L k=4 + paper t wins every seed 0–9 (#52).
- Headless tests for k/t sweep config, `resolveT`, skip rules, and one `sweepCell` row (`test/bmssp-kt-sweep.test.ts`) (#52).
- BMSSP `run` and `drainBmsspRun` accept optional `BmsspParams` overrides; omitted params keep `bmsspParams(n)` defaults (#52).
- BMSSP `paperBmsspParams` preserves arXiv 2504.17033 §3.1 k/t; `bmsspParams` accepts optional overrides; `bmsspRecursionDepth` exposes Algorithm 3’s L (#52).
- Race PNG photo-finish export: transport PNG button composites lane canvases with counters, banner, seed, and share URL baked into the image; gated on photo-finish freeze (#18).
- Race WebM/mp4 export via MediaRecorder on a composite canvas, replaying the finished trace at the current speed (no algorithm re-run); Safari/unsupported browsers get mp4 or a status fallback that keeps PNG working. GIF encoder deferred (#18).
- Headless export tests: `test/export-meta.test.ts`, `test/export-sheet.test.ts`, `test/export-download.test.ts`, `test/export-recorder.test.ts`, `test/export-mount.test.ts` (#18).
- Chrome token module `src/render/theme.ts` (dark default + light cream palettes, marble/ember/moss accents) with WCAG contrast and deuteranopia helpers; headless tests in `test/theme.test.ts` and `test/theme-contrast.test.ts` (#17).
- Theme toggle in Race and Lens mode nav (`mountThemeToggle`); renderers apply stored light/dark chrome on boot; Lens canvas `data-persona` syncs marble/ember with Dijkstra/BMSSP (#17).
- Open Graph and Twitter Card meta in `index.html` plus `public/og-card.png` (1200×630 dark photo-finish poster: three persona lanes with settle-order gradient and gold path; authored illustration resized with `sips`, not a live `?seed=` capture); headless contract tests in `test/og-meta.test.ts`, issue #17 visual-token CSS scans in `test/race-css.test.ts`, and post-build `og-card.png` / `og:image` checks in `test/build-workers.ts` (#17).
- Production favicon (`public/favicon.svg`) and `<link rel="icon">` in `index.html` so GitHub Pages stops 404ing the default favicon request (#48).
- Isolated `test:build` CI job runs `vite build` then asserts Dijkstra and BMSSP trace worker chunks (and copied `favicon.svg`) under `dist/` so production Play regressions are caught before deploy (#48).
- Footer disclosures in Race and Lens: Fairness rules (work-clock op-cost model + link to the `src/core/trace.ts` cost table), What am I looking at? (sorting-barrier story, Perfectionist / Batcher / Forester personas, visual vocabulary), and The papers (STOC 2025, arXiv 2504.17033, arXiv 2602.07868, Quanta). Opening a panel does not pause playback (#16).
- Headless #16 tests: `test/site-copy.test.ts` syncs UI `FAIRNESS_COSTS` with `OP_COST`; `test/disclosures-mount.test.ts` source-scans Race/Lens wiring and forbids UI `trace.ts` imports; site-disclosure CSS coverage in `test/race-css.test.ts`.
- Race header gallery: graph kind, S/M/L/XL, seed, dice, and 2-way vs 3-way lane pickers; `replaceState` on change; load seeks optional `t` and stays paused (#15).
- Lens size picker includes XL; Dice button rolls a CSPRNG seed and reruns (#15).
- Race URL codec encodes `race=` (comma-separated lanes) and optional `t=` (work-clock position); legacy `lane3=dijkstra` still parses as a third Dijkstra lane (#15).
- Headless URL tests: `test/race-url.test.ts` codec round-trips, `test/race-url-repro.test.ts` identical traces/counters plus seek-to-`t`, `test/roll-seed.test.ts` for the dice helper (#15).
- Pure `rollSeed` helper in `src/ui/rollSeed.ts` for the gallery dice button: CSPRNG via `crypto.getRandomValues` (or injectable `fill`), returns a `Uint32` seed without touching core/harness determinism (#15).

### Changed

- Export captions always use the canonical GitHub Pages origin (`https://fishygeek91.github.io/sorta-fast/`), so localhost preview URLs never bake into PNG/WebM (#21).
- Re-recorded the README hero GIF through both-lane photo-finish (plus a 1.5s last-frame hold) and captioned it as Dijkstra's race-to-target on seed 4, not a BMSSP settle-all win (#21).
- README hero caption distinguishes photo-finish (Dijkstra on seed 4) from settle-all work-clock (BMSSP) (#21).
- `npm run bench:wall-clock -- --quick` no longer overwrites committed `bench/wall-clock-results.json` (#21).
- `docs/design.md` §3.4 city XL cap and aggregated-render xref §4.4 (#20).
- Pre-#52 share URLs without `bmssp=` now replay under demo k/t (`k = max(4, paper k)`); append `&bmssp=paper` to reproduce the old paper-asymptotic run (#52).
- BMSSP workers and `RaceSpec` accept optional `mode` (`demo`|`paper`); omitted k/t now resolve through demo `bmsspParams`, not the paper formula (#52).
- Fairness panel `params` paragraph discloses BMSSP paper k/t vs demo defaults (`k = max(4, paper k)`, paper t), FindPivots abort at k=2, sweep evidence at `bench/bmssp-kt-sweep.md`, and `bmssp=paper` URL override (#52).
- `docs/design.md` §2.2 and §8: demo uses swept BMSSP k/t because asymptotic k is degenerate at browser scale; paper formula remains selectable; risk mitigation cites FindPivots abort and Fairness disclosure (#52).
- `bmsspParams` defaults to demo mode (`demoBmsspParams`: `k = max(4, paper.k)`, paper `t`); paper §3.1 via `paperBmsspParams` or `mode: "paper"` (#52).
- Canvas renderer chrome follows theme tokens via `setChrome` (dark default paper/edges/frontier/ghost); photo-finish gold stays the shared bright stroke (#17).
- Dark-first design tokens in `src/style.css`: CSS custom properties for paper/ink/panel/hairline/persona accents, `[data-theme="light"]` overrides, ember/moss `#app` glows (cream radials in light), grouped tabular numerals, theme-toggle and explainer swatch hooks, and `index.html` `data-theme="dark"` plus `theme-color` / `color-scheme` for first paint (#17).
- Fairness intro describes lanes advancing to the shared clock tick; explainer names four of the five 2025 authors for the Feb 2026 record (#16).
- Canonical race share links write `race=` and omit `lane3=`; old `?lane3=dijkstra` links still parse as a third Dijkstra lane (#15).
- `resolveRaceFinishVertex` and `isBfsReachable` so Race can warn on `?target=` equal to the source, out of range, or unreachable instead of silently substituting (#14).
- `mountRace` UI (#14): multi-lane canvases, shared transport/scrubber, per-lane counters and progress, photo-finish banner, and `RaceWorkerPool` wiring; default app entry is Race mode with Lens via `?mode=lens`.
- Headless race UI acceptance tests in `test/race-ui-ac.test.ts`: lanesFromSearch, live counters, 3-lane stub, photo-finish banner/rewind, and Dijkstra OOO=0 (#14).
- RaceScheduler photo-finish cap (#14): `setFinishVertex` freezes each lane at `settleWork[finish]` once that settle is known; `lanePhotoFrozen` / `allPhotoFrozen` for UI; auto-pause when every lane is photo-frozen.
- Renderer gold path + source/finish marks (#14): `PHOTO_FINISH_GOLD` pred-walk stroke on the fx layer when `photoFinish` is true; source/finish vertex rings on the overlay via `OverlayFlags.source`, `finish`, and `photoFinish`.
- Pure photo-finish helpers in `src/ui/photoFinish.ts`: lane freeze check, gold-path walk, race banner formatting with per-lane op totals, and lane counter snapshot (#14).
- TraceBuffer reconstructs `pred`/`dist`/`settleWork` and out-of-order settles for photo-finish playback (#14).
- Race mode CSS layout (#14): `.race-root` column stack, 2/3-lane `.race-lanes` grid with mobile single-column stack at 720px, per-lane canvas/counters/progress panels, shared `.race-transport`, photo-finish `.race-banner`, and tabular counter numerals.
- `pickFinishVertex` for race photo-finish: BFS-reachable farthest layout vertex from source, tie-break by lowest id (#14).
- Race URL codec and lane config helpers: `parseRaceUrl` / `serializeRaceUrl` for `?g=&n=&seed=&mode=&target=&lane3=` (Lens-style fallbacks) and `lanesFromSearch` for 2- or 3-lane layouts when `lane3=dijkstra` (#14).
- Multi-lane race harness (#13): `RaceScheduler` shares one `WorkClock` across 2–3 `TraceBuffer`s with stream-while-generating (`streamCap` / `appliedCursor`), unequal-finish freeze wiring (`laneFinished`), and bidirectional seek/step. `RaceWorkerPool` spawns one existing Vite worker per lane from the same graphSpec+seed and routes chunks by lane index. `runTraceJob` dispatches Dijkstra/BMSSP jobs for headless tests. Worker parsers (`parseWorkerToMain`, `graphFromTraceMessage`, `isTraceChunk`) live in `protocol.ts` so Lens and the pool share them.
- 3-lane × 25k stall budget test (`test/race-scheduler-perf.test.ts`): maze `SIZE_PRESETS.L` Dijkstra trace reused on three lanes; 124998 events; worst `appendChunk` 7.07ms, speed-8 `advance(1/60)` 0.34ms, seek-back 0.04ms vs 50ms (#13).
- `test/replay-perf.test.ts` BMSSP M-size draw budget: maze `SIZE_PRESETS.M` via `runBmsspTraceJob`, fully settled `TraceBuffer`, stub-canvas `Renderer` with all overlay toggles on, best-of-3 vs `DRAW_BUDGET_MS` (50ms) plus optional speed-8 frame timing (#12).
- `test/scrub-identity.test.ts` BMSSP scrub coverage: extended `compareLane` for all LaneState BMSSP overlay fields and maze-trace forward-vs-scrub-back parity at T=0, mid, event boundary, and totalWork (#12).
- Lens BMSSP wiring (#12): algorithm select bound to URL `algo`, BMSSP/Dijkstra worker swap, narration strip via `formatBmsspNarration`, BMSSP overlay toggles and counters, and subtitle `Lens · BMSSP` / `Lens · Dijkstra`.
- BMSSP trace worker path mirroring Dijkstra: `bmsspTraceJob.ts`, `bmsspTrace.ts`, optional `algo` on `TraceRunRequest`, and `test/bmssp-trace-job.test.ts` (#12).
- Lens URL `algo` query param (`dijkstra` | `bmssp`, default `bmssp`) with round-trip parse/serialize in `src/ui/urlState.ts` (#12).
- Pure `formatBmsspNarration` helper in `src/ui/narration.ts` for scrub-safe BMSSP status lines from `LaneState` (#12).
- `test/trace-buffer.test.ts` BMSSP overlay coverage: extended `compareLane` for all LaneState BMSSP fields and six scrub/seek tests for recurse, pivot, batch bloom, dstruct blocks, keyframe reset, and forward-vs-backward parity (#12).
- Renderer BMSSP overlays: fourth `fxLayer`, recursion-depth ember tint, pivot flare rings, FindPivots batch blooms, and schematic D-structure strip; overlay toggles `recursionTint`, `pivotFlares`, `batchBlooms`, and `dstructStrip` default on (#12).
- `TraceBuffer.applyOneTo` updates BMSSP overlay lane state: recurse depth/bound, FindPivots batches and bloom bbox, pivot flares, and schematic D-block list (#12).
- `LaneState` BMSSP visual/narration fields (recursion depth, bound, batch/bloom, pivot flares, schematic D blocks) for scrub-safe overlay playback (#12).
- Instrumented BMSSP lane `run(graph, source)` in `src/core/bmssp/bmssp.ts`: Algorithm 3 recursion with FindPivots + BlockListD (M = 2^{(l-1)t}), singleton base-case mini-Dijkstra at l=0, |U| workload cap with partial B′, W-append settle, and full recurse/dstruct/settle/heap/relax traces (#11).
- BMSSP unit/golden tests: small graphs, ties vs Dijkstra, recurse/dstruct shape, TraceWriter round-trip, bounded-settle invariant (#11).
- BMSSP cross-check fixtures (`test/fixtures/bmssp/`) with Braeniac README oracle plus Dijkstra-verified small graphs; `test/bmssp-crosscheck.test.ts` and offline `bench/generate-bmssp-braeniac-fixtures.ts` (#11).
- BMSSP differential fuzz: 5000 seeded graphs (ties included) vs Dijkstra and Bellman-Ford, trace distance audit, and bounded-settle invariant (#11).
- BMSSP test helpers `drainBmsspRun`, `auditBmsspDistancesFromTrace`, and `assertBoundedSettleInvariant` for trace replay and bounded-settle audits without reusing Dijkstra helpers (#11).
- FindPivots(B, S): k Bellman-Ford rounds, tight-forest pivots, and pivot/batch/relax traces so the BMSSP lane can flare pivots before the full recursion lands (#10).
- Block-list data structure D (Lemma 3.3) with Insert, BatchPrepend, Pull, and billed comparison counts for `{k:'dstruct'}` events (#9).
- Lens mode UI (canvas, live comparison/heap/relax counters, timeline, overlay toggles, worker streaming, shareable `?g=&n=&seed=`) (#8).
- `TraceBuffer.appendChunk` and `Playback.beginStreaming` / `appendChunk` / `markComplete` so playback can start before the worker finishes (#8).
- Vitest coverage for `runDijkstraTraceJob` streaming, determinism, validation, and end-of-trace work totals; `src/ui` import guard in render-imports when UI modules exist (#8).
- Lens URL codec `?g=&n=&seed=` with maze/5000/1729 defaults (#8).
- Worker job streams Dijkstra chunks via drainCompleted (#8).
- Vitest fake-canvas coverage for renderer overlay toggles (`frontier`, `relaxedEdges`) and ghost window cutoff on the overlay layer (#8).
- Renderer overlay flags (`frontier`, `relaxedEdges`) and billed-op ghost trails on recently relaxed CSR edges via `GHOST_WINDOW_OPS` (#8).
- Vitest coverage for `TraceWriter.drainCompleted()` partial-slab, full-slab rotation, and idempotent second drain (#8).
- `TraceBuffer.applyOne` keeps `relaxations`, `heapOps`, and per-edge `lastRelaxWork` in sync with the playback cursor so scrub-safe keyframes snapshot Lens counters and ghost trails (#8).
- `LaneState` tracks per-edge `lastRelaxWork` ghost data plus `relaxations` and `heapOps` counters for Lens mode overlay playback (#8).
- `TraceWriter.drainCompleted()` returns rotated full slabs without flushing the in-progress partial slab, so Lens mode can stream completed chunks while appends continue (#8).
- Vitest coverage for render palette LUT, dirty-rect union/cap, renderer layering, and forbidden render imports (#6).
- `Playback` in `src/harness/playback.ts`: headless facade wiring `WorkClock` to `TraceBuffer` for seek, frame advance, per-event, and per-op stepping with end-of-trace clamp and pause (#7).
- `TraceBuffer` in `src/harness/traceBuffer.ts`: column-native SoA chunk apply onto `LaneState`, prefix `workAfter` tables, and keyframe snapshots every 250k billed ops for scrub-safe backward seek (#7).
- Layered Canvas2D renderer (`src/render/renderer.ts`) with static edge bitmap, dirty-rect settle fills, and frontier overlay; shared `surface.ts` types and `domSurface.ts` browser factory (#6).
- `LaneState` in `src/harness/laneState.ts`: typed-array per-lane playback snapshot (`settleOrder`, `frontier`, event cursor, work) with `UNSETTLED` re-export for render (#7).
- `test/helpers/fake-canvas.ts` records Canvas2D draw calls in Node so renderer and harness tests need no real canvas (#6, #7).
- Settle-order OKLCH palette LUT (`src/render/palette.ts`): 256-stop blue→gold gradient with `rgbAt`, `cssColorForSettleOrder`, and `rgbForSettleOrder` for stable playback coloring (#6).
- `createDirtyRect` / `includeNode` / `markFull` in `src/render/dirtyRect.ts` union clipped per-node circle AABBs for Canvas2D settle-fill batching, with a 256-hit full-redraw cap (#6).
- `fitCamera` / `projectX` / `projectY` in `src/render/camera.ts` map generator layout coords into padded canvas space with degenerate-point and grid-safe fitting (#6).
- Headless `WorkClock` in `src/harness/workClock.ts`: op-unit playback cursor with injected `dt`, play/pause/speed/seek, and no DOM or wall-clock time (#7).
- Instrumented Dijkstra with binary-heap lazy deletion and full relax/settle/heap traces, plus a Bellman-Ford reference and 1k-graph differential fuzz (#5).
- GitHub Pages deploy workflow on push to `main`, gated on CI, and Vite `base` `/sorta-fast/` so assets resolve on the project-pages URL (#4).
- TraceEvent SoA schema, centralized op-cost table, and TraceWriter chunked slabs so algorithms can emit traces without per-event object allocation (#3).
- Design doc (`docs/design.md`), agent contract (`AGENTS.md`), Cursor rules, and README stub.
- Vite + TypeScript strict + Vitest + ESLint/Prettier scaffold and CI on PRs and `main` (#1).
- `/plan-issue` and `/implement-issue` skills, plus workflow, testing, and allowed-model rules.
- Typed-array CSR graphs, seeded mulberry32 PRNG, and four seeded generators (#2).
- This changelog (Keep a Changelog; entries stay under Unreleased until a version is tagged).

### Fixed

- Export-sheet WebM/PNG banner is empty until every lane is photo-frozen, so replay no longer paints a winner at clock 0 (#21).
- Aborting a WebM recording (e.g. `startRun` mid-capture) best-effort `stop()`s the canvas recorder instead of leaking a native `MediaRecorder` (#18).
- PNG export no longer downloads a blank sheet when compositing fails; `exportPhotoFinishWhenPainted` skips capture unless the sheet painted (#18).
- Race video export uses `createStreamRecorder` → `wrapMediaRecorder` so MediaRecorder errors keep their `ev.error` message (#18).
- Production `vite build` emits Dijkstra and BMSSP worker chunks: Lens and `RaceWorkerPool` construct workers with inline `new Worker(new URL("…", import.meta.url), { type: "module" })` so Play works on GitHub Pages (#48).
- Photo-finish freeze no longer forward-replays then rewinds frozen lanes on every `syncLanes` call; clamp to `settleWork[finish]` before the seek so later frames no-op (#14).
- Lens URL writes keep `mode=lens` so refresh stays on Lens after Race became the default mount (#14).
- Race mode tears down its rAF loop and `RaceWorkerPool` when switching to Lens so detached canvases are not repainted (#14).
- Lens BMSSP narration no longer stays on stale FindPivots text through D insert/pull: `batchRound` clears on `dstruct`; `lastPullN` resets on `recurse.in` (#12).
- `TraceBuffer` throws on `recurse.out` past depth 0 instead of silently clamping (#12).
- `TraceBuffer.appendChunk` replaces the trailing end keyframe instead of accumulating one per slab (#8).
- Lens applies the current speed select when the worker graph arrives, so a mid-generation speed change is not ignored (#8).
- Lens rAF paints only while playing so a paused 5k-node graph does not redraw every frame (#8).
- Dijkstra trace worker copies CSR/layout typed arrays before `postMessage` transfer so `onGraph` no longer detaches buffers Dijkstra still reads (#8).
- `Playback.stepOp` advances the work-clock cursor so multi-cost heap events can be stepped through (#7).
- CI 1M-event budget uses 200ms headroom and sequential Vitest files so GitHub-hosted runners can stay green (main was red after #3; Deploy is gated on that check) (#35).
- Pages contract tests no longer run `vite.build()` inside Vitest, so they do not contend with the 1M-event budget on CI (#4).
- 1M-event trace write/replay is measured best-of-3 after warmup, and `encode` writes each SoA column once without per-event asserts, so the #3 budget holds on CI runners.

### Changed

- `RaceScheduler` takes an explicit `source` (default 0) and passes it into each `TraceBuffer` (#14).
- Default mount is Race mode; Lens is available via `?mode=lens` or the header mode button (#14).
- `TraceWriter.freezeSlab` copies partial-flush columns to `count` length so worker transferables are not full 64k-row slabs (~2.3 MB); full slabs stay zero-copy (#13).
- Removed the temporary #6/#7 main-thread Dijkstra scaffold in `src/main.ts` (#8).
- Renderer composites only the dirty rect after the first full frame so Canvas2D blit cost matches settle/frontier diffs (#6).
- `decodeAt` rejects detached chunk buffers instead of reporting an unknown kind (#3).
- Design doc §4.2 notes TraceWriter rotates SoA slabs rather than wrapping a true ring (#3).
