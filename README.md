# Sorta Fast 🏁

[![Sorta Fast photo-finish](docs/assets/hero.gif)](https://fishygeek91.github.io/sorta-fast/?g=city&n=500&seed=1729&mode=race&race=dijkstra,bmssp,dmsy)

This **3-way photo-finish** race clip is from the story city seed (n=500, seed 1729): **Dijkstra wins the photo-finish** — 9,815 comparisons vs BMSSP '25: 14,328 and DMSY '26: 63,250 to the marked target. On the same graph the **settle-all work clock** is Dijkstra 9,830 · BMSSP 17,419 · DMSY 66,866 (Dijkstra still leads). The default live race is sparse 25k seed 4 in the table below — that is where both barrier-breakers win settle-all. See the [wall-clock bench](https://fishygeek91.github.io/sorta-fast/bench/) and [`bench/bmssp-kt-sweep.md`](bench/bmssp-kt-sweep.md).

*Shortest paths that only sorta sort. That's not a joke, that's the algorithm.*

67 years of shortest-path history racing in the browser — Dijkstra (1959) vs BMSSP (STOC 2025) vs DMSY (Feb 2026). This repo is the **first public implementation** of [arXiv 2602.07868](https://arxiv.org/abs/2602.07868); the evidence is differential fuzzing in [`test/dmsy-fuzz.test.ts`](test/dmsy-fuzz.test.ts) against Dijkstra, BMSSP, and Bellman-Ford.

**[Play live →](https://fishygeek91.github.io/sorta-fast/)**

## What this is

Sorta Fast is an in-browser visualization where Dijkstra, BMSSP, and DMSY run on the **same graph** and race to settle every vertex. Each lane emits a trace of operations; the renderer never imports algorithm code — it only replays those traces. Every race is seeded and URL-shareable, so you can reproduce a photo finish exactly.

The headline metric is a **work clock** (total comparisons), not wall-clock milliseconds. That keeps the race honest about what each algorithm *does*, even when a binary heap would finish faster on your laptop at modest graph sizes.

## Try these seeds

| Preset | What to look for |
|---|---|
| [The barrier falls (sparse XL, seed 4)](https://fishygeek91.github.io/sorta-fast/?g=sparse&n=100000&seed=4&mode=race&race=dijkstra,bmssp,dmsy&target=none) | BMSSP and DMSY beat Dijkstra on the settle-all work clock by a visible margin (BMSSP 2,044,058 · DMSY 2,208,892 · Dijkstra 2,413,981; ratios 0.8468 / 0.9150). No photo-finish cap (`target=none`). One-click button in the race gallery. |
| [Default 3-way race (sparse 25k, seed 4)](https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp,dmsy) | Both barrier-breakers beat Dijkstra on settle-all comparisons (BMSSP 495,618 · DMSY 513,213 · Dijkstra 519,411); Dijkstra still wins the photo-finish to the marked target. |
| [Story preset](https://fishygeek91.github.io/sorta-fast/?g=city&n=500&seed=1729) | City layout at n=500 — good for watching wavefronts. |
| [Dijkstra work-clock win (easy)](https://fishygeek91.github.io/sorta-fast/?g=maze&n=500&seed=0) | Maze graph — Dijkstra wins the work clock here. |
| [Paper-k Dijkstra win on the default graph](https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp&bmssp=paper) | Same sparse 25k seed as the default race, but BMSSP uses paper k/t — Dijkstra takes comparisons. |

## Seed challenge

Can you find a seed where **Dijkstra wins the work clock** on the default sparse 25k graph with BMSSP demo k (`k = max(4, paper k)`)? Seeds 0–9 at sparse L / demo k=4 are tabulated in [`bench/bmssp-kt-sweep.md`](bench/bmssp-kt-sweep.md): all BMSSP work-clock wins; the best margin is seed 4. Maze graphs and `&bmssp=paper` already give Dijkstra wins — the hard case is sparse at large n with the in-browser BMSSP demo parameters. The DMSY demo-parameter sweep lives in [`bench/dmsy-kt-sweep.md`](bench/dmsy-kt-sweep.md); demo defaults use `k = max(6, paper k)` with paper `t` ([#54](https://github.com/fishygeek91/sorta-fast/issues/54)).

## Fairness

The race uses a **work clock**: every trace event carries an op cost, and the headline score is **total comparisons**. The same accounting rules apply to every lane. Open the on-site **Fairness** panel for the full rules; the authoritative cost table lives in [`src/core/trace.ts`](https://github.com/fishygeek91/sorta-fast/blob/main/src/core/trace.ts).

At browser scale (roughly 10³–10⁵ nodes), Dijkstra with a binary heap often wins **wall-clock** time even when it loses on comparisons — asymptotics need enormous n, and constants matter. For real timings across graph sizes, see the separate **[bench](https://fishygeek91.github.io/sorta-fast/bench/)** page (wall-clock benchmark, not the race clock).

## Papers and press

- [STOC 2025 (ACM)](https://dl.acm.org/doi/10.1145/3717823.3718179) — deterministic `O(m log^{2/3} n)` BMSSP.
- [arXiv 2504.17033](https://arxiv.org/pdf/2504.17033) — BMSSP preprint (implementation reference).
- [arXiv 2602.07868](https://arxiv.org/abs/2602.07868) — DMSY (Feb 2026); shipped lane and **first public implementation** (see [`test/dmsy-fuzz.test.ts`](test/dmsy-fuzz.test.ts)). Companion write-up: [`docs/blog/implementing-dmsy.md`](docs/blog/implementing-dmsy.md).
- [Quanta Magazine](https://www.quantamagazine.org/new-method-is-the-fastest-way-to-find-the-best-routes-20250806/) — accessible write-up of the 2025 breakthrough.

## Contributing

Read [`AGENTS.md`](AGENTS.md) for architecture invariants (trace emitters, determinism, single cost table). Correctness work centers on differential fuzzing — start with [`test/dijkstra-fuzz.test.ts`](test/dijkstra-fuzz.test.ts), [`test/bmssp-fuzz.test.ts`](test/bmssp-fuzz.test.ts), [`test/bmssp-crosscheck.test.ts`](test/bmssp-crosscheck.test.ts), and [`test/dmsy-fuzz.test.ts`](test/dmsy-fuzz.test.ts).

## Project docs

- Design doc / source of truth: [`docs/design.md`](docs/design.md)
- Build plan: [issues #1–#28](https://github.com/fishygeek91/sorta-fast/issues) · [Roadmap #29](https://github.com/fishygeek91/sorta-fast/issues/29)
- Agent contract: [`AGENTS.md`](AGENTS.md)
