# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Sorta Fast is pre-v1.0 (`package.json` is `0.0.0`); entries land under **Unreleased** until a version is tagged.

## [Unreleased]

### Added

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

- Lens rAF paints only while playing so a paused 5k-node graph does not redraw every frame (#8).
- Dijkstra trace worker copies CSR/layout typed arrays before `postMessage` transfer so `onGraph` no longer detaches buffers Dijkstra still reads (#8).
- `Playback.stepOp` advances the work-clock cursor so multi-cost heap events can be stepped through (#7).
- CI 1M-event budget uses 200ms headroom and sequential Vitest files so GitHub-hosted runners can stay green (main was red after #3; Deploy is gated on that check) (#35).
- Pages contract tests no longer run `vite.build()` inside Vitest, so they do not contend with the 1M-event budget on CI (#4).
- 1M-event trace write/replay is measured best-of-3 after warmup, and `encode` writes each SoA column once without per-event asserts, so the #3 budget holds on CI runners.

### Changed

- Removed the temporary #6/#7 main-thread Dijkstra scaffold in `src/main.ts` (#8).
- Renderer composites only the dirty rect after the first full frame so Canvas2D blit cost matches settle/frontier diffs (#6).
- `decodeAt` rejects detached chunk buffers instead of reporting an unknown kind (#3).
- Design doc §4.2 notes TraceWriter rotates SoA slabs rather than wrapping a true ring (#3).
