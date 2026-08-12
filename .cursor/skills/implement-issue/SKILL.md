---
name: implement-issue
description: >-
  Implement an approved sorta-fast issue plan (or the named issue) with Maestro
  orchestration, the full correctness battery, verification through PR, and no
  self-merge. Use when the user attaches this skill and says to implement,
  execute the plan, or ship the issue.
disable-model-invocation: true
---

# Implement Issue (Sorta Fast)

Implement the work. Prefer an already-approved plan in this conversation; otherwise pull the named issue and implement against its acceptance criteria.

## Input

Issue number (if no in-thread plan) and/or explicit "implement / execute / go ahead" for the current plan.

## Required: Maestro

Read and follow `~/.cursor/skills/maestro/SKILL.md` (or attached `/maestro`):

- Track the finely split plan todos (create them if missing)
- Delegate mechanical edits/docs to subagents; keep science code (`src/core/`) and the cost table under direct review
- Review every subagent diff; retry once, then take over

## Quality bar

- Check work as you go — do not batch-verify only at the end
- Strict TypeScript (no `any` without a commented reason, no `!`, no `as unknown as T`); honest errors; no placeholders
- Architecture invariants from `AGENTS.md` hold on every commit: trace-emitter contract, single op-cost table, renderer/algorithm separation, seeded determinism (no `Math.random()`/`Date.now()` in core/harness), typed arrays in hot paths
- Science code cites paper sections/lemmas in comments next to the code implementing them
- Never weaken, skip, or delete existing tests to get green — a failing differential/golden test means the change is wrong
- Match repo conventions; small honest diffs; one issue = one branch = one PR

## Workflow

1. **Bootstrap**: branch from fresh `main`: `issue-<n>-<slug>`. Never commit to `main` directly.
2. **Implement by phase** per the plan. Parallelize independent work via Maestro.
3. **Correctness battery** — write/extend everything the issue's Testing requirements name: differential fuzzing (with weight ties), debug invariants, golden traces, trace audits. For perf ACs, measure and report actual numbers in the PR.
4. **Verify**: typecheck + `vitest run` + lint green locally before opening the PR.
5. **Close out**: PR title `[M#] #<issue>: <title>`; body `Closes #N`, how each AC checkbox is met, deviations, test/perf evidence. Tick the corresponding box in Roadmap #29 via the PR description note (reviewer confirms on merge).
6. **Stop**. Comment ready-for-review. **Claude reviews every PR before merge — never merge, never approve your own PR.** Discovered work → new issue, never scope creep.

## Anti-patterns

- Skipping Maestro review of subagent output
- Scope creep / redesign of `docs/design.md` decisions
- PR with red local checks, or perf ACs asserted without measurement
- Hardcoding op costs at emission sites instead of the cost table
- Self-merge or posting your own APPROVE as substitute review
