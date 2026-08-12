---
name: plan-issue
description: >-
  Pull a sorta-fast GitHub issue and produce a detailed Maestro-orchestrated
  implementation plan with finely split todos. Use when the user attaches this
  skill and names an issue (e.g. "#5", "issue 5"), or asks to plan a GH issue.
disable-model-invocation: true
---

# Plan Issue (Sorta Fast)

Pull the given GitHub issue and plan the work. Do not implement.

## Input

Issue number required. Examples: `/plan-issue #5`, `/plan-issue 5`. If missing, ask and stop.

## Maestro is mandatory (not optional)

This skill **does not run** without Maestro. A `/plan-issue` turn with zero `Task` tool calls is a skill violation — stop, launch subagents, then continue.

1. **First tool calls this turn** (after this file): `Read` `~/.cursor/skills/maestro/SKILL.md`, then immediately launch `Task` subagents. `gh issue view` / git may run in that same batch. Do **not** grep the repo or draft the plan yourself before a `Task` is in flight.
2. **Every `Task` call must set** `model: "composer-2.5"`. Do not omit `model` (inherit is not Maestro — the UI will not show Composer 2.5). Do not pick another slug unless the user named one from the allowed Task list; if they name an invalid slug, report it and fall back to `composer-2.5`.
3. **One `Task` per subtask**, self-contained prompt (subagents have no chat history). Independent research goes in **one parent message with multiple `Task` calls**.
4. **Types:** `explore` for codebase/design reads; `shell` for `gh` / git / file-tree commands. Never one giant "plan the whole issue" subagent.
5. **Review** every subagent output; open cited files yourself before trusting them. Retry once, then take over that subtask.
6. **Parent-only work:** lock design decisions, write the plan, CreatePlan. Everything else is delegated first.

Doing the research yourself because it "seems faster" is the failure mode this skill exists to prevent.

## Repo gates (non-negotiable)

Read in order before planning: `AGENTS.md` → `docs/design.md` (the sections the issue cites) → the issue itself → `.cursor/rules/`.

- The issue's `> Blocked by #N` blockers must all be merged; otherwise stop and say so. Prefer the lowest-numbered unblocked open issue if asked "what's next" (issue number = build order; #22 gates all other M6 work).
- **Never redesign.** `docs/design.md` decisions are final: algorithms are trace emitters; single op-cost table in `src/core/trace.ts`; renderer never imports algorithm code; seeded determinism everywhere. If genuinely blocked by a design decision, note it in the plan and flag for the human — don't work around it silently.
- Plan stays within the issue's acceptance criteria — discovered work becomes a new GitHub issue, not scope creep.
- For M3/M6 science issues: the plan must map each paper section/lemma (arXiv 2504.17033 / 2602.07868; for M6, `docs/paper-notes.md`) to the module that implements it, and must include the §5 correctness battery (differential fuzz with ties, invariants, golden traces, trace audit) as explicit todos.

## Workflow

1. **Fetch** with `gh issue view <N> --json number,title,body,labels,state,comments,url` (may be a `shell` subagent, in parallel with explores).
2. **Explore in parallel via `Task` (`composer-2.5`)** — at minimum all of:
   - existing modules the issue touches
   - test patterns / vitest layout
   - trace-schema / cost-table contracts if relevant
   - adjacent issues that constrain scope
3. **Double-check** critical files yourself before trusting subagents.
4. **Lock decisions** — pick one concrete approach from evidence; no A/B left open in the plan.
5. **Create the plan** (CreatePlan / plan mode): problem + context with file paths, chosen design, phased sequence, explicit non-goals.
6. **Todos — methodical and finely split**:
   - One todo = one file change, one behavior, or one assertion — not a phase blob
   - Phases: core implementation → trace instrumentation → tests (fuzz/invariants/golden/audit) → perf verification where the AC names budgets → docs → PR (ready-for-review, no merge)
   - Prefer 15–30 sharp todos over 5 fat ones
   - Every AC checkbox in the issue maps to at least one todo
7. **Stop** after presenting the plan. No branch/edit/commit until the user runs `/implement-issue` or explicitly says to execute.

## Anti-patterns

- Implementing during planning
- Zero `Task` calls, or `Task` without `model: "composer-2.5"`
- Parent grepping/reading the whole tree instead of `explore` / `shell` subagents
- Fat todos ("build the renderer") — split per layer / per overlay / per test
- Accepting explore claims without opening cited files
- Expanding past the issue's acceptance criteria
- Delegating the whole request as one giant subtask
