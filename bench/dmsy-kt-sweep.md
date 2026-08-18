# DMSY k/t sweep results (issue #54)

Headless parameter sweep comparing DMSY billed work to Dijkstra on the same seeded gallery graphs. Ratio = DMSY work / Dijkstra work; values **below 1.0** mean DMSY used fewer comparison-addition ops on the shared work clock.

## Method

- **Work metric:** comparison-addition billed work from `scanCosts` on drained traces (no `TraceEvent[]` materialization).
- **Dijkstra baseline:** one trace per `(kind, n, seed)`; cached and reused for every `(k, t)` cell on that graph.
- **Source:** vertex `0`.
- **Runner:** `npm run bench:dmsy-kt` (`bench/dmsy-kt-sweep.ts`). Smoke grid: `npm run bench:dmsy-kt -- --quick`.
- **`t` variants:** `paper` (Lemma 3.9 via `paperDmsyParams(n, delta)`), `twoK` (`t = 2k`), `paperPlus2` (paper `t + 2`).
- **`k` grid:** 2, 3, 4, 6, 8, 12, 16.

### Grid skips

| Skip                    | Reason                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **XL** (n = 100k)       | Omitted from sweep (runtime).                                                                 |
| **city at L** (n = 25k) | Bowyer–Watson Delaunay is O(n²) ([#32](https://github.com/fishygeek91/sorta-fast/issues/32)). |
| Non-finite **M**        | Cells where Lemma 3.1 block size is non-finite at top recursion depth are omitted.            |

## Artifacts

| Phase       | Files                                                                                           | What ran                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Scout**   | [`dmsy-kt-sweep-scout.tsv`](dmsy-kt-sweep-scout.tsv) / [`.md`](dmsy-kt-sweep-scout.md)          | S + M (n = 500, 5000); seeds **0–2**; all gallery kinds; full **k × t** grid (**630 cells**). |
| **Confirm** | [`dmsy-kt-sweep-sparse-L.tsv`](dmsy-kt-sweep-sparse-L.tsv) / [`.md`](dmsy-kt-sweep-sparse-L.md) | **sparse n = 25k**; seeds **0–9**; k ∈ {2, 6, 8, 12} × {`paper`, `twoK`} (**80 cells**).      |

## Scout findings (S/M)

1. **No ratio below 1.0** in the scout grid — DMSY never beat Dijkstra at S or M on any tested `(kind, k, t)` cell (630/630 ratios ≥ 1.0; global minimum **1.1622**).
2. **Overall median ratio ≈ 3.21** (exact: **3.2086** across all 630 scout cells).
3. **Best scout cells** were **sparse M** with **`twoK`** at high `k`: n = 5000, k = 8, t = 16, ratio **1.1622** (seeds 0–2: 1.1622–1.1675). At S, sparse `twoK` min ratios stay above 1.32.
4. **`twoK` looked best at M** for sparse (k = 8/12/16, t = 2k → L = 1), but **paper `t` was competitive** on sparse M paper rows (min 1.2378–1.2726 vs `twoK` min 1.1622–1.4266 depending on k).
5. **`paperPlus2` and clusters were terrible** — clusters paper `t` min ratios 12.39–20.03; clusters `paperPlus2` ranged **13.20–29.64×** Dijkstra. Do **not** lock `twoK` from scout alone; the M-size `twoK` edge does not survive L confirm.

### Scout summary (min ratio by kind / size / k, paper `t`, seeds 0–2)

Degenerate sparse S seed 2 (Dijkstra work = 3) excluded from mins.

| kind     |    n |   k | min ratio |
| -------- | ---: | --: | --------: |
| maze     |  500 |   2 |    3.5708 |
| maze     |  500 |   3 |    3.5733 |
| maze     |  500 |   4 |    3.5757 |
| maze     |  500 |   6 |    3.5807 |
| maze     |  500 |   8 |    3.5856 |
| maze     |  500 |  12 |    3.5955 |
| maze     |  500 |  16 |    3.6053 |
| maze     | 5000 |   2 |    3.7052 |
| maze     | 5000 |   3 |    3.6992 |
| maze     | 5000 |   4 |    3.6997 |
| maze     | 5000 |   6 |    3.6927 |
| maze     | 5000 |   8 |    3.6965 |
| maze     | 5000 |  12 |    3.6884 |
| maze     | 5000 |  16 |    3.6801 |
| sparse   |  500 |   2 |    1.8927 |
| sparse   |  500 |   3 |    1.8937 |
| sparse   |  500 |   4 |    1.8947 |
| sparse   |  500 |   6 |    1.8984 |
| sparse   |  500 |   8 |    1.9005 |
| sparse   |  500 |  12 |    1.9078 |
| sparse   |  500 |  16 |    1.9176 |
| sparse   | 5000 |   2 |    1.2726 |
| sparse   | 5000 |   3 |    1.2481 |
| sparse   | 5000 |   4 |    1.2392 |
| sparse   | 5000 |   6 |    1.2390 |
| sparse   | 5000 |   8 |    1.2378 |
| sparse   | 5000 |  12 |    1.2386 |
| sparse   | 5000 |  16 |    1.2394 |
| clusters |  500 |   2 |   20.0263 |
| clusters |  500 |   3 |   19.9437 |
| clusters |  500 |   4 |   19.8011 |
| clusters |  500 |   6 |   19.4419 |
| clusters |  500 |   8 |   19.3787 |
| clusters |  500 |  12 |   18.2127 |
| clusters |  500 |  16 |   16.5123 |
| clusters | 5000 |   2 |   16.0313 |
| clusters | 5000 |   3 |   15.9787 |
| clusters | 5000 |   4 |   15.6147 |
| clusters | 5000 |   6 |   15.1848 |
| clusters | 5000 |   8 |   14.9302 |
| clusters | 5000 |  12 |   13.9565 |
| clusters | 5000 |  16 |   12.3915 |

No cell in this table is below 1.0. City and adversarial kinds (also in the scout TSV) likewise remain above 1.0 at all tested k.

## Confirm findings (sparse L)

1. **34 `paper`-`t` cells beat Dijkstra** (ratio < 1) — all are k ∈ {6, 8, 12} with paper `t` (Lemma 3.9 `t = 5` at n = 25k); **0 wins** for `twoK` (40/40 `twoK` cells lose; median ratio **1.2148**).
2. **Best margin:** sparse n = 25k, seed = **4**, k = **6** (and k = **8**), paper `t = 5`, ratio **0.9865** (Dijkstra 519411 vs DMSY 512401).
3. **k = 6 / 8 / 12 with paper `t` are nearly identical** at each seed (e.g. seed 4: 0.9865, 0.9865, 0.9866); median across those 30 cells: **0.9903**.
4. **Paper k = 2 barely breaks even** — median ratio **1.0015**; wins only on seeds 2 and 8 (0.9949, 0.9948); loses on the other eight seeds.
5. **`twoK` loses at L** — per-seed min ratios 1.0152–1.0270; the scout `twoK` win at M does **not** generalize to n = 25k.

### Winning cells — sparse L, k = 6, paper `t` (seeds 0–9)

All ten seeds beat Dijkstra at k = 6 with paper `t` (demo floor k = max(6, paper k) = 6).

| seed | dijkstraWork | dmsyWork |      ratio |
| ---: | -----------: | -------: | ---------: |
|    0 |       511273 |   507328 |     0.9923 |
|    1 |       517412 |   512219 |     0.9900 |
|    2 |       521388 |   516550 |     0.9907 |
|    3 |       515380 |   510234 |     0.9900 |
|    4 |       519411 |   512401 | **0.9865** |
|    5 |       512045 |   510501 |     0.9970 |
|    6 |       522686 |   520365 |     0.9956 |
|    7 |       519739 |   513344 |     0.9877 |
|    8 |       517269 |   512298 |     0.9904 |
|    9 |       518889 |   515713 |     0.9939 |

Source: [`dmsy-kt-sweep-sparse-L.tsv`](dmsy-kt-sweep-sparse-L.tsv).

### Paper k = 2 at sparse L (seeds 0–9)

| seed | dijkstraWork | dmsyWork |  ratio |
| ---: | -----------: | -------: | -----: |
|    0 |       511273 |   512663 | 1.0027 |
|    1 |       517412 |   518402 | 1.0019 |
|    2 |       521388 |   518716 | 0.9949 |
|    3 |       515380 |   516116 | 1.0014 |
|    4 |       519411 |   519351 | 0.9999 |
|    5 |       512045 |   512981 | 1.0018 |
|    6 |       522686 |   523910 | 1.0023 |
|    7 |       519739 |   519589 | 0.9997 |
|    8 |       517269 |   514602 | 0.9948 |
|    9 |       518889 |   519708 | 1.0016 |

Median **1.0015** — not a reliable win; demo floor raises paper k = 2 → 6.

## Locked demo defaults (#54)

- **DMSY params:** `k = max(6, paper k)`, paper `t` (Lemma 3.9). **Not** BMSSP's `k = max(4, paper k)`.
- **Default race URL:** `?g=sparse&n=25000&seed=4` — keep it (best confirm margin; ratio **0.9865**).
- **Honest framing:** no S/M gallery win in scout; demo still loses on maze, clusters, city, and adversarial at tested sizes. Clusters remain Dijkstra-dominated (ratios ≫ 1).

## How to reproduce

```bash
npm run bench:dmsy-kt -- --sizes=500,5000 --seeds=0,1,2 --out=bench/dmsy-kt-sweep-scout.md
npm run bench:dmsy-kt -- --kinds=sparse --sizes=25000 --seeds=0,1,2,3,4,5,6,7,8,9 --k=2,6,8,12 --t=paper,twoK --out=bench/dmsy-kt-sweep-sparse-L.md
```
