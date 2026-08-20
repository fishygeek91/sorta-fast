# BMSSP k/t sweep (issue #52)

Work = comparison-addition billed work from `scanCosts` on drained traces.
Ratio = BMSSP work / Dijkstra work on the same seeded graph (source vertex 0).

**Grid:** XL (100k) included via `--xl`; **city at L (25k)** is still skipped because
Bowyer–Watson Delaunay generation is O(n²) (issue #32).

| kind   |      n | seed |   k |   t | tVariant |   L | dijkstraWork | bmsspWork |  ratio |
| ------ | -----: | ---: | --: | --: | -------- | --: | -----------: | --------: | -----: |
| sparse | 100000 |    0 |   4 |   6 | paper    |   3 |      2408534 |   2088174 | 0.8670 |
| sparse | 100000 |    1 |   4 |   6 | paper    |   3 |      2406881 |   2016547 | 0.8378 |
| sparse | 100000 |    2 |   4 |   6 | paper    |   3 |      2416831 |   2058579 | 0.8518 |
| sparse | 100000 |    3 |   4 |   6 | paper    |   3 |      2416012 |   2142720 | 0.8869 |
| sparse | 100000 |    4 |   4 |   6 | paper    |   3 |      2413981 |   2044058 | 0.8468 |
