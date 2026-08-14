# SORTA FAST — Design Document

**Name:** *Sorta Fast* (repo: `sorta-fast`) — shortest paths that only *sorta* sort. That's not a joke, that's the algorithm.
**One-line pitch:** Watch 67 years of shortest-path history race on the same graph, in your browser, in real time — including the first public implementation of the February 2026 algorithm.
**Subtitle on site:** *Dijkstra vs. the barrier-breakers.*

**Status:** Design approved, pre-repo. This doc is the source of truth for writing GitHub issues (see §10).
**Stack:** TypeScript + Vite + Canvas2D, zero backend, hosted free on GitHub Pages.

---

## 1. Vision

For 66 years, every shortest-path algorithm bowed to the same rule: to find shortest paths, you must process vertices in sorted distance order — and sorting costs `n log n`. Dijkstra's algorithm *is* that rule, made flesh. Then in 2025, Duan, Mao, Mao, Shu & Yin broke the barrier (`O(m log^{2/3} n)`, STOC 2025 Best Paper), and in February 2026 four of them broke their own record (`O(m√(log n·log log n))` on sparse graphs, arXiv 2602.07868).

Nobody outside a handful of theorists has ever *seen* these algorithms run. The 2026 one has **zero public implementations**. That's the opportunity: an in-browser race where the difference in *how they think* is visible to anyone in ten seconds.

### The three racers (give them character — this is the viral hook)

| Lane | Algorithm | Persona | Visual signature |
|---|---|---|---|
| 🏛 | **Dijkstra (1959)** | *The Perfectionist.* Won't touch vertex k+1 until it's certain about vertex k. | A flawless, smooth expanding wavefront. Settle-order gradient is a perfect rainbow. |
| 🧨 | **BMSSP (STOC 2025)** | *The Batcher.* Refuses to fully sort. Picks pivots, recurses on bounded slices, settles vertices in chunky out-of-order blooms. | Pulsing batch-blooms; recursion depth shown as nested tints; pivots flare. |
| 🌲 | **DMSY (Feb 2026)** | *The Forester.* Grows spanning forests from the frontier, chops them into Θ(k)-size subtrees, and only sorts one representative per subtree. | Forest edges sprout and get partitioned live; only pivot vertices ever enter the "sorted lane." |

The core visual argument: **Dijkstra pays for perfect order; the barrier-breakers pay only for *enough* order.** You can see it — one side is a smooth wave, the other sides are impatient, batchy, and *cheaper*.

### Why it can go viral
- "New algorithm beats Dijkstra" was one of 2025's biggest CS stories (Quanta, HN front page repeatedly). There is still no good way to *see* it.
- "First public implementation of the Feb 2026 algorithm" is its own announcement.
- Every race is seeded and URL-shareable: `?seed=42&graph=city&race=all` reproduces exactly. People will trade seeds where the rankings flip.
- Photo-finish op counters + a built-in GIF/WebM export make it self-propagating on social.

---

## 2. The science (what we're actually implementing)

### 2.1 Dijkstra (baseline lane)
Binary heap, decrease-key via lazy deletion. Every heap op and every edge relaxation is emitted as a trace event. Nothing fancy — it must be textbook, because it's the control group.

### 2.2 BMSSP — Duan, Mao, Mao, Shu, Yin (STOC 2025), `O(m log^{2/3} n)`, deterministic
Key structures to implement (from arXiv 2504.17033):
- **Parameters:** `k = ⌊log^{1/3} n⌋`, `t = ⌊log^{2/3} n⌋`; recursion depth ~ `(log n)/t` levels. The in-browser demo uses swept k/t (`k = max(4, paper k)`, paper t) because asymptotic k is degenerate below n≈10⁸; the paper formula remains selectable.
- **`FindPivots(B, S)`:** runs k rounds of Bellman-Ford–style relaxation from frontier S; vertices whose shortest-path trees grow to size ≥ k identify **pivots** — the only frontier vertices that must be handled in sorted order. Everything else gets settled inside the batch.
- **`BMSSP(l, B, S)` recursion:** bounded multi-source shortest paths — settle every vertex with `dist < B` reachable via S, level by level, pulling `2^t`-size slices from the data structure.
- **Data structure `D`** (Lemma 3.3): supports `Insert`, batch-prepend `BatchPrepend`, and `Pull` of the M smallest keys — a linked-list-of-blocks structure, *not* a full heap. This is the "partial sorting" heart of the paper.
- Base case (`l = 0`): mini-Dijkstra limited to k+1 settlings.

