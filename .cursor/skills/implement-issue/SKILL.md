---
name: implement-issue
description: >-
  Implement an approved sorta-fast issue plan (or the named issue) with Maestro
  orchestration, the full correctness battery, verification through PR, and merge
  only when the human explicitly asks. Use when the user attaches this skill and
  says to implement, execute the plan, or ship the issue.
disable-model-invocation: true
---

# Implement Issue (Sorta Fast)

Implement the work. Prefer an already-approved plan in this conversation; otherwise pull the named issue and implement against its acceptance criteria.

## Input

Issue number (if no in-thread plan) and/or explicit "implement / execute / go ahead" for the current plan.

## Maestro is mandatory (not optional)

This skill **does not run** without Maestro. An `/implement-issue` turn that writes the implementation without `Task` subagents is a skill violation — stop and delegate.

1. **First tool calls this turn** (after this file): `Read` `~/.cursor/skills/maestro/SKILL.md`, then immediately launch `Task` subagents. Creating the git branch may happen in that same batch. Do **not** start writing `src/` or `test/` yourself before a `Task` is in flight.
2. **Every `Task` call must set** `model: "composer-2.5"`. Do not omit `model` (inherit is not Maestro — the UI will not show Composer 2.5). Do not pick another slug unless the user named one from the allowed Task list; if they name an invalid slug, report it and fall back to `composer-2.5`.
3. **One `Task` per subtask**, self-contained prompt (subagents have no chat history). Independent work goes in **one parent message with multiple `Task` calls**.
4. **Types:** `explore` for read-only research; `shell` for git / `gh` / test / lint commands; `generalPurpose` for file edits. Never one giant "implement the whole issue" subagent.
5. **Review** every subagent diff before accepting. Retry once with sharper instructions; after ~2 failures, take over that subtask yourself.
6. **What to delegate vs keep:**
   - **Always delegate:** test files, docs, lint/format fixes, harness/render/ui/workers, `explore` of existing APIs, `shell` for `tsc` / vitest / eslint.
   - **May delegate a draft, then you read every line:** `src/core/` algorithm/graph modules.
   - **Parent-authored only:** `src/core/trace.ts` op-cost table; final science accept/reject; PR open + ready-for-review comment.
7. "I'll just write it myself, it's small / it's science / review is faster" is the failure mode. Draft via `Task`, then review.

## Quality bar

- Check work as you go — do not batch-verify only at the end
- Strict TypeScript (no `any` without a commented reason, no `!`, no `as unknown as T`); honest errors; no placeholders
- Architecture invariants from `AGENTS.md` hold on every commit: trace-emitter contract, single op-cost table, renderer/algorithm separation, seeded determinism (no `Math.random()`/`Date.now()` in core/harness), typed arrays in hot paths
- Science code cites paper sections/lemmas in comments next to the code implementing them
- Never weaken, skip, or delete existing tests to get green — a failing differential/golden test means the change is wrong
- Match repo conventions; small honest diffs; one issue = one branch = one PR

## Workflow

1. **Bootstrap**: branch from fresh `main`: `issue-<n>-<slug>`. Never commit to `main` directly.
2. **Implement by phase** per the plan. Each phase launches `Task` (`composer-2.5`) for its independent pieces; you integrate and review.
3. **Correctness battery** — write/extend everything the issue's Testing requirements name: differential fuzzing (with weight ties), debug invariants, golden traces, trace audits. For perf ACs, measure and report actual numbers in the PR. Test files are `generalPurpose` work unless a retry already failed.
4. **Verify**: typecheck + `vitest run` + lint green locally before opening the PR (`shell` subagent is fine; you still confirm the output).
5. **Close out**: PR title `[M#] #<issue>: <title>`; body `Closes #N`, how each AC checkbox is met, deviations, test/perf evidence. Tick the corresponding box in Roadmap #29 via the PR description note (reviewer confirms on merge).
6. **Stop**. Comment ready-for-review on the PR. In the chat with the human, the last line of the close-out **must** be exactly `Issue #<N> Ready for review: #<PR>` (issue number first, then the PR number) so the issue and PR are both identifiable. Do not merge unless the human later explicitly asks. Claude reviews as the human on another platform. Discovered work → new issue, never scope creep.

## Anti-patterns

- Zero `Task` calls, or `Task` without `model: "composer-2.5"`
- Parent writing all of `src/` and `test/` because the work is "science" or "small"
- Skipping review of subagent output
- Delegating the whole issue as one giant subtask
- Scope creep / redesign of `docs/design.md` decisions
- PR with red local checks, or perf ACs asserted without measurement
- Hardcoding op costs at emission sites instead of the cost table
- Merging without an explicit human ask in this conversation
