# Implementing the algorithm that broke the sorting barrier (twice)

Sorta Fast now races three shortest-path histories in the browser: Dijkstra (1959), BMSSP (STOC 2025, [arXiv 2504.17033](https://arxiv.org/abs/2504.17033)), and DMSY (Feb 2026, [arXiv 2602.07868](https://arxiv.org/abs/2602.07868)). The third lane is the reason this post exists. As far as we can tell, ours is the **first public implementation** of 2602.07868. There is no reference code, no leaked prototype, no friendly C++ repo to diff against. The paper is the spec; the test suite is the oracle.

That is a strange way to ship an algorithm whose headline theorem is a new sorting-barrier result for directed single-source shortest paths. We did not set out to be pioneers. We set out to animate a race. The pioneer part happened because nobody else had published runnable code yet.

BMSSP 2025 already had a public story: Quanta, Hacker News, a wave of "new algorithm beats Dijkstra" posts — and still almost nothing you could *run*. Sorta Fast filled that gap for 2504.17033 first. When 2602.07868 appeared in February 2026, improving the bound again, the design doc's Round 2 plan was obvious: same harness, same fairness panel, same fuzz discipline, harder science.

The risk posture in `docs/design.md` said lane 3 would stay behind `?lane3=1` until differential tests passed, then flip default-on. We meant it. Shipping a third algorithm without reference code is how you earn "rigged demo" comments. The only defense is reproducible seeds, an open cost table, and a test file strangers can run locally.

## What we had going in

Issue #22 produced [`docs/paper-notes.md`](../paper-notes.md): section-cited pseudocode, a living ambiguity log, and explicit decisions where the HTML rendering disagreed with the PDF prose. Every later M6 PR extended that file instead of deciding silently. That discipline mattered more than any single lemma.

We also had BMSSP already green: differential fuzz, golden traces, trace audit, and a work-clock fairness panel that bills every comparison from one table in `src/core/trace.ts`. DMSY had to meet the same bar and plug into the same harness without contaminating the scalar lanes.

## Reconstructing Algorithm 3 from broken HTML

The ar5iv HTML for Algorithm 3 is garbled — line numbers drift, steps truncate, and cross-references point at the wrong blocks. We logged that as **DMSY-P13** and rebuilt the recursion from **§3.3 prose**, not from the broken listing.

That reconstruction is not a cosmetic choice. Algorithm 3 is the heart of the lane: nested `BMSSP` calls, pivot bookkeeping, partial vs full termination, and a finalize pass that re-inserts frontier vertices the inner loops might have missed. A single mis-ordered step in the while-loop body shows up only under tie-heavy graphs, which scalar-distance fuzz would never catch.

The prose walk in paper-notes became the implementation checklist. When a step said "for each `u ∈ U_i` and edge `(u, v)`" we treated that as a literal obligation, not shorthand for "scan the frontier once." Observation 3.5 is an analysis fact about how often edges enter the recursion globally; it is not a runtime trap that aborts if you scan twice (**DMSY-P30**). The code follows the loops; the proofs bound the work.

Other ambiguities surfaced the same way. Lemma 3.4's Merge precondition is truncated in the HTML listing; **Appendix A.2** is authoritative (**DMSY-P14**). Footnote 2's `P̂_j` sets are proof-only — never computed (**DMSY-P12**). The finalize pass's `W′` relax band must settle vertices that land strictly below `B′` even when the insert band says otherwise (**DMSY-P31**). Each decision went into the ambiguity log with a section cite in the same PR that implemented it. That is slower than guessing, but guessing is how SSSP bugs hide for years.

FindPivots (Algorithm 2) and Partition (Algorithm 5) shipped in #24 as `forest.ts`. Partial-sort `D` shipped in #25. Full recursion in #26. Renderer forest overlays in #27. The blog post is the capstone, not the spec — if you need line-level pseudocode, paper-notes still wins.

## The four-tuple tie-break nobody warned you about

Dijkstra and BMSSP in Sorta Fast compare scalar distances. DMSY cannot. Correctness (§2.3–§2.4, Lemma 3.7) requires lexicographic labels:

```
d[v] = ⟨length, nEdges, curr, pred⟩
```

- **length** — path weight from the source (`Infinity` if unreachable).
- **nEdges** — hop count.
- **curr** — the vertex id `v` itself.
- **pred** — predecessor on the witnessing path, or `SENTINEL`.

`SENTINEL = -1` lives in `src/core/trace.ts`. Vertex `0` is a valid id; we never encode "missing predecessor" as `0` (**DMSY-P15**).

**Relax** accepts when the Addition along `(u, v)` is not worse than the current label and still strictly below the call bound `B`:

```
Comparison(Addition(d[u], w), d[v]) ∈ {"<", "="}
AND
Comparison(Addition(d[u], w), B) = "<"
```

Algorithm control flow treats `"="` as accept — the label may need to refresh when `u` is already `d[v].pred` and `d[u]` moved. The **trace** is stricter: `relax.improved` is true only when `Comparison === "<"` (**DMSY-P32**, issue #92). An equal-label accept writes the same four-tuple and is not an improvement on the event stream.

That split sounds pedantic until you try to replay distances from traces alone. If `improved` lied on `"="` accepts, audit would disagree with the scalar lanes on graphs where hop counts and predecessors matter. The hunt on gallery and dense digraphs found only equal-label no-ops from parent re-scans, not completeness violations — but the instrumentation had to tell the truth anyway.

Consider a tiny diamond: vertices `{0, 1, 2}`, source `0`, all edges weight `1`. After relaxing from the source, `d[1] = ⟨1, 1, 1, 0⟩` and `d[2] = ⟨1, 1, 2, 0⟩`. Length and hop count tie; **curr** breaks the tie (`1 < 2`). A later relax that would lengthen the path is rejected even if the scalar weight looks tempting. Differential fuzz against Dijkstra only checks the **length** component — tie-breaking stays internal to DMSY — but lex order still governs which vertex settles first inside a bounded call, and settling order feeds the recursion.

Unreachable vertices keep `⟨Infinity, 0, v, SENTINEL⟩` with `curr = v` so two unreachable ids still compare deterministically. The source uses `pred = SENTINEL`; top-level bound `B_∞ = ⟨Infinity, 0, SENTINEL, SENTINEL⟩`. Do not use `⟨∞, ∞, ∞, ∞⟩` as a label — the paper's Comparison primitive is defined on four typed fields, not on a scalar overload.

## Gallery size is not paper size

The paper's time-optimal degree bound is

```
δ = (1/4) · min{ m/n, log log n }
```

with preprocessing defined for `3 ≤ δ ≤ m/n`. At every gallery `n ≤ 100 000`, `⌊(1/4) · log₂ log₂ n⌋` is `0` or `1`, never the asymptotic target. The implementation clamps to **δ = 3** when reduction runs, or skips reduction entirely when `m/n < 3` (**DMSY-P03**).

With gallery `k ∈ {2, 3}`, we have `log₂ k ≤ 1.58 < 3`, so **δ > log k**. Footnote 1 of §3 says the algorithm remains correct when `δ > log k`; the hypothesis only simplifies the time proof. We call running in that regime the **footnote-1 relaxation** (**DMSY-P04**).

Correctness still holds. The simplified `O((p + |Q|) k log k)` FindPivots bound that assumes `δ ≤ log k` does **not**. We do not claim Lemma 3.9's per-call or global time bounds at gallery sizes. The demo is an honesty experiment about comparison counts under real constants, not a miniature proof of Theorem 1.1.

When reduction is skipped, we still evaluate `t`, `k`, `l`, and `M` with **δ = 3** in the formulas. Actual max degree on the original CSR may exceed 3. Again: fine for correctness, wrong for quoting the lemma.

Concrete gallery behavior (from paper-notes §1.3): at `n = 500` and `n = 5 000`, `t = 4` and `k = 2`; at `n = 25 000` and `n = 100 000`, `t = 5` and `k = 3`. The paper's `δ = (1/4) min{m/n, log log n}` with base-2 logs does not produce a meaningful reduction target at these sizes — you get skip or clamp-to-3, not a degree shave that matches Lemma 3.9's asymptotic choice. Bench pages and README copy should talk about comparison counts and constants, not whisper that Theorem 1.1 is "visible" at 10⁵ nodes.

## Heaps, lazy re-push, and what Algorithm 4 actually uses

Algorithm 2's local Dijkstra searches name a Fibonacci heap in the paper (Lemma 3.2, citing Fredman–Tarjan). Sorta Fast reuses the existing **binary heap** primitive from the Dijkstra lane (**DMSY-P07**). Each search stops once `|K| ≥ k`, so `|K| ≤ k` and extract-min stays `O(log k)` class. The fairness panel discloses the constant-factor gap; we do not pretend the browser ships Fibonacci heaps.

Decrease-key is the other browser reality. Our heap does not decrease-key. When a vertex already in `K` receives a better tree edge, we **lazy re-push**: replace the incoming edge, emit a corrective `forest` grow, and push again without growing `|K|` (**DMSY-P23**). Replay uses the last grow per head vertex within a search.

Algorithm 4 — the `l = 0` base case — does **not** use a heap at all. It runs `PartialSortD` with **M = 1**: insert, pull, settle, relax, and billed `dstruct` events only (**DMSY-P28**). Heap trace events come from Algorithm 2 alone. Confusing §4's leftover BMSSP wording with §3.7's base case is an easy way to double-bill comparisons in the animation.

FindPivots scans `S` in ascending `VertexId` order (**DMSY-P08**) and skips sources whose label length is `Infinity` (**DMSY-P09**). Each local search emits `heap` events with `cmps` billed from the shared `OP_COST.comparison` table — emitters pass raw comparison counts; they never multiply costs themselves. `pivot`, `batch`, `recurse`, and `forest` are zero-cost so structure Dijkstra does not pay for bookkeeping the scalar lane never emits.

## Partition: where Lemma A.1 meets the code

FindPivots grows local trees, then **Partition** splits each tree into edge-disjoint subtrees of sizes in `[s, 3s)` with `s = k` (Lemma A.1, Algorithm 5). The §3.4 prose places the `|U| ≥ s` test after the child loop; that overshoots `2s` on high-degree nodes. **DMSY-P25** locks the implementation: test `|U| ≥ s` after **each** child inside the loop, then merge leftovers. Reported groups stay in `[s, 2s)` before merge; the last group is `< 3s`.

Each reported group emits a `forest` cut event. Grow events mark edges added to `K` during the local search. The renderer's moss overlays and patchwork tints (#27) consume those events without importing algorithm code — the same trace contract as the other lanes.

Overlap merges in FindPivots can make one physical tree span several local-search ids; `grow.tree` is only the search id, while `cut` events carry the partition's `F_j` index (**DMSY-P24**). Replay groups cuts by tree index. Edgeless singleton partitions at `k = 1` emit no cut — the trace schema requires real CSR edge ids for the unmapper.

After pivots, about `|S| / k` keys should live in the sorted region of `D` (Lemma 3.4 intent). Fuzz and adversarial Pull sequences check that `cmps` stay consistent with the amortized bounds, not just that distances match.

## Demo parameters are not BMSSP parameters

Issue **#54** owns the billed-work `scanCosts` sweep and whatever becomes the default race preset. **`paperDmsyParams`** — the paper's `δ`, `t`, `k`, `l`, and `M` formulas — stays selectable in the UI (**DMSY-P16**).

We did **not** copy BMSSP's demo trick `k = max(4, paper k)` (**DMSY-P17**). DMSY's `k` is `⌈t / log₂ t⌉`, not `⌊(log n)^{1/3}⌋`. The formulas differ; the demo floors differ. Paper formulas remain the documented defaults; the sweep chooses what actually looks fair on a work clock at browser scale.

## Partial-sort D and Merge from Appendix A.2

Lemma 3.4's structure `D` — Insert, Merge, Pull on block-BST intervals — landed in `partialSort.ts` (#25). HTML truncates the Merge precondition; **Appendix A.2** is authoritative (**DMSY-P14**). Billing compares labels honestly: Insert and Merge charge interval search; Pull charges Hoare select on the packed prefix, not a full-store sort (**DMSY-P26**).

When gallery `t = 1`, parent and child can both have `M = 1`, violating Lemma A.2's `M′ < M` assumption. We absorb leftover child keys with billed inserts instead of calling `merge` on equal-sized structures (**DMSY-P29**).

`Merge` landed in the trace schema as `dstruct.op = "merge"` (#25, **DMSY-P10**) so the animation can show structure work without inventing a half-schema. Billing remains `cmps × OP_COST.comparison`. Split, join, and repack inside the block BST are unbilled maintenance — the science code counts only Comparison calls the paper charges.

## Degree reduction and the trace boundary

§2.1 Frederickson-style splitting replaces high-degree vertices with zero-weight cycles and routes original edges through cycle slots. When `m/n < 3`, we return the graph unchanged (**DMSY-P09**): unreachable vertices stay at `⟨Infinity, 0, v, SENTINEL⟩`, never discarded.

Internals run on reduced ids. The renderer sees original ids. Un-mapping happens **only at the trace emission boundary** (**DMSY-P20**, **DMSY-P21**): drop virtual cycle edges, preserve `improved` bits correctly, and let audit recompute strict improvement on the original CSR.

Cycle copies of one original vertex share scalar length but differ in hop count and predecessor on the reduced graph. Public `run()` projects back the lex-min reduced copy, not a naive min-length pick. Two original edges can improve two different copies of `v` on `G′`; last-write replay on `G` without recomputing `improved` was wrong until #26 fixed the emission boundary.

Neighbors in the split construction are sorted by ascending id; reduced ids are allocated deterministically (**DMSY-P19**). Self-loops are omitted (`packCsr` rejects them); degrees still stay below δ when reduction runs. The design-doc phrase "Θ(√log n)-bounded degree" is prose shorthand for the §2.1 interval — the implementation follows the paper's `δ` formula and clamp, not the slogan (**DMSY-P01**).

## What we ship as evidence

The correctness battery is the product:

- [`test/dmsy-fuzz.test.ts`](../../test/dmsy-fuzz.test.ts) — **dmsy-fuzz**: 10 000 seeded graphs (plus dense integer-weight digraphs for lex-predecessor ties) against Dijkstra, BMSSP, and Bellman-Ford; bounded-settle invariants; lex tie-break checks; trace audit re-deriving lengths from events alone.
- [`docs/paper-notes.md`](../paper-notes.md) — **paper-notes**: pseudocode, gallery degeneracy tables, trace instrumentation contract, and the ambiguity log (DMSY-P01 through DMSY-P32) with section cites.

Golden traces on hand-verified small graphs catch instrumentation regressions that distance-only fuzz would miss. Debug hooks assert frontier laws from Observation 2.1 and cap workload from Lemmas 3.1 and 3.8. None of that ships to the animation thread; it ships to CI so we can claim a first implementation without bluffing.

The fuzz decorrelates graph kind from `n` so every generator sees sizes in a healthy band. Dense integer-weight digraphs (weights in `{1, 2}`, `p ≈ 0.4`) stress lex predecessors — scalar ties are not enough. Instrumented regression for settle-finality and lex tie-break lives beside the public lane tests; issue #92 narrowed `improved` semantics without changing distances.

Bounded-call settle rules are strict: never settle a vertex with `Comparison(d[v], B) ∈ {"=", ">"}` inside a call bounded by `B`. That invariant is what Lemma 3.7's completeness story actually buys you in code, not just on paper.

We also never settle unreachable vertices. Their labels stay at infinity; their predecessors stay `SENTINEL`. Trace audit replays `relax` events with the same Comparison and Relax rules the emitter used, then checks the length array against public `run()`. If audit passes and fuzz passes, the animation is allowed to lie about nothing except wall-clock milliseconds — and the fairness panel says so out loud.

## Closing

Implementing 2602.07868 without reference code is less about heroics than about paperwork: log every ambiguity, cite the lemma next to the line, fuzz with ties, and replay the trace. The sorting barrier moved twice in the theory literature; in the browser the barrier is still comparisons on a shared work clock.

If you want the full decision log — garbled HTML, footnote-1 relaxation, lazy heap re-push, partition child tests, and the `improved` bit — start with paper-notes. If you want to break the implementation, start with dmsy-fuzz. That is the oracle we trusted when there was nothing else to trust.

## Appendix: how this maps to the repo

For readers who clone the tree, the lane is modular on purpose:

| Paper piece | Module | Issue |
|---|---|---|
| §2.1 degree reduction | `src/core/dmsy/degreeReduce.ts` | #23 |
| Algorithm 2 + Partition | `src/core/dmsy/forest.ts` | #24 |
| Lemma 3.4 structure `D` | `src/core/dmsy/partialSort.ts` | #25 |
| Algorithms 3–4 recursion | `src/core/dmsy/dmsy.ts` | #26 |
| Forest overlays + 3-way race | `src/render/`, `src/ui/` | #27 |

Algorithms emit `TraceEvent`s only. The renderer never imports `dmsy.ts`. Every billed comparison comes from `OP_COST` in `src/core/trace.ts`. Same seed → byte-identical trace — mulberry32 PRNG, stable iteration order, no `Math.random()` in the science path.

The companion README and OG card updates in #28 point here. The science was already done; this post is the human-readable audit trail for a paper with no reference implementation — war stories, not a lemma dump.