Existing rough implementations to cross-check against (none are visual): [bm-sssp (TS)](https://github.com/Braeniac/bm-sssp), [DMMSY-SSSP (C)](https://github.com/danalec/DMMSY-SSSP), [fast_sssp (Rust)](https://github.com/alphastrata/fast_sssp).

### 2.3 DMSY — Duan, Mao, Shu, Yin (Feb 2026, arXiv 2602.07868), deterministic
`O(m√log n + √(mn·log n·log log n))` — i.e. `O(m√(log n log log n))` sparse. **Zero public implementations.** From the paper's structure (v2 HTML):
- Same BMSSP recursion skeleton as 2025, but the pivot-finding cost drops from O(k) to **O(log k) per vertex**.
- **Spanning-forest pivot selection (§3.1):** instead of k Bellman-Ford rounds, grow a spanning forest via local Dijkstra searches from the frontier, partition it into edge-disjoint subtrees of size Θ(k), and track only the minimum-distance vertex per subtree as pivot.
- **Partial-sorting structure (§3.2):** holds only ~1/k of frontier vertices; the rest need only range checks. Insertion cost amortized against partition-forest edges.
- **Preprocessing (§2.1):** degree reduction to Θ(√log n)-bounded degree (vertex splitting).
- **Tie-breaking:** lexicographic (path length, edge count, vertex ID, predecessor) — must be implemented exactly or correctness proofs don't hold.

**Risk posture:** this lane is the hardest and most valuable. It ships as *Round 2* behind a feature flag — the site launches with lanes 1+2, and lane 3 unlocks when its differential tests pass (§8). The announcement writes itself twice.

### 2.4 The fairness model (this is what makes the demo honest)
At browser scale (10³–10⁵ nodes), Dijkstra + binary heap will often win **wall-clock** — the asymptotics need enormous n and the constants are real. Racing milliseconds would be misleading and invite "this is rigged" replies. So:

- The race clock is a **work clock**: every trace event carries an op cost (comparison = 1, heap op = its comparison count, relaxation = 1, etc.), identical accounting rules for all lanes, documented on-site in a "Fairness" panel.
- Headline metric: **total comparisons**. Secondary: heap/D-structure ops, relaxations, "vertices settled out of order" (0 for Dijkstra — that's the whole point).
- A separate (non-race) **wall-clock benchmark page** shows real timings across graph sizes with the honest caveat, plus the crossover discussion. Honesty is a feature: "we show you where Dijkstra still wins" builds trust and is itself interesting content.

---

## 3. Experience design

### 3.1 Layout
```
┌──────────────────────────────────────────────────────────────┐
│  SORTA FAST 🏁                [Race ▾] [Graph ▾] [Seed 🎲]   │
├────────────────────┬────────────────────┬────────────────────┤
│   🏛 DIJKSTRA      │   🧨 BMSSP '25     │   🌲 DMSY '26      │
│                    │                    │                    │
│   (canvas lane)    │   (canvas lane)    │   (canvas lane)    │
│                    │                    │                    │
│  cmp 48,210 ▓▓▓▓▓  │  cmp 31,077 ▓▓▓    │  cmp 24,455 ▓▓     │
├────────────────────┴────────────────────┴────────────────────┤
│  ⏮ ◀ ▶ ⏭   ▬▬▬▬▬●▬▬▬▬▬▬▬▬  speed ×8   [step] [📸] [🎬]      │
│  ▸ What am I looking at?      ▸ Fairness rules   ▸ The papers │
└──────────────────────────────────────────────────────────────┘
```
2-lane mode gets bigger panels; mobile stacks lanes vertically with a shared scrubber.

### 3.2 The race, moment to moment
- All lanes run on the shared work clock: at clock tick T, each lane has spent exactly T ops. Fast algorithms are visibly *further along the same graph*.
- Nodes fill with a **settle-order gradient** (perceptually uniform, colorblind-safe). Dijkstra's panel becomes a perfect radial rainbow; BMSSP's is streaky and batchy; DMSY's is patchwork-by-subtree. Screenshot any finished race and the story is legible with zero animation.
- Per-lane overlays (toggleable): current frontier, relaxed edges (ghost trails), pivots (flare + ring), recursion depth (nested background tint), forest partition boundaries (DMSY), the D-structure as a live strip of blocks under the lane.
- **Photo finish:** when a lane's source-to-target path settles, that lane freezes with the path drawn in gold and its counter locked. Final banner: "BMSSP beat Dijkstra by 17,133 comparisons on this graph."
- After photo-finish, the winning lane is marked on the panel (lowest billed work) and best-in-class secondary counters are highlighted; while no lane is frozen, the live lead is settle-count at equal billed work.
- **Scrubbing is sacred:** the entire race is a precomputed trace, so the timeline slider scrubs forward *and backward* at any speed, including single-step. This turns the demo from a video into an instrument.

### 3.3 Modes
1. **Race** — the headline mode above (2-way or 3-way).
2. **Lens** — one algorithm, full screen, every internal visible, with a step-by-step narration panel ("FindPivots round 2/4: 312 vertices relaxed, 9 pivots found"). This is the mode teachers will use.
3. **Story** — a 90-second guided tour: what Dijkstra does → what sorting costs → how pivots cheat the barrier → the 2026 forest trick → free play. Scroll- or click-driven, ends by dropping you into Race mode.

### 3.4 Graph gallery (all seeded & URL-encoded)
- **Delaunay/geometric city** — the flagship; looks like a road map, layouts are pretty. No XL size (capped at L / 25k nodes; issue #32).
- **Grid maze** — recursion structure reads clearly.
- **Ring of clusters** — makes batch-blooms dramatic (frontiers jump between clusters).
- **Adversarial for Dijkstra** — long chains + wide fans; the heap thrashes.
- **Sparse random (m ≈ 2n)** — the regime where the 2026 bound shines.
- Sizes S/M/L/XL (500 / 5k / 25k / 100k nodes). XL uses aggregated rendering (§4.4). City has no XL (Delaunay is O(n²); capped at L; issue #32).

### 3.5 Share loop
- Full state in URL: `?g=city&n=5000&seed=1729&race=dijkstra,bmssp,dmsy&t=48210`.
- 📸 exports a finished-race PNG with counters and seed baked in; 🎬 exports a WebM/GIF of the race via `MediaRecorder` on the canvas.
- OpenGraph card = a pre-rendered photo-finish image. HN/Twitter unfurls sell the click.

### 3.6 Visual language
Follow the dataviz skill before building: one perceptually-uniform settle gradient shared by all lanes, one accent per lane persona (marble/stone for Dijkstra, ember for BMSSP, moss for DMSY), dark theme default with light theme support, no chartjunk. Counters use tabular numerals. Everything must look gorgeous in a 1200×630 screenshot — that's the unit of distribution.

---

## 4. Architecture

### 4.1 Repo layout (single Vite app, npm workspaces optional but not required)
```
sorta-fast/
  src/
    core/            # zero-DOM, pure TS — the science
      graph.ts       # CSR adjacency (typed arrays), weights, seeded generators
      trace.ts       # TraceEvent types, TraceWriter, op-cost table
      dijkstra.ts    # instrumented generator
      bmssp/         # 2025: findPivots.ts, dstructure.ts, bmssp.ts
      dmsy/          # 2026: forest.ts, partialSort.ts, degreeReduce.ts, dmsy.ts
    harness/         # race scheduler, work clock, trace buffers, worker glue
    render/          # Canvas2D renderer, layered draw, gradient/overlay system
    ui/              # panels, controls, scrubber, story mode, share/export
    workers/         # trace generation off the main thread
  test/              # vitest: unit + differential fuzzing + golden traces
  bench/             # wall-clock benchmark harness (separate page)
  .github/workflows/ # ci.yml (test), deploy.yml (Pages)
```

### 4.2 The one design decision everything hangs on: **algorithms are trace emitters**
Each algorithm is a pure function `run(graph, source): TraceEvent[]` (implemented as a generator, drained in a worker). Events are written into **typed-array SoA slabs** (kind, vertex, edge, cost, aux), not JS object arrays — 100k-node races produce millions of events and GC pauses would murder the animation. `TraceWriter` **rotates** fixed-capacity slabs rather than wrapping a true ring, so a filled slab can be handed off as transferables without the writer retaining the buffer (issue #3).

```ts
type TraceEvent =
  | { k: 'relax';  e: EdgeId; improved: boolean; cost: 1 }
  | { k: 'settle'; v: VertexId; order: number; cost: 1 }
  | { k: 'heap';   op: 'push'|'popmin'|'sift'; cmps: number }
  | { k: 'pivot';  v: VertexId; level: number }             // BMSSP + DMSY
  | { k: 'batch';  phase: 'start'|'end'; level: number; size: number }
  | { k: 'recurse'; dir: 'in'|'out'; level: number; bound: number }
  | { k: 'forest'; op: 'grow'|'cut'; e: EdgeId; tree: number } // DMSY only
  | { k: 'dstruct'; op: 'insert'|'batchPrepend'|'pull'; n: number; cmps: number }
```
Consequences: algorithms are testable headless in Node; the renderer never knows algorithm internals; scrub/rewind/replay are free; op accounting is centralized in one cost table (auditable — link it from the Fairness panel).

### 4.3 Execution model
- On "race": UI posts `(graphSpec, seed, lanes)` to a **Web Worker pool**; each lane's trace is generated concurrently and streamed back in chunks (transferables), so the race can *start animating before generation finishes*.
- BMSSP worker `graph` messages echo the resolved `{k, t}` used for the run; Dijkstra omits those fields. Race/Lens/Story pass echoed k into playback so FindPivots narration matches execution if a generator ever rounds `n`.
- Main thread holds `TraceBuffer` per lane + a `WorkClock`; each rAF frame advances the clock by `speed × dt` ops and applies events up to the new cursor. Rewind = reset lane state snapshot + replay (keyframe snapshots every ~250k ops make backward scrubbing O(1)-ish).

### 4.4 Rendering
- Canvas2D, layered: static edge layer (drawn once per graph) / dynamic fill layer (settle gradient, dirty-rect batched) / overlay layer (frontier, pivots, forest) / FX layer (blooms, photo-finish).
- ≥25k nodes: nodes become 2px squares via `ImageData` writes; edges pre-rendered to an offscreen bitmap. 60fps target on M-size, 30fps floor on XL.
- Layout coordinates come from each generator in the worker at graph-gen time (v1 gallery: maze grid, cluster ring, city Delaunay points, sparse unit square, adversarial chain/fan columns). A progress bar covers `generateGraph` in the worker; no spring embedder in v1.

---

## 5. Correctness strategy (non-negotiable — we're claiming a first implementation)

1. **Differential fuzzing:** vitest suite runs all three algorithms + a reference Bellman-Ford on thousands of seeded random graphs (varying n, m, weight distributions, including ties); assert identical distance arrays. Runs in CI on every PR.
2. **Invariant checks (debug builds):** Dijkstra settles in nondecreasing order; BMSSP/DMSY never settle a vertex with `dist ≥ B` inside a bounded call; DMSY tie-breaking is exactly lexicographic per the paper.
3. **Golden traces:** small graphs with hand-verified event sequences, frozen as fixtures — catches trace-instrumentation regressions, not just distance bugs.
4. **Trace audits:** a CI check replays every trace and re-derives distances *from the events alone*; guarantees the visualization can never silently diverge from the algorithm.
5. **Cross-check BMSSP** against the existing C/Rust implementations' outputs on shared test graphs.

---

## 6. Hosting & deployment — GitHub Pages, yes

- 100% static (all computation in-browser), so Pages is a perfect fit: free, no cold starts, no quotas that matter.
- `deploy.yml`: on push to `main` → `vite build` (with `base` set for project pages) → `actions/deploy-pages`. `ci.yml` runs typecheck + tests on PRs; deploys are blocked on green.
- Custom domain optional later (e.g. `sortafast.dev`) — just a CNAME; Pages gives free TLS.
- OG/social card images are static files generated at build time.
- If we ever want preview-deploys-per-PR or analytics, Cloudflare Pages is a drop-in swap. Not needed for launch.

---

## 7. What ships when

- **v1.0 — "The Race" (launchable):** Dijkstra vs BMSSP, Race + Lens modes, 4 graph types, work clock + fairness panel, URL seeds, PNG export, Pages deploy.
- **v1.1 — polish:** Story mode, GIF/WebM export, XL graphs, adversarial graph, wall-clock bench page.
- **v2.0 — "Round 2":** DMSY lane behind `?lane3=1` flips to default-on once differential tests pass. Second announcement: *first public implementation of arXiv 2602.07868*.

Estimated effort: v1.0 ≈ 4–6 focused days; DMSY is the long pole of v2.0 (budget 3–5 days of paper-wrangling, heavily test-driven).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| DMSY (2026) is misimplemented — no reference exists | Test-first from the paper; invariants + differential fuzzing (§5); ship behind flag; publish the test suite so others can check us. |
| "Rigged" accusations re: speed | Work-clock fairness panel, open cost table, honest wall-clock page where Dijkstra wins small. |
| BMSSP constants make batches look *slower* early on small graphs | The deficit is size-invariant under paper k=2 (FindPivots abort). Demo uses k=max(4, paper k); default race is sparse n=25000 seed=4 where BMSSP wins comparisons; Fairness panel discloses the deviation. |
| Canvas perf on XL graphs | Aggregated rendering path (§4.4); XL is a labeled "stress" option, not the default. |
| Paper ambiguities (tie-breaking, base cases) | Decisions logged in `docs/paper-notes.md` with section citations; becomes the companion blog post. |

---

## 9. Companion content (cheap, high-leverage)
- `docs/paper-notes.md` → blog post: "Implementing the algorithm that broke the sorting barrier (twice)". Implementation war stories from a paper with no reference code are exactly what HN loves.
- README with the photo-finish GIF at the top, seed-of-the-day examples, and a "try to find a seed where Dijkstra wins the work clock" challenge.

---

## 10. GitHub issue breakdown (ready to transcribe)

Milestones: **M1 Foundation → M2 Dijkstra lane → M3 BMSSP lane → M4 Race UI → M5 Launch → M6 DMSY (Round 2)**. Labels: `core`, `render`, `ui`, `infra`, `science`, `polish`, `good-first-issue`.

**M1 — Foundation**
1. `infra` Scaffold Vite + TS strict + vitest + ESLint/Prettier; CI workflow (typecheck + test on PR). *AC: green CI on empty app.*
2. `core` CSR graph representation on typed arrays + seeded PRNG (mulberry32) + graph generators (geometric/Delaunay city, grid maze, cluster ring, sparse random) with coordinates. *AC: generators deterministic per seed; property tests.*
3. `core` TraceEvent schema, op-cost table, TraceWriter on typed-array ring buffers + chunked transfer protocol. *AC: 1M events written/replayed < 100ms in Node bench (`npm run bench:trace`); CI Vitest guard uses 200ms headroom on shared runners (#35).*
4. `infra` GitHub Pages deploy workflow (build → deploy-pages, blocked on CI). *AC: hello-world live on Pages URL.*

**M2 — Dijkstra lane**
5. `core` Instrumented Dijkstra (binary heap, lazy deletion) emitting full trace. *AC: differential test vs Bellman-Ford on 1k seeded graphs; settle-order invariant.*
6. `render` Canvas renderer v1: static edge layer, settle-gradient fill, frontier overlay, dirty-rect batching. *AC: 5k-node replay at 60fps.*
7. `harness` WorkClock + TraceBuffer + keyframe snapshots; play/pause/speed/step/scrub (both directions). *AC: backward scrub on 5k graph feels instant.*
8. `ui` Single-lane Lens mode: canvas + counters + timeline + overlay toggles. *AC: shareable `?seed=` URL reproduces exactly.*

**M3 — BMSSP lane (STOC 2025)**
9. `science` Data structure D (Lemma 3.3): Insert / BatchPrepend / Pull with comparison counting. *AC: unit tests incl. adversarial sequences; ops match paper's bounds on random workloads.*
10. `science` FindPivots(B, S) with pivot/batch trace events. *AC: pivot count ≤ |S|/k on fuzz graphs (paper Lemma).*
11. `science` BMSSP recursion + base case; full instrumented lane. *AC: differential fuzz vs Dijkstra distances on 5k seeded graphs incl. ties; bounded-settle invariant.*
12. `render` BMSSP overlays: recursion-depth tint, pivot flares, batch blooms, live D-structure strip. *AC: Lens mode narration shows level/bound/batch stats.*

**M4 — Race UI**
13. `harness` Multi-lane race scheduler on shared work clock; worker pool; stream-while-generating. *AC: 3 lanes × 25k nodes race with no main-thread stalls > 50ms.*
14. `ui` Race mode: 2–3 lane layout, live counters + progress bars, photo-finish freeze + banner, mobile stacking. *AC: complete race → banner with per-lane op totals.*
15. `ui` Graph/seed/size picker, dice button, full state in URL. *AC: any race reproducible from URL alone.*
16. `ui` Fairness panel + "What am I looking at?" explainer drawer + paper links.

**M5 — Launch polish**
17. `polish` Visual pass per dataviz system: palette, dark/light, typography, tabular counters, OG card. *AC: 1200×630 screenshot looks like a poster.*
18. `ui` PNG photo-finish export; 🎬 WebM/GIF race export via MediaRecorder.
19. `ui` Story mode (guided 90-second tour ending in free play).
20. `polish` Adversarial + XL graphs, aggregated render path, perf budget met.
21. `infra` README with hero GIF, seed challenge, benchmark page; launch checklist.

**M6 — DMSY lane (Feb 2026) — Round 2**
22. `science` Paper deep-read → `docs/paper-notes.md`: pseudocode reconstruction, tie-breaking spec, parameter choices, ambiguity log with section cites. *(Do this issue first; it de-risks all of M6.)*
23. `science` Degree reduction preprocessing (Θ(√log n) bounded degree) as graph transform, with un-mapping for rendering. *AC: distances invariant under transform on fuzz graphs.*
24. `science` Spanning-forest pivot selection: local Dijkstra growth, Θ(k) subtree partition, per-subtree pivot; `forest` trace events. *AC: partition edge-disjoint, subtree sizes in bounds, fuzz-tested.*
25. `science` Partial-sorting structure (§3.2) with amortized-cost counters. *AC: only ~1/k of frontier ever enters sorted region on fuzz workloads.*
26. `science` Full DMSY recursion with exact lexicographic tie-breaking; instrumented lane. *AC: differential fuzz vs both other lanes on 10k seeded graphs; all invariants; golden traces.*
27. `render`/`ui` Forest overlays (grow/cut animations, subtree patchwork tint); enable lane 3 in race + Lens; update fairness table. *AC: 3-way race default-on.*
28. `polish` Round-2 announcement kit: updated OG card, README, blog post from paper-notes.

---

## Appendix: sources
- STOC 2025: [Breaking the Sorting Barrier for Directed SSSP](https://dl.acm.org/doi/10.1145/3717823.3718179) · [arXiv 2504.17033](https://arxiv.org/pdf/2504.17033)
- Feb 2026: [A Faster Directed SSSP Algorithm, arXiv 2602.07868](https://arxiv.org/abs/2602.07868)
- Press: [Quanta Magazine, Aug 2025](https://www.quantamagazine.org/new-method-is-the-fastest-way-to-find-the-best-routes-20250806/)
- Prior implementations (BMSSP only, non-visual): [Braeniac/bm-sssp (TS)](https://github.com/Braeniac/bm-sssp) · [danalec/DMMSY-SSSP (C)](https://github.com/danalec/DMMSY-SSSP) · [alphastrata/fast_sssp (Rust)](https://github.com/alphastrata/fast_sssp)
