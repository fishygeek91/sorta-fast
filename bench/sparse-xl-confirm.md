# XL sparse confirm (issue #103)

Headless re-check that **demo** k/t parameters beat Dijkstra on the shared work clock at sparse **XL** (n = 100,000), seeds 0–4. This is the confirmation gate for the featured race preset (`?g=sparse&n=100000&seed=4&target=none`).

## Reproduce

```bash
npm run bench:bmssp-kt -- --xl --out=bench/sparse-xl-confirm-bmssp.md
npm run bench:dmsy-kt -- --xl --out=bench/sparse-xl-confirm-dmsy.md
```

Grid: sparse n = 100,000; seeds 0–4; **demo k/t only** (BMSSP k = max(4, paper k) with paper t → k = 4, t = 6; DMSY k = max(6, paper k) with paper t → k = 6, t = 5). Source vertex 0.

Raw machine output (headers still say XL is omitted — ignore that):

- [`sparse-xl-confirm-bmssp.tsv`](sparse-xl-confirm-bmssp.tsv)
- [`sparse-xl-confirm-dmsy.tsv`](sparse-xl-confirm-dmsy.tsv)
- Combined: [`sparse-xl-confirm.tsv`](sparse-xl-confirm.tsv)

## Featured preset (seed 4)

| Lane  |   k |   t | Dijkstra work | Lane work |  Ratio |
| ----- | --: | --: | ------------: | --------: | -----: |
| BMSSP |   4 |   6 |     2,413,981 | 2,044,058 | 0.8468 |
| DMSY  |   6 |   5 |     2,413,981 | 2,208,892 | 0.9150 |

## Confirm seed range (ratio vs Dijkstra)

| Lane  | Seeds 0–4 ratio range |
| ----- | --------------------- |
| BMSSP | 0.8378 – 0.8869       |
| DMSY  | 0.9130 – 0.9158       |

## Gate

Both lanes must stay **≤ 0.95** vs Dijkstra on every confirm seed. No k/t retune after this gate — demo defaults are locked from the L sparse sweeps ([#52](https://github.com/fishygeek91/sorta-fast/issues/52) / [#54](https://github.com/fishygeek91/sorta-fast/issues/54)).

**Note:** wall-clock JSON on the bench page may show DMSY work **2,209,925** for the same graph when `run()` is called without explicit `{ k: 6, t: 5 }`; the sweep and featured race use explicit demo params (**2,208,892** here).
