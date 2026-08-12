# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Sorta Fast is pre-v1.0 (`package.json` is `0.0.0`); entries land under **Unreleased** until a version is tagged.

## [Unreleased]

### Fixed

- CI 1M-event budget uses 200ms headroom and sequential Vitest files so GitHub-hosted runners can stay green (main was red after #3; Deploy is gated on that check) (#35).
- Pages contract tests no longer run `vite.build()` inside Vitest, so they do not contend with the 1M-event budget on CI (#4).
- 1M-event trace write/replay is measured best-of-3 after warmup, and `encode` writes each SoA column once without per-event asserts, so the #3 budget holds on CI runners.

### Changed

- `decodeAt` rejects detached chunk buffers instead of reporting an unknown kind (#3).
- Design doc §4.2 notes TraceWriter rotates SoA slabs rather than wrapping a true ring (#3).

### Added

- GitHub Pages deploy workflow on push to `main`, gated on CI, and Vite `base` `/sorta-fast/` so assets resolve on the project-pages URL (#4).
- TraceEvent SoA schema, centralized op-cost table, and TraceWriter chunked slabs so algorithms can emit traces without per-event object allocation (#3).
- Design doc (`docs/design.md`), agent contract (`AGENTS.md`), Cursor rules, and README stub.
- Vite + TypeScript strict + Vitest + ESLint/Prettier scaffold and CI on PRs and `main` (#1).
- `/plan-issue` and `/implement-issue` skills, plus workflow, testing, and allowed-model rules.
- Typed-array CSR graphs, seeded mulberry32 PRNG, and four seeded generators (#2).
- This changelog (Keep a Changelog; entries stay under Unreleased until a version is tagged).
