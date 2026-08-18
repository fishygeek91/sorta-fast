# DMSY paper notes — arXiv 2602.07868

Implementation spec for Sorta Fast M6 (issues #23–#28). Companion to [`docs/design.md`](design.md) §2.3, §5, and §8. Primary source: [arXiv 2602.07868 v2](https://ar5iv.labs.arxiv.org/html/2602.07868) (revised 10 Feb 2026). BMSSP 2025 baseline: [arXiv 2504.17033](https://arxiv.org/abs/2504.17033), implemented in `src/core/bmssp/`.

When this document conflicts with the design-doc sketch, **the paper wins** and the conflict is logged in §6. Later M6 PRs that hit a new ambiguity must extend §6 in the same PR (`10-science.mdc`).

## 0. Reading map

| Paper location | This document | Module / issue |
|---|---|---|
| §1, Theorem 1.1 | §1, §7 | context only |
| §2.1 degree reduction | §3.1 | `src/core/dmsy/degreeReduce.ts` (#23) |
| §2.2 comparison-addition | §4 | `src/core/trace.ts` `OP_COST` (existing; do not edit in #22) |
| §2.3 + Algorithm 1 tie-break / Relax | §2, §3.2 | helpers inside `src/core/dmsy/dmsy.ts` (#26) |
| §2.4–2.5 frontier, Observation 2.1 | §3.6 invariants | `dmsy.ts` (#26) debug asserts |
| §3 opening; `k`, `t`, `δ`; Lemma 3.1 | §1 | params helper inside `dmsy.ts` (#26); demo sweep #54 |
| §3.1, Algorithm 2, Lemma 3.2, Remark 3.3 | §3.3 | `src/core/dmsy/forest.ts` (#24) |
| Appendix A.1, Algorithm 5, Lemma A.1 | §3.4 | `forest.ts` (#24) |
| §3.2, Lemma 3.4; Appendix A.2, Lemma A.2 | §3.5 | `src/core/dmsy/partialSort.ts` (#25) |
| §3.3 Algorithm 3; §3.4–3.6 Lemmas 3.6–3.9 | §3.6 | `dmsy.ts` (#26) |
| §3.7 Algorithm 4 | §3.7 | `dmsy.ts` (#26) |

Design §4.1 names only `degreeReduce.ts`, `forest.ts`, `partialSort.ts`, and `dmsy.ts`. Comparison/Addition/Relax helpers are exported from `forest.ts` (#24; DMSY-P22); #26 may re-export. `paperDmsyParams` lives in `src/core/dmsy/dmsy.ts`. Do not invent a required `labels.ts` layout file.

**#54** owns the billed-work `scanCosts` sweep and demo defaults. This document records which paper parameters degenerate at gallery `n ≤ 100000`. Do not copy BMSSP demo `k = max(4, paper k)`.

## 1. Parameters and small-n behavior

All logarithms in this document are **base 2**, matching the comparison-addition convention and [`src/core/bmssp/params.ts`](../src/core/bmssp/params.ts). The design-doc phrase “Θ(√log n)-bounded degree” is **prose shorthand**, not a formula (DMSY-P01).

### 1.1 Paper formulas

**Degree bound δ** ([§2.1](https://ar5iv.labs.arxiv.org/html/2602.07868#S2.SS1)). Preprocessing is defined for any

```
3 ≤ δ ≤ m/n
```

and produces a graph with `O(m)` edges, `O(m/δ)` vertices, and max in- and out-degree `≤ δ`, preserving all shortest-path lengths. The time-optimal choice (Lemma 3.9) is

```
δ = (1/4) · min{ m/n, log log n }
```

**Block parameter t** (Lemma 3.9):

```
t = ⌈ √(log n · log log n / δ) ⌉
```

§3 first says “roughly `t ≈ √(log n)`”; Lemma 3.9 is the precise choice. Do **not** use `t = ⌈log_{δ−1} n⌉` or any other invented formula.

**Pivot size k** (§3, immediately before Lemma 3.1):

```
k = ⌈ t / log t ⌉
```

This is **not** BMSSP 2025’s `k = ⌊(log n)^{1/3}⌋`.

**Recursion level l** (Lemma 3.1):

```
l ∈ [0, ⌈(log n) / t⌉]
```

Top-level call: `S = {s}`, `B = B_∞`, `l = ⌈(log n) / t⌉`.

**Partial-sort block size M** (Lemma 3.1 / Algorithm 3):

```
M = t · 2^{(l − 1) · t}
```

Do **not** use `M = 2^{l · t}`.

**Partition target** (Lemma A.1, used with `s = k` in Algorithm 2): edge-disjoint subtrees of size `[s, 3s)` = `[k, 3k)`.

**Analysis assumption** (§3, footnote 1). The time proof assumes `δ ≤ log k`. Footnote 1: the algorithm remains **correct** when `δ > log k`; the hypothesis only simplifies the time analysis. We call violating it the **footnote-1 relaxation**.

### 1.2 Implementation rules (locked)

| Quantity | Rule | Cite |
|---|---|---|
| δ | If `m/n < 3`: **identity transform** (skip §2.1). Else `δ = clamp(⌊(1/4) · log₂ log₂ n⌋, 3, ⌊m/n⌋)`. | §2.1; DMSY-P03 |
| δ in the `t` formula | When reduction runs, use that clamped δ. When reduction is skipped, still evaluate `t`, `k`, `l`, `M` with **δ = 3** (paper minimum). Actual max degree may then exceed 3, so Lemma 3.9’s time bound does not apply. | Lemma 3.9; DMSY-P03 |
| t | `⌈√(log₂ n · log₂ log₂ n / δ)⌉` | Lemma 3.9 |
| k | If `t < 2`: `k = 1`. Else `⌈t / log₂ t⌉`. | §3; DMSY-P05 |
| n < 2 | `k = t = 1`; skip reduction. | DMSY-P05 |
| l (top) | `⌈log₂ n / t⌉` | Lemma 3.1 |
| M | `t · 2^{(l − 1) · t}` at the current call’s `l` | Lemma 3.1 |
| Partition s | `s = k` | Lemma A.1 |

**Gallery footnote-1 relaxation.** At every gallery `n` below, `⌊(1/4) · log₂ log₂ n⌋ ∈ {0, 1}` so implementation δ is either “skip” or **3**. With `k ∈ {2, 3}`, `log₂ k ≤ 1.58 < 3`, hence **δ > log k**. Correctness still holds (footnote 1). Do not claim the simplified `O((p + |Q|) k log k)` FindPivots bound that assumes `δ ≤ log k` at these sizes (DMSY-P04).

**Representable-n clamp.** `⌊(1/4) · log₂ log₂ n⌋ ≥ 3` needs `n ≥ 2^{2^{12}}`, far beyond IEEE-754 finite range (`Number.MAX_VALUE ≈ 2^{1024}`). For every finite JS `n` where reduction runs, the min-clamp fires and **implementation δ is 3**. Demo δ never varies; do not look for a size where the formula yields 4.

**#54** chooses demo defaults from a committed `scanCosts` sweep. Paper formulas stay selectable. Do not copy BMSSP demo `k = 4` (DMSY-P16, DMSY-P17).

### 1.3 Computed gallery table

Values use log₂. “Paper δ” = `(1/4) · min{m/n, log₂ log₂ n}`. Sparse column: `m/n = 2` (reduction skipped). Dense column: `m/n ≥ log₂ log₂ n` (reduction runs with impl δ = 3). Both columns share `t`, `k`, `l`, `M` because both use δ = 3 in Lemma 3.9 at these sizes.

| n | log₂ n | log₂ log₂ n | Paper δ (sparse) | Paper δ (dense) | Reduce? (sparse / dense) | Impl δ | t | k | l_top | M |
|---|---|---|---|---|---|---|---|---|---|---|
| 500 | 8.97 | 3.16 | 0.50 | 0.79 | no / yes | — / 3 | 4 | 2 | 3 | 1024 |
| 5000 | 12.29 | 3.62 | 0.50 | 0.90 | no / yes | — / 3 | 4 | 2 | 4 | 16384 |
| 25000 | 14.61 | 3.87 | 0.50 | 0.97 | no / yes | — / 3 | 5 | 3 | 3 | 5120 |
| 100000 | 16.61 | 4.05 | 0.50 | 1.01 | no / yes | — / 3 | 5 | 3 | 4 | 163840 |

`M` at the top call: `t · 2^{(l_top − 1) · t}` (e.g. n = 25000: `5 · 2^{10} = 5120`).

At all four `n`, **paper δ < 3**, so the implementation never uses the paper’s fractional δ. **t ≈ 4–5**, **k ≈ 2–3**, **l_top ≈ 3–4**.

## 2. Tie-breaking specification

DMSY correctness (§2.3–§2.4, Lemma 3.7) requires **exact** lexicographic comparison of distance labels. Dijkstra and BMSSP lanes stay **scalar distance-only**. Only the DMSY lane uses the tuples below.

### 2.1 Distance label

```
d[v] = ⟨length, nEdges, curr, pred⟩
```

- **length** — path weight from the source (`number`; `Infinity` if unreachable).
- **nEdges** — hop count (integer).
- **curr** — `v` itself (`VertexId`).
- **pred** — predecessor on the witnessing path (`VertexId`, or `SENTINEL`).

`SENTINEL = -1` in [`src/core/trace.ts`](../src/core/trace.ts). Vertex `0` is a valid id — **never** encode “missing” as `0` (DMSY-P15).

**Initialization** (§2.3 plus DMSY-P15):

- Source: `d[s] = ⟨0, 0, s, SENTINEL⟩`.
- Uninitialized / unreachable: `d[v] = ⟨Infinity, 0, v, SENTINEL⟩`. Keeping `curr = v` lets two unreachable vertices still compare.
- Top-level bound: `B_∞ = ⟨Infinity, 0, SENTINEL, SENTINEL⟩`.

Do **not** use `⟨∞, ∞, ∞, ∞⟩`.

The upper bound `B` in every bounded call is the **same 4-tuple type**.

### 2.2 Primitive operations (Algorithm 1, §2.3)

**Addition** along edge `(u, v)` with weight `w`:

```
Addition(d[u], w) = ⟨d[u].length + w, d[u].nEdges + 1, v, u⟩
```

**Comparison** — lexicographic order on `⟨length, nEdges, curr, pred⟩`, returning `"<"`, `"="`, or `">"`.

**Relax(u, v, B)** accepts iff

```
Comparison(Addition(d[u], w_uv), d[v]) ∈ {"<", "="}
AND
Comparison(Addition(d[u], w_uv), B) = "<"
```

On accept, `d[v] ← Addition(d[u], w_uv)`. The boolean returned to **algorithm control flow** is paper accept (`Comparison ∈ {"<", "="}`). The trace event’s `improved` field is **only** `Comparison === "<"` (DMSY-P32): an `"="` accept writes the same 4-tuple and is not an improvement. Algorithm 1’s scalar `d[u] + w ≤ d[v]` and `< B` are **shorthand** for these Comparison calls (DMSY-P06). The `≤` vs `d[v]` is required: when `u = d[v].pred` and `d[u]` has improved, `d[v]` must update even if length/nEdges would otherwise look tied (§2.3).

### 2.3 Why four components suffice (§2.3)

The ideal key is the full reverse path `⟨length, hops, v_q, …, v_0⟩`. The paper proves the first four components suffice:

1. Relaxing `(u, v)` when `u ≠ d[v].pred`: `pred` breaks remaining ties.
2. Comparing `d[u]` vs `d[v]` for `u ≠ v`: `curr` breaks ties.
3. `B` participates in the same order.

### 2.4 Worked example: 3-vertex equal-weight diamond

Vertices `{0, 1, 2}`, source `0`. Edges `(0,1)`, `(0,2)`, `(1,2)`, `(2,1)`, all weight `1`. Bound `B = B_∞`.

1. Init: `d[0] = ⟨0, 0, 0, SENTINEL⟩`; `d[1] = d[2] = ⟨Infinity, 0, ·, SENTINEL⟩`.
2. `Relax(0, 1, B)`: Addition `⟨1, 1, 1, 0⟩` accepted; `d[1] = ⟨1, 1, 1, 0⟩`.
3. `Relax(0, 2, B)`: `d[2] = ⟨1, 1, 2, 0⟩`.
4. Compare `d[1]` vs `d[2]`: length and nEdges tie; **curr** `1 < 2`, so `d[1] ≺ d[2]`.
5. `Relax(1, 2, B)`: Addition `⟨2, 2, 2, 1⟩` vs `⟨1, 1, 2, 0⟩` — length 2 > 1, reject.
6. `Relax(2, 1, B)`: Addition `⟨2, 2, 1, 2⟩` vs `⟨1, 1, 1, 0⟩` — reject.

Final lengths `[0, 1, 1]`; predecessors `[SENTINEL, 0, 0]`.

**Pred tie-break (illustrative).** Competing candidates `⟨1, 2, 2, 0⟩` vs `⟨1, 2, 2, 1⟩` tie on length, nEdges, and curr; **pred** `0 < 1` wins.

### 2.5 Lane isolation

Differential tests compare the **length** component (and `Infinity` for unreachable) against Dijkstra, BMSSP, and Bellman-Ford. Tie-breaking is internal to DMSY.

## 3. Pseudocode reconstruction

Comment-ready cite form for later code: `// arXiv 2602.07868 Algorithm 2`.

### 3.1 Degree reduction (§2.1)

**Inputs.** Original CSR digraph `G = (V, E)`, degree bound `δ`.

**Identity gate.** If `m/n < 3` (or `n < 2`), return `G` unchanged with identity maps. Do **not** discard unreachable vertices (DMSY-P09). They stay in the graph with `⟨Infinity, 0, v, SENTINEL⟩` labels; FindPivots skips `∞` sources.

**Frederickson-style split** (§2.1):

1. For each original vertex `v`, replace `v` with a **zero-weight directed cycle** `C_v` of `⌈Δ_v / (δ − 2)⌉` vertices, where `Δ_v` is the number of incident neighbors (incoming or outgoing).
2. For each neighbor `u` of `v`, assign a cycle vertex `x_vu` representing that adjacency. Each cycle vertex represents at most `δ − 2` such slots.
3. For each original edge `(u, v)` with weight `w_uv`, add a directed edge **`x_uv → x_vu` with weight `w_uv`**. Cycle arcs stay weight `0`.

This is **not** “`u → x_uv → x_vu → v` with `w` on the first hop.” The original endpoints are replaced by cycle vertices; the only weighted hop for `(u, v)` is `x_uv → x_vu`.

**Outputs for #23.** Reduced CSR `G'`; maps `splitVertex → original vertex` and `newEdge → original edge | "virtual"` (cycle connectors). After reduction, algorithm internals use **reduced-graph ids**. Un-map **only at the trace boundary** so the renderer never sees reduced topology.

**Invariants.** Shortest-path **lengths** preserved; `|E'| = O(m)`; `|V'| = O(m/δ)`; max in/out-degree `≤ δ`; time `O(m)`.

```
// arXiv 2602.07868 §2.1
```

### 3.2 Relaxation (Algorithm 1)

**Inputs.** Tail `u`, head `v`, bound 4-tuple `B`, weight `w_uv`.

**Steps.**

1. `candidate ← Addition(d[u], w_uv)`.
2. If `Comparison(candidate, d[v]) ∈ {"<", "="}` **and** `Comparison(candidate, B) = "<"`:
   1. `d[v] ← candidate`.
   2. Return true (valid relaxation, §2.3).
3. Return false.

Emit `relax` with `improved` = step 2 succeeded. Completeness: `d[v].length = dis(v)` (§2.4). Always `d[v].length ≥ dis(v)`.

```
// arXiv 2602.07868 Algorithm 1
```

### 3.3 FindPivots — spanning forest (§3.1, Algorithm 2)

**Inputs.** Bound `B`, frontier `S`. Precondition: `⟨∅, S⟩` is a frontier for `Ũ = Ũ(B, S)` (§2.4).

**Outputs.** `{P_j}_{j=1}^{p}`, `Q ⊆ S`, `W ⊆ Ũ`. Internally: directed trees `{F̄_j}`, partitioned `{F_j}`, arborescences `{W_j}`.

**`FindPivots(B, S)`** — Algorithm 2:

1. Initialize empty `{F̄_j}`, `{W_j}`.
2. For each `x ∈ S` in **ascending reduced `VertexId`** (DMSY-P08):
   1. If `x` already belongs to some `F̄_j`, skip (Algorithm 2 line 3).
   2. If `d[x].length = Infinity`, skip (DMSY-P09).
   3. Initialize heap `H ← {⟨x, d[x]⟩}` and subgraph `K ← {x}`.
   4. **Local Dijkstra** while `H` nonempty and `|K| < k`:
      1. `u ← ExtractMin(H)` by Comparison.
      2. For each outgoing `(u, v)`:
         1. If `Relax(u, v, B)` is false, continue.
         2. Add `v` and edge `(u, v)` to `K`. Emit `forest` `grow` on that edge (DMSY-P11).
         3. If `v` already lies in some `F̄_{j'}`: `F̄_{j'} ← F̄_{j'} ∪ K`; break the while-loop; continue to the next `x` (**overlap / merge**).
         4. Else if `v ∈ H`: remove `v`’s old incoming edge from `K`; decrease-key / re-insert with the new label.
         5. Else: insert `v` into `H`.
   5. If `|K| ≥ k`: report `K` as a new directed tree `F̄_j`.
   6. Else: report `K` as a new arborescence `W_j` rooted at `x`.
3. `W ← ∪ W_j`; `Q ←` roots of the `W_j`.
4. Partition each `F̄_j` into edge-disjoint `{F_j}` with `s = k` (§3.4).
5. For `j = 1 … p`:

```
P_j = { x ∈ (S \ Q) ∩ F_j : ∀ j' < j, x ∉ F_{j'} }
```

   (min-`j` for disjointness).
6. Return `{P_j}, Q, W`.

**Heap (DMSY-P07).** Paper Algorithm 2 names a Fibonacci heap for `O(log k)` per extracted vertex (Lemma 3.2, citing [13]). Each local search stops at `|K| ≥ k`, so `|K| ≤ k`. Sorta Fast **reuses the existing binary-heap Dijkstra primitive**. Same `O(log k)` class; Fairness later discloses the constant-factor difference.

**Pivots are selected in Algorithm 3**, not here: `p_j = arg min_{x ∈ P_j} d[x]` under Comparison. Emit `pivot` for each `p_j`. (#24 emits this first `p_j` here; Algorithm 3 re-selects per §3.6.)

**Invariants** (Lemma 3.2, Remark 3.3):

- After FindPivots, `⟨W, ∪_j P_j⟩` is a frontier for `Ũ`.
- `{F_j}` are **edge-disjoint** directed trees; `|F_j| ∈ [k, 3k)` (Lemma A.1).
- `{P_j}` and `Q` are disjoint and union to `S`.
- Each `x ∈ S \ Q` lies in **exactly one** `P_j`.
- `W = ∪ W_j`; `Q` are the roots; `|W| = O(k |Q|)`.
- `∪ F_j` and the arborescences in `W` are **not** necessarily vertex-disjoint (Remark 3.3).
- `p ≤ min{|S|, |Ũ| / k}`.

```
// arXiv 2602.07868 Algorithm 2
// arXiv 2602.07868 Lemma 3.2, Remark 3.3
```

### 3.4 Tree partition (Algorithm 5, Lemma A.1)

**Inputs.** Directed tree `T` (a `F̄_j`); treat edges as undirected for the walk (Appendix A.1). Integer `s = k`.

**`Partition(T)`:**

1. `r ←` root. For determinism: **lex-min `VertexId`** in `T` (DMSY-P08 style).
2. `U ← {r}`.
3. For each child subtree `T'` of `r` (children in **ascending `VertexId`**):
   1. `U ← U ∪ Partition(T')`.
4. If `|U| ≥ s`:
   1. **Report** `U` as a group. Emit `forest` `cut` (DMSY-P11).
   2. `U ← {r}`.
5. Return `U`.

**Driver.** Collect reported groups in DFS order. Merge the leftover returned `U` into the last group, or treat it as the sole group if none were reported (Lemma A.1 proof).

**Invariants** (Lemma A.1): edge-disjoint subtrees; each reported group before the final merge has size `[s, 2s)`; after the optional merge, last group `< 3s`. With `s = k`: **`|F_j| ∈ [k, 3k)`**. Linear time.

FindPivots reported `F̄_j` only when `|K| ≥ k`, so `|T| ≥ s` for those trees.

```
// arXiv 2602.07868 Algorithm 5
// arXiv 2602.07868 Lemma A.1
```

### 3.5 Partial-sorting structure D (Lemma 3.4, §A.2)

**Replaces** arXiv 2504.17033 Lemma 3.3 (`Insert` / `BatchPrepend` / `Pull` in `src/core/bmssp/dstructure.ts`). DMSY drops BatchPrepend and adds **Merge**.

**Parameters.** At most `N` key/value pairs; block size `M = t · 2^{(l − 1) t}`; upper bound `B`. Require `M ≥ log(N / M)`. When `M = 1` (Algorithm 4), `D` is an ordinary BST.

**Geometry (§A.2).** Self-balanced **BST of blocks** of size `Θ(M)`. Blocks hold **disjoint value intervals** and are BST-ordered. Inside a block, pairs live in **unsorted linked lists**. A key→node table supports `O(1)` membership/delete. Track the first (leftmost) BST block for the tiny-`D′` merge path. Initialize with one empty block on `[0, B)`.

This is **not** BMSSP’s linked-list-of-blocks D0/D1 geometry.

**Insert `(key, value)`.** If the key exists, keep the pair with the **smaller value** (Comparison). Delete the old node; insert into the block whose interval contains the new value. Normalize.

**Merge `(D′)`** — `D′` has smaller `M′`. HTML truncates the precondition; **§A.2 is authoritative** (DMSY-P14):

| `|D′|` | Action |
|---|---|
| 0 | No-op. |
| `1 … M − 1` | Restructure `D′` to one block; append to the **first** block of `D`; normalize. |
| `≥ M` | Scan `D′` blocks ascending. On duplicates, keep the smaller value. Batch into groups of size `≥ M/3` (flush remainder at end); insert each batch into `D`. |

Time `O(|D′|)`.

**Pull `() → (S′, B_pull)`.**

1. If `|D| ≤ M`: extract all keys; bound = `B`; empty `D`.
2. Else extract smallest BST blocks until the working set has **at least `M + 1` and at most `2M`** elements.
3. Median-find (Blum et al.) the `(M + 1)`-st element `x`.
4. Output the `M` elements `< x` as `S′`; `B_pull :=` value of `x`.
5. Join elements `> x` into the current smallest remaining block; split if size `> M`.
6. Normalize.

**Normalization (§A.2).** After Insert/Merge: operated block size in `[M/3, M]`. After Pull: `[M/2, 2M/3]`. If `|D| < M/3` total: one block. Oversized → median-split; undersized → join adjacent.

**Amortized costs (Lemma 3.4).** Insert `O(log(N/M))`; Merge `O(|D′|)`; Pull `O(|S′|)`.

**Implementation billing (#25).** Insert/Merge bill interval search and duplicate Comparison only; Pull bills Hoare select on the packed leftmost prefix (working set in `[M+1, 2M]` when packing holds), not a store-wide sort. Split/join/repack is unbilled maintenance (DMSY-P26).

**Trace schema (DMSY-P10).** Schema landed in #25: `dstruct.op = "merge"`. Emitters pass `cmps`; `costOf` uses `OP_COST.comparison`.

```
// arXiv 2602.07868 Lemma 3.4
// arXiv 2602.07868 Lemma A.2
```

### 3.6 BMSSP recursion (Algorithm 3)

ar5iv HTML line numbers for Algorithm 3 are garbled (DMSY-P13). Reconstruct from the **§3.3 prose**.

**Signature.** `BMSSP(B, S, l) → (B′, U, D)`.

| | |
|---|---|
| Input | Bound `B` (4-tuple); `S` with `|S| ≤ t² · 2^{l t}`; layer `l ∈ [0, ⌈(log n)/t⌉]` |
| Precondition | `⟨∅, S⟩` is a frontier for `Ũ = Ũ(B, S)` |
| Output | `B′ ≤ B`; complete `U ⊆ Ũ` with `|U| = O(t³ · 2^{l t})`; `D` parameterized by `M = t · 2^{(l − 1) t}` |

**Full vs partial** (Lemma 3.1) — this is **not** “`|S| > k`”:

| Mode | Stop | Outcome |
|---|---|---|
| **Full** | `D` becomes empty | `B′ = B`, `D = ∅`, `U = Ũ` |
| **Partial** | `|U| > t³ · 2^{l t}` | `B′ < B`, `|U| = Θ(t³ · 2^{l t})` |

Top-level call is always full because `|U| ≤ |V|`.

**Steps** (§3.3 prose):

0. If `l = 0`, run Algorithm 4 and return.
1. Initialize `D` with `M = t · 2^{(l − 1) t}` and bound `B`.
2. `{P_j}, Q, W ← FindPivots(B, S)`.
3. For each `j`: `p_j ← arg min_{x ∈ P_j} d[x]`; `D.Insert(⟨p_j, d[p_j]⟩)`. Emit `pivot`.
4. `B′ ← B′_0 := d_B[{p_j}]` (min of `B` and the pivot labels). `U ← ∅`; `i ← 1`; `J ← ∅`.
5. While `|U| ≤ t³ · 2^{l t}` and `D` is nonempty:
   1. `(S_i, B_i) ← D.Pull()`.
   2. For each `x ∈ S_i`: if `x = p_j` for some `j`, `S_i ← S_i ∪ {v ∈ P_j : Comparison(d[v], B_i) = "<"}`.
   3. `(B′_i, U_i, D_i) ← BMSSP(B_i, S_i, l − 1)`.
   4. `D.Merge(D_i)`.
   5. For each `u ∈ U_i`: if `u ∈ P_j`, remove `u` from `P_j`; if `u = p_j` and `P_j ≠ ∅`, add `j` to `J`.
   6. For each `u ∈ U_i` and edge `(u, v)`: if `Relax(u, v, B)` is valid **and** `Comparison(Addition(d[u], w_uv), B_i) ∈ {"=", ">"}` (paper shorthand: `d[u] + w ∈ [B_i, B)`), then `D.Insert(⟨v, d[v]⟩)`. If `v ∈ P_j`, `j ∉ J`, and `Comparison(d[v], d[p_j]) = "<"`, set `p_j ← v`.
   7. For each `j ∈ J`: `p_j ← arg min_{x ∈ P_j} d[x]`; `D.Insert(⟨p_j, d[p_j]⟩)`.
   8. `B′ ← B′_i`; `U ← U ∪ U_i`; `i ← i + 1`; `J ← ∅`.
6. Finalize:
   1. For each `x ∈ S` with `d[x] ∈ [B′, B)` (Comparison), `D.Insert(⟨x, d[x]⟩)`.
   2. `W′ := {x ∈ W \ U : Comparison(d[x], B′) = "<"}`. For each `u ∈ W′` and edge `(u, v)`: if `Relax(u, v, B)` is valid and `Addition(d[u], w) ≥ B′`, `D.Insert(⟨v, d[v]⟩)`.
   3. `U ← U ∪ W′`. Return `(B′, U, D)`.

**`P̂_j` is proof-only** (footnote 2 / §3.5). Never compute it (DMSY-P12). Maintain `p_j` as in steps 5.6–5.7.

**Postconditions** (Lemma 3.1, Lemma 3.7): `U = Ũ(B′, S)` is complete; `⟨U, D⟩` is a frontier for `Ũ`.

```
// arXiv 2602.07868 Algorithm 3
// arXiv 2602.07868 Lemma 3.1, Lemma 3.7
```

### 3.7 Base case (Algorithm 4)

Invoked when `l = 0`. `M = 1` (ordinary BST).

1. Insert every `x ∈ S` as `⟨x, d[x]⟩` into `D`.
2. `U ← ∅`.
3. While `D` is nonempty **and** `|U| ≤ t³`:
   1. `(u, B′) ← D.Pull()` (one key).
   2. `U ← U ∪ {u}` (`u` is complete). Emit `settle`.
   3. For each outgoing `(u, v)`: if `Relax(u, v, B)` is valid, `D.Insert(⟨v, d[v]⟩)` (keep smaller on duplicate).
4. Return `(B′, U, D)`.

Paper notes `|D| ≤ t³ δ ≤ t⁴`; each BST op `O(log t)`. Partial base case (`|U| > t³`) returns a nonempty `D` to the parent, which Merges it.

```
// arXiv 2602.07868 Algorithm 4
```

## 4. Trace instrumentation contract

Algorithms emit `TraceEvent`s only. The renderer never imports algorithm code. Every billed cost comes from `OP_COST` in [`src/core/trace.ts`](../src/core/trace.ts). Emitters pass `cmps`; they do not multiply by `OP_COST.comparison` themselves.

| Kind | When | Cost |
|---|---|---|
| `relax` | Every Algorithm 1 test; `improved` iff the 4-tuple strictly decreased (`Comparison === "<"`), not paper accept (`"="` is a no-op write) | `OP_COST.relax` (1), improved or not |
| `settle` | Vertex committed complete into `U` | `OP_COST.settle` (1) |
| `heap` | Binary-heap ops in FindPivots local Dijkstra (**Algorithm 2 only**) | `cmps × OP_COST.comparison` |
| `pivot` | Each `p_j` first inserted, and each full re-selection | `OP_COST.pivot` (0) |
| `batch` | Optional: FindPivots scan; each Pull-round | `OP_COST.batch` (0) |
| `recurse` | `BMSSP` entry (`"in"`) and return (`"out"`) | `OP_COST.recurse` (0) |
| `forest` | `grow`: edge added to `K` (Alg. 2). `cut`: Partition reports a group (Alg. 5) | `OP_COST.forest` (0) |
| `dstruct` | `Insert` / `Merge` / `Pull` | `cmps × OP_COST.comparison` |

`pivot` / `batch` / `recurse` / `forest` are zero-cost so BMSSP/DMSY are not billed for structure Dijkstra does not emit.

**Not traced:** `P̂_j`, partition DFS internals, degree-reduction build, map lookups.

**Algorithm 4** uses `PartialSortD` with `M = 1` (`dstruct` insert/pull only), not `heap` (DMSY-P28).

**Merge:** uses `dstruct.op = "merge"` (#25 / DMSY-P10).

Unreachable vertices never `settle`. Their predecessors stay `SENTINEL`. Trace audit re-derives **lengths** from `relax` events with the same Comparison / Relax rules.

## 5. Correctness obligations

Specified here; implemented in #23–#26. All fuzz uses seeded mulberry32 and **must include weight ties**.

### 5.1 #23 — `degreeReduce.ts`

- Dijkstra lengths on the original graph equal mapped-back lengths on the reduced graph (fuzz: vary `n`, `m`, weights, ties).
- When reduction runs: max in- and out-degree `≤ δ`.
- When `m/n < 3`: identity (same vertex/edge ids).
- Mapping tables are total on the transformed structure; un-map round-trips original vertices.
- No `forest` / `dstruct` events from preprocessing.

### 5.2 #24 — `forest.ts`

- `{F_j}` pairwise edge-disjoint.
- Each reported subtree size in `[k, 3k)` (Lemma A.1).
- Every `x ∈ S \ Q` in exactly one `P_j`.
- `p_j` is the Comparison-minimum of `P_j`.
- After FindPivots, `⟨W, ∪ P_j⟩` is a frontier (debug hook).
- Golden `forest` grow/cut fixtures; replay rebuilds `{F_j}` / `{P_j}`.
- `S` scanned in ascending `VertexId`; traces byte-identical on rerun.

### 5.3 #25 — `partialSort.ts`

- `Pull` key set matches a naive sort-by-Comparison reference.
- After pivots, about `|S| / k` keys live in the sorted region (Lemma 3.4 intent / issue AC).
- Empirical `cmps` consistent with Lemma 3.4 amortized bounds on fuzz + adversarial sequences.
- `Merge` matches §A.2 (empty / `|D′| < M` / `|D′| ≥ M`); smaller value kept on duplicates.
- Once the schema lands: every Insert / Pull / Merge emits `dstruct` with honest `cmps`.

The structure methods return `{n, cmps}`; tests and #26 wrap them as `dstruct` events (the class is not a generator).

### 5.4 #26 — `dmsy.ts`

- Differential lengths vs Dijkstra, BMSSP, and Bellman-Ford on **10 000** seeded graphs including ties (CI).
- Never `settle` a vertex with `Comparison(d[v], B) ∈ {"=", ">"}` inside a bounded call.
- Dedicated 4-tuple invariant checker.
- Unreachable stay `⟨Infinity, 0, v, SENTINEL⟩`.
- Golden traces on hand-verified small graphs.
- Trace audit: replay events → length array equals the algorithm’s output.
- Update this file’s §6 if implementation surfaces new ambiguities.

## 6. Ambiguity log

Extend this table in the same PR when a new gap appears. Do not decide silently.

| ID | Paper location | Question | Decision | Rationale / cite |
|---|---|---|---|---|
| DMSY-P01 | §3; design.md §2.3 | Design writes “Θ(√log n)” degree bound | Follow the paper: `δ = (1/4)·min{m/n, log log n}` with the §2.1 interval and the clamp in §1.2 | Lemma 3.9; §2.1 |
| DMSY-P02 | §2.2; `bmssp/params.ts` | Log base | **log₂** | Comparison-addition; shipped BMSSP |
| DMSY-P03 | §2.1 | When `m/n < 3` | **Identity** reduction; still evaluate `t,k,l,M` with δ = 3 | `3 ≤ δ ≤ m/n` is empty |
| DMSY-P04 | §3 footnote 1 | Gallery δ = 3 violates `δ ≤ log k` | Run anyway (**footnote-1 relaxation**); do not claim the simplified time bound | Footnote 1: correctness holds |
| DMSY-P05 | §3 (`k = ⌈t/log t⌉`) | `t < 2` or `n < 2` | `t < 2 → k = 1`; `n < 2 → k = t = 1`, skip reduction | Avoid `log t ≤ 0` |
| DMSY-P06 | §2.3; Algorithm 1 | Scalar `+` / `≤` / `<` in pseudocode | All tests are **Comparison** on 4-tuples, including Alg. 3 windows | §2.3; Algorithm 1 lines 6–9 |
| DMSY-P07 | §3.1; Algorithm 2 | Fibonacci heap vs browser | **Binary heap**; `|K| ≤ k` keeps `O(log k)` | Lemma 3.2 proof; existing Dijkstra primitive |
| DMSY-P08 | Algorithm 2 | Order of `forall x ∈ S` | **Ascending `VertexId`** | Determinism (`AGENTS.md`) |
| DMSY-P09 | §2 opening | Paper assumes all vertices reachable | Keep unreachable at `⟨∞, 0, v, SENTINEL⟩`; skip `∞` FindPivots sources; **no discard** | Matches Dijkstra/BMSSP lanes |
| DMSY-P10 | Lemma 3.4; `trace.ts` | `Merge` not in `DSTRUCT_OP` | #25 added `DSTRUCT_OP.merge = 3` (append-only; insert/batchPrepend/pull codes unchanged). Billing remains `cmps × OP_COST.comparison`. | Avoid a half-schema |
| DMSY-P11 | §3.1; Appendix A.1 | `forest` semantics | **`grow`** = edge added to `K`; **`cut`** = Partition reports a group | design.md §4.2; #24 / #27 |
| DMSY-P12 | §3.5; Lemma 3.7 | Implement `P̂_j`? | **Proof-only**; maintain `p_j` per Alg. 3 | Footnote 2 |
| DMSY-P13 | §3.3 HTML | Garbled Algorithm 3 line refs | Reconstruct from **§3.3 prose** | ar5iv artifact |
| DMSY-P14 | Lemma 3.4 HTML | Truncated `Merge` / `M′` | Use **Appendix A.2** | HTML cuts at `M′(` |
| DMSY-P15 | §2.3; `trace.ts` | Encode `∞` / missing pred | `SENTINEL = -1`; source pred `SENTINEL`; `B_∞ = ⟨∞, 0, SENTINEL, SENTINEL⟩` | Vertex 0 is a real id |
| DMSY-P16 | issue #54 | Demo vs paper params | **#54** owns the sweep; `paperDmsyParams` stays selectable | Parallel to BMSSP #52 |
| DMSY-P17 | `demoBmsspParams` | Copy `k = 4` floor? | **No** | Different `k` formula; #54 decides |
| DMSY-P18 | §2.1 | Δ_v=0 or \|C_v\|=1 | Δ_v=0 → one vertex, no cycle edges (DMSY-P09). \|C_v\|=1 → omit the self-loop (`packCsr` rejects self-loops); degrees still ≤ δ−2 < δ. | packCsr; §2.1; DMSY-P09 |
| DMSY-P19 | §2.1 | Neighbor/id/coord order | Neighbors of v sorted by ascending id; slot k → cycle vertex floor(k/(δ−2)); reduced ids allocated v-major then cycle-index; split-copy (x,y) copy the original vertex. | Determinism (AGENTS.md); packCsr coords |
| DMSY-P20 | §2.1; design §4.2 | How to un-map traces | Drop VIRTUAL_EDGE (cycle) relax/forest. First settle per original vertex wins; first pivot per original vertex wins (separate seen-sets). Pass through heap/batch/recurse/dstruct. Helpers only in degreeReduce.ts; harness/render unchanged. | Renderer sees original IDs; #26 wires the boundary |
| DMSY-P21 | §2.1; `trace.ts` relax | Un-mapped `improved` flags | `createTraceUnmapper` preserves the reduced-graph `improved` bit. Two original edges can improve two different copies of `v` on G′; last-write replay on G is then wrong. Callers that replay on the original CSR (`TraceBuffer`, `auditDistancesFromTrace`) must recompute improvement. #26 does this at the emission boundary. | TraceBuffer last-write on `improved===1`; #23 tests rewrite in-test |
| DMSY-P22 | §2.3; Algorithm 1; design §4.1 | Where do Comparison/Addition/Relax helpers live? | Exported from `src/core/dmsy/forest.ts` (#24). #26 may re-export. Do **not** add `labels.ts`. | #24 needs Algorithm 1 to run Algorithm 2; paper-notes forbade inventing a required `labels.ts` |
| DMSY-P23 | §3.1 Algorithm 2 | Decrease-key vs browser heap | Binary heap with **lazy re-push**. If `v` already in `K`, replace the incoming tree edge, emit a corrective `forest` `grow`, and re-push; do not increase `\|K\|`. Replay uses **last grow per head vertex** within a search. | DMSY-P07; Dijkstra primitive; no Fibonacci decrease-key |
| DMSY-P24 | §3.1; Appendix A.1; design §4.2 | How do `cut` events encode `{F_j}`? | One `forest` `cut` per tree-edge assigned to an `F_j` (`cut.tree` = `F_j` index). Replay groups cuts by `tree`. Edgeless singleton `F_j` (`k=1`) emits **no** `cut` (`e` must stay a real CSR id for the #23 unmapper). `grow.tree` is the **local-search id only** — after an overlap merge one `F̄` may span several `grow.tree` ids; `F̄`/`F_j` identity comes from `cut` events. `W_j` tree edges replay as last-grow-per-head (DMSY-P23). | Issue #24 audit AC; `createTraceUnmapper` rejects `e < 0` |
| DMSY-P25 | Appendix A.1; Lemma A.1 | When to test `\|U\| >= s`? | After **each** child (inside the child loop), then leftover-merge. Reported groups stay in `[s, 2s)` before merge; last group `< 3s`. | §3.4 prose put the test after the loop; that overshoots `2s` on high-degree nodes. Lemma A.1 bound requires the per-child test. |
| DMSY-P26 | Lemma 3.4; §A.2 | Initial interval `[0, B)` and whether Merge consumes D′ | Left endpoint is `ZERO_LABEL = ⟨0, 0, SENTINEL, SENTINEL⟩` in `partialSort.ts`. `merge(other)` always consumes `other` (reset to one empty `[ZERO, B)` block). Incoming pairs are placed by interval search (`putPair`); when D′ holds leftover keys below the last Pull bound this lands on the leftmost blocks (the paper append-to-first path). `putPair` interval search bills O(\|D′\| · log #blocks)—one log factor above Lemma A.2's O(\|D′\|); accepted for placement correctness on unsorted intra-block lists; fuzz slack covers it. Pull bills Hoare select on that packed prefix (Lemma 3.4 O(\|S′\|)), not a store-wide sort. | §A.2; determinism; #25 |
| DMSY-P27 | §1.2; Lemma 3.9 | `t` formula underflows at `n = 2` (`log₂ log₂ n = 0`) | `t = max(1, ⌈√(log₂ n · log₂ log₂ n / δ)⌉)`; `n < 2` still `{k: 1, t: 1}` | Avoid `t = 0` / `M = 0` |
| DMSY-P28 | §3.7 vs §4 | Does Algorithm 4 use a binary heap? | **No.** Algorithm 4 is `PartialSortD(M = 1)` + settle/relax/`dstruct`. Heap events only from Algorithm 2. | §3.7 is authoritative; §4 table was leftover BMSSP wording |
| DMSY-P29 | Lemma A.2 Merge | `t = 1` makes parent and child both `M = 1` so `other.M ≥ this.M` | Do not call `PartialSortD.merge`. Absorb leftover child keys via billed `insert` and emit one `dstruct.merge` with summed `n`/`cmps`. | Lemma A.2 assumes `M′ < M`; gallery-small `n` can have `t = 1` |
| DMSY-P30 | Observation 3.5 | Throw if an edge is scanned or insert-banded twice in Algorithm 3? | **No runtime abort.** Parent and child both scan `U_i` edges; nested insert-band uses can both fire as labels move. Observation 3.5 is an analysis bound, not an implementation trap. | Analysis fact vs loop structure |
| DMSY-P31 | §3.3 finalize / Lemma 3.7 | W′ relax landing strictly below B′ | Union that vertex into U and settle it (completeness). Insert into D only when Addition ≥ B′ (paper-notes §3.6.6.2). W′ `<B′` settles bypass `uCount`, so `\|U\|` may exceed the Lemma 3.1/3.8 workload cap by at most `δ · \|W′\|` (gallery `δ = 3`). | Hole would leave a vertex complete-below-B′ out of U and D |
| DMSY-P32 | §2.3 Algorithm 1; §2.4; Lemma 3.7; issue #92 | Post-settle `improved: true` on instrumented traces | **Not a completeness violation.** Hunt (gallery+dense, paper and forced {2,2}) found only equal-label no-ops from Relax accepting `"="` (mostly Alg. 3 step 5.6 re-scans). Trace `improved` = strict 4-tuple `<`. Paper accept still includes `"="`. Public `run()` already recomputes scalar improvement (DMSY-P21). | #92 |

## 7. Lemma and cost-bound sanity checklist

| Result | Actual statement | Notes chapter | Implementation |
|---|---|---|---|
| **Theorem 1.1** | Directed SSSP in `O(m √log n + √(mn log n log log n))` | §1 | #26 top-level `BMSSP(B_∞, {s}, l_top)` after #23 |
| **Observation 2.1** | Frontier `⟨X, Y⟩` persists; min label in `Y` is complete; subset relations | §3.6 | #26 debug asserts — **not** a degree-reduction lemma |
| **Lemma 3.1** | `BMSSP(B, S, l)` interface; `|U| = O(t³ 2^{l t})`; full vs partial; `M = t 2^{(l−1)t}` | §1, §3.6 | #26 |
| **Lemma 3.2** | FindPivots returns frontier `⟨W, ∪ P_j⟩`; time `O((p+\|Q\|) k log k)` under `δ ≤ log k` | §3.3 | #24; gallery uses footnote-1 relaxation |
| **Remark 3.3** | `{F_j}` edge-disjoint; `{P_j} ∪ Q = S`; `p ≤ min{\|S\|, \|Ũ\|/k}`; `W` and `∪ F_j` need not be vertex-disjoint | §3.3 | #24 invariants |
| **Lemma 3.4** | `D` supports Insert, Merge, Pull with stated amortized bounds | §3.5 | #25 |
| **Observation 3.5** | Each edge enters Algorithm 3 at most once globally | §3.6 | #26 debug counter |
| **Lemma 3.6** | Frontier split: pulling a prefix of the frontier yields a frontier for the pulled subset | §3.6 | #26 before the recursive call |
| **Lemma 3.7** | After Alg. 3: `⟨U, D⟩` is a frontier; `U = Ũ(B′, S)` is complete | §3.6 | #26 |
| **Lemma 3.8** | `|U| = O(t³ 2^{l t})`; partial ⇒ `Θ(t³ 2^{l t})` | §3.6 | #26 cap |
| **Lemma 3.9** | Per-call `O(\|U\|(l log t + δ t))`; global `O(m(t + (log n log t)/(δ t)))`; best `t = ⌈√(log n log log n / δ)⌉`, `δ = (1/4) min{m/n, log log n}` | §1 | #54 / bench; do not invent `t = Θ(log n / log δ)` |
| **Lemma A.1** | Partition into edge-disjoint subtrees of sizes `[s, 3s)` in linear time | §3.4 | #24; each report → `forest` `cut` |
| **Lemma A.2** | Restates Lemma 3.4 with the block-BST proof; authoritative Merge | §3.5 | #25 |

## Appendix A. BMSSP 2025 correspondence

arXiv **2504.17033** is `src/core/bmssp/`. DMSY keeps the bounded-recursion **skeleton** and replaces pivot discovery, `D`, labels, and preprocessing.

| Mechanism | 2025 (shipped) | 2026 (this spec) |
|---|---|---|
| Recursion | `BMSSP(B, S, l)`, `l ∈ [0, ⌈(log n)/t⌉]` | Same shape (Algorithm 3) |
| Full vs partial | `B′ = B` ⇒ empty `D`; else `|U| = Θ(t³ 2^{l t})` | Same (Lemma 3.1) |
| `U` cap | `|U| ≤ t³ 2^{l t}` | Same (Lemma 3.8) |
| Base case | `l = 0` mini-Dijkstra | Algorithm 4; `M = 1`; `|U| ≤ t³` |
| Parameters | `k = ⌊(log n)^{1/3}⌋`, `t = ⌊(log n)^{2/3}⌋` | `k = ⌈t / log t⌉`, `t = ⌈√(log n log log n / δ)⌉` |
| FindPivots | Algorithm 1: `k` Bellman-Ford rounds (`findPivots.ts`) | Algorithm 2: local Dijkstra + forest (`forest.ts`, #24) |
| Structure D | Lemma 3.3: Insert, **BatchPrepend**, Pull | Lemma 3.4: Insert, **Merge**, Pull |
| Preprocessing | none | §2.1 degree reduction (#23) |
| Labels | scalar + `BprimeKey` pairs | 4-tuple (§2) |
| Trace extras | `pivot`, `batch`, `recurse`, `dstruct` | adds `forest` |

Do **not** retrofit forest pivots or degree reduction into the BMSSP lane. Do **not** import `demoBmsspParams`’s `k ≥ 4` floor (DMSY-P17). BMSSP cross-checks stay against Braeniac / alphastrata — BMSSP only.

## Appendix B. References

- Duan, Mao, Shu, Yin (Feb 2026). *A Faster Directed Single-Source Shortest Path Algorithm.* [arXiv:2602.07868](https://arxiv.org/abs/2602.07868) · [v2 HTML](https://ar5iv.labs.arxiv.org/html/2602.07868)
- Duan, Mao, Mao, Shu, Yin (STOC 2025). *Breaking the Sorting Barrier for Directed Single-Source Shortest Paths.* [arXiv:2504.17033](https://arxiv.org/abs/2504.17033)
- Hartnett, K. (Aug 2025). *New Method Is the Fastest Way to Find the Best Routes.* [Quanta Magazine](https://www.quantamagazine.org/new-method-is-the-fastest-way-to-find-the-best-routes-20250806/)
- [Braeniac/bm-sssp](https://github.com/Braeniac/bm-sssp) — BMSSP only
- [danalec/DMMSY-SSSP](https://github.com/danalec/DMMSY-SSSP) — BMSSP-family prior art; **not** a DMSY 2026 oracle
- [alphastrata/fast_sssp](https://github.com/alphastrata/fast_sssp) — BMSSP only
- Internal: `docs/design.md` §2.3 / §4.1 / §4.2 / §5; `src/core/trace.ts`; `src/core/bmssp/*`; issues #22–#26, #54
