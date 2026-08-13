# BMSSP k/t sweep results (issue #52)

Headless parameter sweep comparing BMSSP billed work to Dijkstra on the same seeded gallery graphs. Ratio = BMSSP work / Dijkstra work; values **below 1.0** mean BMSSP used fewer comparison-addition ops on the shared work clock.

## Method

- **Work metric:** comparison-addition billed work from `scanCosts` on drained traces (no `TraceEvent[]` materialization).
- **Dijkstra baseline:** one trace per `(kind, n, seed)`; cached and reused for every `(k, t)` cell on that graph.
- **Source:** vertex `0`.
- **Runner:** `npm run bench:bmssp-kt` (`bench/bmssp-kt-sweep.ts`). Smoke grid: `npm run bench:bmssp-kt -- --quick`.

## Grid skips

| Skip                    | Reason                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **XL** (n = 100k)       | Omitted from sweep (runtime).                                                                 |
| **city at L** (n = 25k) | Bowyer–Watson Delaunay is O(n²) ([#32](https://github.com/fishygeek91/sorta-fast/issues/32)). |

## Coverage (not a full cartesian product)

A full `10 seeds × 4 kinds × 3 sizes × 7 k × 3 t` grid was **not** run. The sweep used **scout-then-confirm**:

| Phase                   | File                                                                   | What ran                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Scout**               | [`bmssp-kt-sweep-scout.tsv`](bmssp-kt-sweep-scout.tsv)                 | maze / sparse / clusters at **S + M**; seeds **0–2**; k ∈ {2, 4, 8, 12, 16, 24, 32}; **paper `t` only** (126 rows). |
| **t variants**          | [`bmssp-kt-sweep-tvariants.tsv`](bmssp-kt-sweep-tvariants.tsv)         | **M = 5000**; seeds 0–2; k ∈ {4, 8, 12, 16}; **`k2` and `twoK`** `t` (plus maze/sparse/clusters).                   |
| **L confirm**           | [`bmssp-kt-sweep-L.tsv`](bmssp-kt-sweep-L.tsv)                         | **n = 25k**; seeds 0–1; k ∈ {4, 8, 16}; paper `t`; sparse + maze + clusters.                                        |
| **Sparse L k=2 vs k=4** | [`bmssp-kt-sweep-sparse-L-k2k4.tsv`](bmssp-kt-sweep-sparse-L-k2k4.tsv) | **sparse n = 25k**; seeds **0–9**; k ∈ {2, 4}; paper `t` (20 rows).                                                 |

city and XL never appear in these runs.

## Findings

1. **Paper k = 2 never beat Dijkstra** on any non-degenerate gallery cell tested (all scout / L / confirm ratios ≥ 1.0). On sparse L, paper k = 2 loses every seed 0–9 (ratios 1.0049–1.0429).
2. **Demo k = 4 + paper `t` wins on sparse L (n = 25k)** for **every seed 0–9** — the only winning configuration in the sweep. Best margin: seed 4, ratio **0.9542**.
3. **Higher k loses on sparse L:** k = 8 ratios 1.0808–1.1152; k = 16 ratios 1.1381–1.1483 (seeds 0–1 in L confirm).
4. **Maze and clusters never won** at any size/k/`t` tested (scout min ratios always ≫ 1).
5. **`k2` / `twoK` get closer but still lose:** at M = 5000, sparse `k2` min ratio ≈ **1.0808**; clusters `k2` min ≈ **1.0187** (~1.02). Both variants force **L = 1** (shallow recursion — pathological for this implementation) and remain above 1.0.

### Scout summary (min ratio by kind / size / k, paper `t`, seeds 0–2)

Degenerate sparse S seed 2 (Dijkstra work = 3) excluded from mins.

| kind     |    n |   k | min ratio |
| -------- | ---: | --: | --------: |
| maze     |  500 |   2 |    3.2025 |
| maze     |  500 |   4 |    3.0955 |
| maze     |  500 |   8 |    3.0206 |
| maze     |  500 |  12 |    2.9840 |
| maze     |  500 |  16 |    2.9333 |
| maze     |  500 |  24 |    2.8868 |
| maze     |  500 |  32 |    2.8613 |
| maze     | 5000 |   2 |    2.8354 |
| maze     | 5000 |   4 |    2.7454 |
| maze     | 5000 |   8 |    2.6885 |
| maze     | 5000 |  12 |    2.6753 |
| maze     | 5000 |  16 |    2.6593 |
| maze     | 5000 |  24 |    2.5882 |
| maze     | 5000 |  32 |    2.5988 |
| sparse   |  500 |   2 |    1.7859 |
| sparse   |  500 |   4 |    1.7252 |
| sparse   |  500 |   8 |    1.9457 |
| sparse   |  500 |  12 |    1.9972 |
| sparse   |  500 |  16 |    1.8941 |
| sparse   |  500 |  24 |    1.6863 |
| sparse   |  500 |  32 |    1.7444 |
| sparse   | 5000 |   2 |    1.4116 |
| sparse   | 5000 |   4 |    1.3034 |
| sparse   | 5000 |   8 |    1.3775 |
| sparse   | 5000 |  12 |    1.4268 |
| sparse   | 5000 |  16 |    1.5030 |
| sparse   | 5000 |  24 |    1.5716 |
| sparse   | 5000 |  32 |    1.6769 |
| clusters |  500 |   2 |    1.7490 |
| clusters |  500 |   4 |    1.6977 |
| clusters |  500 |   8 |    1.6821 |
| clusters |  500 |  12 |    1.6659 |
| clusters |  500 |  16 |    1.6611 |
| clusters |  500 |  24 |    1.7671 |
| clusters |  500 |  32 |    1.7170 |
| clusters | 5000 |   2 |    1.6278 |
| clusters | 5000 |   4 |    1.5625 |
| clusters | 5000 |   8 |    1.5264 |
| clusters | 5000 |  12 |    1.5366 |
| clusters | 5000 |  16 |    1.5682 |
| clusters | 5000 |  24 |    1.5388 |
| clusters | 5000 |  32 |    1.6028 |

No cell in this table is below 1.0.

### Winning cells — sparse L, k = 4, paper `t` (seeds 0–9)

| seed | dijkstraWork | bmsspWork |      ratio |
| ---: | -----------: | --------: | ---------: |
|    0 |       511273 |    504852 |     0.9874 |
|    1 |       517412 |    506841 |     0.9796 |
|    2 |       521388 |    520858 |     0.9990 |
|    3 |       515380 |    504826 |     0.9795 |
|    4 |       519411 |    495618 | **0.9542** |
|    5 |       512045 |    503380 |     0.9831 |
|    6 |       522686 |    515698 |     0.9866 |
|    7 |       519739 |    504138 |     0.9700 |
|    8 |       517269 |    507524 |     0.9812 |
|    9 |       518889 |    514881 |     0.9923 |

Source: [`bmssp-kt-sweep-sparse-L-k2k4.tsv`](bmssp-kt-sweep-sparse-L-k2k4.tsv).

## Locked demo defaults (#52)

- **BMSSP params:** `k = max(4, paper k)`, paper `t` (demo floor raises paper k = 2 → 4).
- **Default race URL:** `?g=sparse&n=25000&seed=4` (best BMSSP margin in the confirm run).

## Raw data

| Artifact                                                                                                          | Description                                    |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [`bmssp-kt-sweep-scout.tsv`](bmssp-kt-sweep-scout.tsv) / [`.md`](bmssp-kt-sweep-scout.md)                         | Scout grid (S+M, seeds 0–2, all k, paper `t`). |
| [`bmssp-kt-sweep-tvariants.tsv`](bmssp-kt-sweep-tvariants.tsv) / [`.md`](bmssp-kt-sweep-tvariants.md)             | M-size `k2` / `twoK` variants.                 |
| [`bmssp-kt-sweep-L.tsv`](bmssp-kt-sweep-L.tsv) / [`.md`](bmssp-kt-sweep-L.md)                                     | L-size k = 4/8/16 confirm (seeds 0–1).         |
| [`bmssp-kt-sweep-sparse-L-k2k4.tsv`](bmssp-kt-sweep-sparse-L-k2k4.tsv) / [`.md`](bmssp-kt-sweep-sparse-L-k2k4.md) | Sparse L k = 2 vs 4, seeds 0–9.                |
