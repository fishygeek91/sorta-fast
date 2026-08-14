# Sorta Fast 🏁

[![Sorta Fast photo-finish](docs/assets/hero.gif)](https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp)

The clip is a **photo-finish** (race to the marked target): on this seed Dijkstra reaches the target first. BMSSP still wins the **settle-all work clock** on the same graph. See the [wall-clock bench](https://fishygeek91.github.io/sorta-fast/bench/) and [`bench/bmssp-kt-sweep.md`](bench/bmssp-kt-sweep.md) for comparison counts.

*Shortest paths that only sorta sort. That's not a joke, that's the algorithm.*

67 years of shortest-path history racing in the browser — Dijkstra (1959) vs BMSSP (STOC 2025). A DMSY (Feb 2026) lane is planned for v2.0.

**[Play live →](https://fishygeek91.github.io/sorta-fast/)**

## What this is

Sorta Fast is an in-browser visualization where Dijkstra and BMSSP run on the **same graph** and race to settle every vertex. Each lane emits a trace of operations; the renderer never imports algorithm code — it only replays those traces. Every race is seeded and URL-shareable, so you can reproduce a photo finish exactly.

The headline metric is a **work clock** (total comparisons), not wall-clock milliseconds. That keeps the race honest about what each algorithm *does*, even when a binary heap would finish faster on your laptop at modest graph sizes.

## Try these seeds

| Preset | What to look for |
|---|---|
| [Default race (sparse 25k, seed 4)](https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp) | BMSSP wins settle-all comparisons; Dijkstra often wins the photo-finish to the marked target. |
| [Story preset](https://fishygeek91.github.io/sorta-fast/?g=city&n=500&seed=1729) | City layout at n=500 — good for watching wavefronts. |
| [Dijkstra work-clock win (easy)](https://fishygeek91.github.io/sorta-fast/?g=maze&n=500&seed=0) | Maze graph — Dijkstra wins the work clock here. |
| [Paper-k Dijkstra win on the default graph](https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp&bmssp=paper) | Same sparse 25k seed as the hero, but BMSSP uses paper k/t — Dijkstra takes comparisons. |

## Seed challenge

Can you find a seed where **Dijkstra wins the work clock** on the default sparse 25k graph with demo k (`k = max(4, paper k)`)? Seeds 0–9 at sparse L / demo k=4 are tabulated in [`bench/bmssp-kt-sweep.md`](bench/bmssp-kt-sweep.md): all BMSSP work-clock wins; the best margin is seed 4. Maze graphs and `&bmssp=paper` already give Dijkstra wins — the hard case is sparse at large n with the in-browser demo parameters.

## Fairness

The race uses a **work clock**: every trace event carries an op cost, and the headline score is **total comparisons**. The same accounting rules apply to every lane. Open the on-site **Fairness** panel for the full rules; the authoritative cost table lives in [`src/core/trace.ts`](https://github.com/fishygeek91/sorta-fast/blob/main/src/core/trace.ts).

At browser scale (roughly 10³–10⁵ nodes), Dijkstra with a binary heap often wins **wall-clock** time even when it loses on comparisons — asymptotics need enormous n, and constants matter. For real timings across graph sizes, see the separate **[bench](https://fishygeek91.github.io/sorta-fast/bench/)** page (wall-clock benchmark, not the race clock).

## Papers and press

- [STOC 2025 (ACM)](https://dl.acm.org/doi/10.1145/3717823.3718179) — deterministic `O(m log^{2/3} n)` BMSSP.
- [arXiv 2504.17033](https://arxiv.org/pdf/2504.17033) — BMSSP preprint (implementation reference).
- [arXiv 2602.07868](https://arxiv.org/abs/2602.07868) — DMSY (Feb 2026); planned v2.0 lane (first public implementation when it ships).
- [Quanta Magazine](https://www.quantamagazine.org/new-method-is-the-fastest-way-to-find-the-best-routes-20250806/) — accessible write-up of the 2025 breakthrough.

## Contributing

Read [`AGENTS.md`](AGENTS.md) for architecture invariants (trace emitters, determinism, single cost table). Correctness work centers on differential fuzzing — start with [`test/dijkstra-fuzz.test.ts`](test/dijkstra-fuzz.test.ts), [`test/bmssp-fuzz.test.ts`](test/bmssp-fuzz.test.ts), and [`test/bmssp-crosscheck.test.ts`](test/bmssp-crosscheck.test.ts).

## Project docs

- Design doc / source of truth: [`docs/design.md`](docs/design.md)
- Build plan: [issues #1–#28](https://github.com/fishygeek91/sorta-fast/issues) · [Roadmap #29](https://github.com/fishygeek91/sorta-fast/issues/29)
- Agent contract: [`AGENTS.md`](AGENTS.md)
