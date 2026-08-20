# DMSY k/t sweep (issue #54)

Work = comparison-addition billed work from `scanCosts` on drained traces.
Ratio = DMSY work / Dijkstra work on the same seeded graph (source vertex 0).

**Grid:** XL (100k) included via `--xl`; **city at L (25k)** is still skipped because
Bowyer–Watson Delaunay generation is O(n²) (issue #32).
Cells with non-finite block size M (Lemma 3.1) or workload cap (Lemma 3.8)
at top recursion depth are omitted from the sweep.

| kind   |      n | seed |   k |   t | tVariant |   L | dijkstraWork | dmsyWork |  ratio |
| ------ | -----: | ---: | --: | --: | -------- | --: | -----------: | -------: | -----: |
| sparse | 100000 |    0 |   6 |   5 | paper    |   4 |      2408534 |  2204928 | 0.9155 |
| sparse | 100000 |    1 |   6 |   5 | paper    |   4 |      2406881 |  2202782 | 0.9152 |
| sparse | 100000 |    2 |   6 |   5 | paper    |   4 |      2416831 |  2213220 | 0.9158 |
| sparse | 100000 |    3 |   6 |   5 | paper    |   4 |      2416012 |  2205778 | 0.9130 |
| sparse | 100000 |    4 |   6 |   5 | paper    |   4 |      2413981 |  2208892 | 0.9150 |
