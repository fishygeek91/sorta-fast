# Adversarial candidate families (#104)

Headless billed-work comparison of Dijkstra-hostile graph families vs the gallery **adversarial** control (chains + wide fans). Work = comparison-addition totals from `scanCosts` on drained traces (`src/core/trace.ts` `OP_COST`). Ratio = lane work / Dijkstra work on the same seeded graph (source vertex 0). Ratio < 1 means the barrier-breaker wins.

**Gate (#104):** PASS only when BMSSP **demo** work (`k = max(4, paper k)`, paper `t`) is strictly less than Dijkstra work on **every** seed 0–4 at M (5000) and L (25000). DMSY demo params are reported but not part of the gate.

**Decision:** **GATE FAIL** on all measured families at M. Closest candidate is **cascadeAll** (ratio 1.096–1.104). Relabel the gallery preset as heap stress / Dijkstra territory; keep topology and URL slug `adversarial`. Analysis: [`docs/paper-notes.md`](../docs/paper-notes.md) §1.4.

## Families

| Family           | Intent                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| **control**      | Current gallery `generateAdversarial` (chains + fans)                        |
| **cascade3**     | Decrease-key waves; each target wired from first/middle/last wave (~2n arcs) |
| **cascadeAll**   | Same waves; each target wired from every wave (denser)                       |
| **cascadeHub**   | cascadeAll targets; source reaches waves via hubs (out-degree = waveCount)   |
| **wideFrontier** | Random in-arborescence from 0, pad to m=2n, tight weights 1+U(0,1)           |

## Scout (S, n = 500, seeds 0–2)

Demo BMSSP/DMSY params; source = 0. Raw: [`adversarial-candidates-scout.tsv`](adversarial-candidates-scout.tsv).

| family       | seed |   dij | bmssp |  ratio |   dmsy |  ratio |
| ------------ | ---: | ----: | ----: | -----: | -----: | -----: |
| control      |    0 |  8562 | 26517 | 3.0971 |  17287 | 2.0190 |
| control      |    1 |  8568 | 26999 | 3.1511 |  17219 | 2.0097 |
| control      |    2 |  8568 | 26507 | 3.0937 |  17277 | 2.0165 |
| cascade3     |    0 | 13993 | 39050 | 2.7907 |  23232 | 1.6603 |
| cascadeAll   |    0 | 57439 | 75814 | 1.3199 | 218883 | 3.8107 |
| cascadeAll   |    1 | 57599 | 74687 | 1.2967 | 221173 | 3.8399 |
| cascadeAll   |    2 | 57884 | 74276 | 1.2832 | 155566 | 2.6875 |
| wideFrontier |    0 |  7435 | 15161 | 2.0391 |  14951 | 2.0109 |
| wideFrontier |    1 |  7598 | 16012 | 2.1074 |  15078 | 1.9845 |
| wideFrontier |    2 |  7759 | 16042 | 2.0675 |  15241 | 1.9643 |

## M confirm (n = 5000, seeds 0–4)

Raw: [`adversarial-candidates-M.tsv`](adversarial-candidates-M.tsv).

### control

| seed |    dij |  bmssp |  ratio |   dmsy |  ratio |
| ---: | -----: | -----: | -----: | -----: | -----: |
|    0 | 118508 | 345928 | 2.9190 | 208086 | 1.7559 |
|    1 | 118461 | 344866 | 2.9112 | 207969 | 1.7556 |
|    2 | 118526 | 342879 | 2.8929 | 207837 | 1.7535 |
|    3 | 118468 | 346494 | 2.9248 | 207763 | 1.7537 |
|    4 | 118465 | 345986 | 2.9206 | 207662 | 1.7529 |

### cascadeAll (closest FAIL)

| seed |    dij |  bmssp |  ratio |    dmsy |  ratio |
| ---: | -----: | -----: | -----: | ------: | -----: |
|    0 | 803537 | 882561 | 1.0983 | 2675863 | 3.3301 |
|    1 | 804586 | 882262 | 1.0965 | 2701109 | 3.3571 |
|    2 | 804070 | 886078 | 1.1020 | 2663401 | 3.3124 |
|    3 | 803034 | 886123 | 1.1035 | 2640395 | 3.2880 |
|    4 | 802654 | 885270 | 1.1029 | 2667176 | 3.3229 |

## cascadeHub at M (summary)

Low source degree; worse than cascadeAll. Raw: [`adversarial-candidates-hub.tsv`](adversarial-candidates-hub.tsv).

| seed | ratio bmssp | ratio dmsy |
| ---: | ----------: | ---------: |
|    0 |      1.3998 |     3.8617 |
|    1 |      1.3800 |     3.9521 |
|    2 |      1.4282 |     3.9594 |
|    3 |      1.3891 |     3.8644 |
|    4 |      1.4006 |     3.9387 |

## k/t sweep on cascadeAll M seed 0

Explicit BMSSP k/t (Dijkstra unchanged). Raw: [`adversarial-candidates-kt.tsv`](adversarial-candidates-kt.tsv).

|   k |   t | tVariant |  bmssp |      ratio | note                        |
| --: | --: | -------- | -----: | ---------: | --------------------------- |
|   4 |   5 | paper    | 882561 |     1.0983 | **demo default**            |
|   4 |   8 | twoK     | 784283 | **0.9760** | only sub-1.0 ratio measured |
|   2 |   5 | paper    | 851517 |     1.0597 |                             |
|   8 |   5 | paper    | 958831 |     1.1933 |                             |

Gate requires demo params (k = 4, paper t = 5), not swept k/t.

## Re-run

```bash
npm run bench:adversarial-candidates -- --scout   # S grid, seeds 0–2
npm run bench:adversarial-candidates                # full M/L gate grid
```

Writes TSV (+ optional markdown) next to this file. See `bench/adversarial-candidates.ts` for `--quick`, `--families=`, `--sizes=`, `--seeds=`, and `--kt=`.
