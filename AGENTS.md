# AGENTS.md — Sorta Fast

*Read this before writing any code. It is the contract for all AI agents working in this repo.*

## What this project is

**Sorta Fast** races 67 years of shortest-path history on the same graph, in-browser: Dijkstra (1959) vs BMSSP (STOC 2025, arXiv 2504.17033) vs DMSY (Feb 2026, arXiv 2602.07868 — zero public implementations; ours will be the first). TypeScript + Vite + Canvas2D, zero backend, deployed to GitHub Pages.

**Full design doc: `docs/design.md` — it is the source of truth.** GitHub issues #1–#28 are the build plan (issue number = build order; milestone labels M1–M6; roadmap in issue #29).

## Workflow

1. Work one issue per branch/PR. Branch name: `issue-<n>-<slug>` (e.g. `issue-2-csr-graph`).
2. Respect `> Blocked by #N` in the issue body — do not start an issue whose blockers aren't merged.
3. Every AC checkbox in the issue must be genuinely satisfied and covered by a test where testable. Do not silently reduce scope; if an AC is impossible, say so in the PR description.
4. PR title: `[M#] #<issue>: <title>`. PR body: link the issue (`Closes #N`), list how each AC is met, note any deviations.
5. CI (typecheck + tests + lint) must be green. **Do not merge a PR unless the human explicitly asked.** Claude reviews as the human on another platform.
6. M6 only: issue #22 (paper deep-read → `docs/paper-notes.md`) must be merged before any other M6 issue is started.

## Architecture invariants (do not violate)

- **Algorithms are trace emitters.** Every algorithm is a pure, zero-DOM generator `run(graph, source)` yielding TraceEvents into typed-array ring buffers. Algorithms live in `src/core/` and must run headless in Node.
- **The renderer never imports algorithm code.** It consumes decoded TraceEvents only.
- **All op costs come from the single cost table in `src/core/trace.ts`.** Never hardcode a cost at an emission site. The fairness of the entire demo rests on this file.
- **Determinism is sacred.** Same seed → identical graph, identical trace, identical counters. No `Math.random()`, no `Date.now()` in core/harness paths; use the seeded mulberry32 PRNG. Iteration order must be stable.
- **Typed arrays over object graphs** in core/harness/render hot paths. 100k-node races produce millions of events; GC pauses kill the animation.
- Directory contract (from design doc §4.1): `src/core/` science (zero-DOM) · `src/harness/` clock/buffers/scheduler · `src/render/` Canvas2D · `src/ui/` panels/controls · `src/workers/` generation off main thread · `test/` · `bench/`.

## Correctness bar (design doc §5 — we claim a *first implementation*)

Every algorithm PR must include: differential fuzzing vs reference implementations on seeded graphs (including ties), debug-build invariant checks, golden-trace fixtures on hand-verified small graphs, and a trace audit that re-derives distances from events alone. Weight-tie cases are where SSSP bugs hide — always fuzz with ties.

## Style

- TypeScript strict; no `any` unless annotated with a reason.
- Small focused modules; the file layout in `docs/design.md` §4.1 is normative.
- Comment the *paper correspondence* in science code: cite section/lemma numbers (e.g. `// Lemma 3.3: block size bound`) so reviewers can check code against the papers.
- No new runtime dependencies without justification in the PR — this ships as a static page; keep the bundle lean.
