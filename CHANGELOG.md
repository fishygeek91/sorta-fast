# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Released versions are tagged (`vMAJOR.MINOR.PATCH`). New work lands under **Unreleased** until the next tag.

## [Unreleased]

### Added

- Fairness panel, README featured seed, and bench/sparse-xl-confirm.md publish XL sparse seed-4 settle-all ratios (BMSSP 0.8468, DMSY 0.9150) (#103).
- CI pins FEATURED_RACE_URL (sparse XL seed 4, target=none): BMSSP and DMSY settle-all work / Dijkstra ≤ 0.95 (#103).
- Race gallery "The barrier falls" featured XL preset, territory picker labels, and dual photo-finish / settle-all banner (#103).
- Settle-all work-clock banner helper and featured gallery copy; photo-finish banner wording unchanged (#103).
- Race URL accepts `target=none` (settle-all, no photo-finish cap) and exports `FEATURED_RACE_URL` (sparse XL seed 4) (#103).
- BMSSP k/t sweep accepts `--xl` (sparse 100k, seeds 0–4, demo k/t) and can bypass the XL skip (#103).
- DMSY k/t sweep accepts `--xl` (sparse 100k, seeds 0–4, demo k/t) and can bypass the XL skip (#103).
- Headless DMSY k/t sweep (`bench/dmsy-kt-sweep.ts`, `npm run bench:dmsy-kt`) + committed scout/confirm TSV/md; locked demo `k = max(6, paper k)` with paper `t` (#54).
- `resolveDmsyRunParams` / `dmsy=demo|paper` + `dk`/`dt` URL keys / Fairness disclosure (#54).
- 3-way OG card (`public/og-card.png` 1200×630) and hero GIF/WebM from the #18 exporter on city n=500 seed 1729 (#28).
- Companion blog `docs/blog/implementing-dmsy.md` drafted from paper-notes ambiguity log (tie-break, gallery-n degeneracy, selected DMSY-P decisions) (#28).
- Wall-clock bench harness/page now include DMSY ms and work columns; live race link is the 3-way default (#28).
- Round-2 announcement checklist section in `docs/launch-checklist.md` (post targets, 3-way seeds, v2.0 tag is human-ask) (#28).
- `assertDmsySettleFinality` classifies post-settle improving relaxes (strict-length / lex-only / equal-label) and is wired into DMSY unit/fuzz plus a city-seed-0 {k:2,t:2} golden (#92).
- Renderer forest overlays: moss grow/cut edge strokes with work-clock pulse; subtree patchwork fill keyed on `forestTree` (settle-order LUT fallback); aggregated L/XL skips per-edge forest strokes but keeps patchwork. Default 3-way race is Dijkstra vs BMSSP vs DMSY (`DEFAULT_RACE_URL.race`, empty `?`). Lens accepts `algo=dmsy` with forest counters, `formatDmsyNarration`, and forest overlay toggles. Story ships `forest` beat after pivots with 3-lane workers; race beat stays Dijkstra+BMSSP; free-play loads the new 3-way default. M-size replay and 3-lane stall tests stay under 50ms (`test/replay-perf.test.ts`, `test/race-dmsy-perf.test.ts`) (#27).
- DMSY fuzz now includes 400 dense integer-weight digraphs (n 4–12, p≈0.4, weights in {1,2}) so the public-vs-instrumented lex predecessor check is load-bearing. (#26)
- Instrumented DMSY lane (`src/core/dmsy/dmsy.ts`): Algorithms 3–4 composing degree reduction (#23), FindPivots (#24), and partial-sort D (#25); 4-tuple lex tie-break; degree-reduce trace un-map at the emission boundary; race lane behind `?lane3=1` with worker trace job/stream, URL codec round-trip, lane config (moss persona), and renderer settle-diff fill — `race=dmsy` tokens remain dropped until #27 (#26).
- DMSY correctness battery: unit/golden helpers (`test/dmsy-helpers.ts`, `test/dmsy.test.ts`) and 10k-seed differential fuzz vs Dijkstra, BMSSP, and Bellman-Ford (`test/dmsy-fuzz.test.ts`) (#26).
- Partial-sorting structure D (`src/core/dmsy/partialSort.ts`): BST-of-blocks Insert / Merge / Pull with billed `compareLabels` counters and `dstruct.op = "merge"` per arXiv 2602.07868 Lemma 3.4 / Appendix A.2 (#25).
- Spanning-forest FindPivots (`src/core/dmsy/forest.ts`): local Dijkstra growth, Θ(k) subtree partition, per-subtree pivots, and `forest` grow/cut plus `pivot` trace events per arXiv 2602.07868 §3.1 / Appendix A.1 (#24).
- Degree-reduction preprocessing (`src/core/dmsy/degreeReduce.ts`): Frederickson-style vertex split to a δ-bounded digraph with identity when `m/n < 3`, plus mapping tables and a trace un-mapper so later DMSY emission can project reduced IDs onto the original gallery graph (#23).
- `TraceBuffer.applyCount` counts live-cursor applies so a second `syncLanes` past photo-finish freeze can assert zero applies, not only matching final `eventIndex` (#44).
- `docs/paper-notes.md`: DMSY (arXiv 2602.07868 v2) implementation spec — section-cited pseudocode, 4-tuple tie-break, paper parameter formulas with gallery-n degeneracy, and a living ambiguity log (#22).

### Fixed

- Featured-win 100k drain yields at least once per second so the vitest worker heartbeat survives slow CI runners (#103).
- Settle-all banner, winner chip, export, and WebM hold wait for playback to reach maxTotalWork (`settleAllFinished`), not merely worker generation-complete (#103).
- Featured-win CI timeout raised to 600s so the 100k DMSY drain has headroom on GHA (#103).
- WebM export hold also fires when a `target=none` featured race reaches settle-all, not only photo-freeze (#103).
- Pivot-flare incremental composites now dirty `ceil(camera.radius × 2.2) + stroke pad` and mark one last frame on expiry so the outer ring leaves no residue (#101).
- README hero caption names photo-finish work vs the settle-all work clock; the bench page discloses unmatched BMSSP demo k vs DMSY paper params; the Round-2 checklist no longer claims paper params as BMSSP's default (#28).
- Instrumented DMSY no longer emits `relax.improved: true` for identical-label Algorithm 1 `"="` accepts (parent step 5.6 re-scans). Hunt on gallery+dense graphs found only equal-label no-ops, not Lemma 3.7 completeness failures (#92).
- Story Playwright smoke now walks the five-beat tour including `forest` (#27).
- Public `run()` predecessor projection now picks the 4-tuple lex-min reduced copy (`compareLabels` on ⟨length, nEdges, curr, pred⟩), not min length + lowest copy id. Cycle copies of one original share length but differ in hop count. (#26)
- DMSY 10k fuzz decorrelates graph kind from `n` so every kind sees sizes 8–47; lex tie-break checker cross-checks public `run()` distances and predecessors against mapped `runInstrumented()` on the reduced graph (#26).
- Race pool sends BMSSP `k`/`t` only to the BMSSP worker and ignores DMSY `k`/`t` echoes for FindPivots narration (#26).
- Public `run()` predecessors now map back the lex-winning reduced pred, not a scalar relax replay (#26).
- Pull now selects from the packed block prefix (amortized O(|S′|) cmps) instead of a billed full-store sort, matching Lemma 3.4 at race-scale N (#25).
- Forest `grow` now emits on lazy incoming-edge replace so `W_j` trees replay as last-grow-per-head; `partitionTree` walks an explicit stack on tree-local scratch so long chains cannot blow the JS stack or allocate O(n) per `F̄` (#24).

### Changed

- k/t sweep markdown headers say XL is included when `--xl` cells are present (#103).
- Race photo-finish banner stays path-to-target; a settle-all work-clock line is added when playback reaches maxTotalWork, and the featured XL preset races without a finish cap (#103).
- Forest grow/cut overlay strokes now scale with the Race backing-store DPR (`pixelScale`), and those widths are included in the vertex dirty-radius pad so HiDPI forest strokes keep CSS-px weight (#98).
- Edge, frontier, and ghost strokes now scale with the Race backing-store DPR (`pixelScale`), and the vertex dirty radius pads for scaled stroke overhang so HiDPI partial composites leave no residue rings (#80).
- README hero caption DMSY photo-finish / settle-all totals updated for demo-default k (city n=500 seed 1729) (#54).
- DMSY omitted-params / worker default is now demo (swept k) not paper; paper stays selectable via `dmsy=paper` (#54).
- `public/og-card.png` recompressed with pngquant + oxipng from 815,118 to 225,213 bytes (72% smaller, still 1200×630 so `og:image` meta stays correct); byte-ceiling and IHDR contract tests in `test/og-card.test.ts` and `test/build-workers.ts` (#51).
- README, `index.html` meta, and `package.json` description now advertise the shipped 3-way race (Dijkstra vs BMSSP vs DMSY) and the first-public-implementation claim for arXiv 2602.07868 (#28).
- Deleted the unused `relax()` wrapper so production callers cannot emit paper-accept as `improved` (#92).
- paper-notes DMSY-P32: trace `improved` is a strict 4-tuple decrease; paper Relax accept still includes `"="` (#92).
- Empty `?` loads the 3-way DMSY race (`race=dijkstra,bmssp,dmsy`); URL codec serializes `race=` instead of `lane3=1` (`race=dmsy` accepted; `lane3=1` still parsed) (#27).
- Fairness panel: DMSY params paragraph (paper k/t/δ, binary heap vs Fibonacci); `dstruct.merge` in billed prose; Forester blurb and forest vocabulary no longer "forthcoming" (#27).
- paper-notes DMSY-P31: W′ `<B′` settles bypass `uCount`; `|U|` may exceed the workload cap by at most δ·|W′|. (#26)
- paper-notes DMSY-P31 W′ relax below B′ unions into U (#26).
- paper-notes §4 heap wording (Algorithm 2 only) and ambiguity log DMSY-P27–P30: `t` floor at `n = 2`, Algorithm 4 uses `dstruct` not heap, `t = 1` merge bypass, Observation 3.5 is analysis-only (#26).
- paper-notes DMSY-P26 / §3.5: Pull bills prefix select (O(|S′|)); Merge `putPair` bills a log(#blocks) factor; Insert/Merge/Pull exclude packing from `cmps` (#25).
- paper-notes: close DMSY-P10 (`merge` schema); add DMSY-P26 (`ZERO_LABEL`, Merge consumes D′) (#25).
- paper-notes §1.2: implementation δ is 3 for every finite JS `n` (the raw `⌊(1/4)·log₂ log₂ n⌋` term never reaches 3); `reducedSource` JSDoc notes the O(|V′|) scan for #26 (#23).

## [1.0.0] - 2026-08-14

v1.0 "The Race": Dijkstra vs BMSSP in the browser (Race, Lens, Story), with work-clock fairness, URL seeds, PNG/WebM export, and GitHub Pages. DMSY remains v2.0 (#22–#28).

### Changed

- README and `package.json` description no longer claim the DMSY lane ships; v1.0 is Dijkstra vs BMSSP, with DMSY planned for v2.0.

### Fixed

- Race lane photo-finish gold, source/finish marks, D-structure strip, and aggregated XL nodes keep their CSS-pixel weight on HiDPI backing stores (#79).
- Race defers lane backing-store resizes until WebM recording ends, so a mid-export window resize no longer clears the live canvases (#77).
- Race lane canvases size the backing store to CSS size × device pixel ratio so wide viewports no longer upscale a 400px bitmap (#77).
- Race header and lane column share a centered 1200px axis, so wide viewports no longer leave a left-anchored dead zone (#67).
- Gold-legend swatch uses canvas `PHOTO_FINISH_GOLD` in both themes, and the Frontier label is sourced from `siteCopy` (#65).
- Settled-legend swatch uses the canvas OKLCH blue→mid→gold ramp (`palette.ts` endpoints) instead of ink→gold, so the key matches the dots (#65).
- Best-in-class race counters announce with visually-hidden text instead of an `aria-label` that replaced the counter name (#63).
- `.race-lane[hidden]` now sets `display: none`, so Story single-lane beats actually hide the unused algorithm (author `display: flex` was defeating the `hidden` attribute) (#60).
- Story wheel navigation uses a 600ms cooldown and never exits to Race free play from scroll, so one flick cannot skip the whole tour (#60).
- WebM export holds ~1.5s after both lanes photo-freeze so the winner banner is captured, and the rAF loop keeps painting while the clock is paused (MediaRecorder was stopping on the freeze frame, then the hold never elapsed) (#21).

### Added

- M-size `drawDiff` replay-perf budget test (best-of-3 stub canvas, 50ms CI ceiling) for settle-diff dual-lane fills (#68).
- Race Diff view (`view=diff`) tints who-settled-where at equal billed work and marks out-of-order settles with ink ticks, with a shareable URL, glossary entry, and both-theme fills (#68).
- Race mode surfaces a shared canvas legend (frontier, settled gradient, unreached, gold path), persona identity dots, and hover tooltips on counters plus Dice/BMSSP controls, and labels the per-lane bar as percent settled so it is not mistaken for playback (#65).
- Race mode marks the photo-finish winner on the lane panels, highlights each lane's best-in-class secondary counters, shows a live settle-count lead until the first freeze, and hoists the existing verdict banner above the lanes so it stays visible at 1440×900 (#63).
- Chromium Playwright smoke (`npm run test:e2e`) mounts Story and asserts computed-style single-lane beats plus one wheel burst per step with no scroll exit to Race (#61).
- `npm run bench:trace` now measures best-of-3 after warmup and exits non-zero if best ≥ 100ms, so the issue #3 Node-bench claim is enforced (#35).
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

- BMSSP worker `graph` messages echo resolved `{k, t}`; Race/Lens/Story narrate FindPivots k from that echo (or `graph.n` fallback), not URL `n`. Parser rejects a half pair (`k` XOR `t`) so a malformed echo cannot silently fall back (#56).
- Race and Lens merge Play/Pause into one toggle, separate PNG/WebM from the playback cluster, and tooltip Step event, Step op, and disabled exports (#66).
- Mode nav marks the active Race/Lens/Story button as selected (`aria-current="page"`) instead of `disabled`, drops the duplicate mode subtitle, and separates the theme toggle behind a divider (#64).
- CI 1M-event Vitest guard stays at 200ms with sequential files; the 100ms number is no longer only a comment (#35).
- Story beat table drops unused `focusLane`; story pace/drive tests share `test/helpers/story-traces.ts` (PR #57 nits, #60).
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

[Unreleased]: https://github.com/fishygeek91/sorta-fast/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/fishygeek91/sorta-fast/releases/tag/v1.0.0
