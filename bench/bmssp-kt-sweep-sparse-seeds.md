# BMSSP k/t sweep (issue #52)

Work = comparison-addition billed work from `scanCosts` on drained traces.
Ratio = BMSSP work / Dijkstra work on the same seeded graph (source vertex 0).

**Grid skips:** XL (100k) is omitted; **city at L (25k)** is skipped because
Bowyer–Watson Delaunay generation is O(n²) (issue #32).

| kind   |    n | seed |   k |   t | tVariant |   L | dijkstraWork | bmsspWork |  ratio |
| ------ | ---: | ---: | --: | --: | -------- | --: | -----------: | --------: | -----: |
| sparse | 5000 |    0 |   4 |   5 | paper    |   3 |        84824 |    110562 | 1.3034 |
| sparse | 5000 |    1 |   4 |   5 | paper    |   3 |        85289 |    112743 | 1.3219 |
| sparse | 5000 |    2 |   4 |   5 | paper    |   3 |        84482 |    111262 | 1.3170 |
| sparse | 5000 |    3 |   4 |   5 | paper    |   3 |        84473 |    109796 | 1.2998 |
| sparse | 5000 |    4 |   4 |   5 | paper    |   3 |        82326 |    105601 | 1.2827 |
| sparse | 5000 |    5 |   4 |   5 | paper    |   3 |            1 |         1 | 1.0000 |
| sparse | 5000 |    6 |   4 |   5 | paper    |   3 |        84712 |    111583 | 1.3172 |
| sparse | 5000 |    7 |   4 |   5 | paper    |   3 |        84216 |    109566 | 1.3010 |
| sparse | 5000 |    8 |   4 |   5 | paper    |   3 |        83157 |    112031 | 1.3472 |
| sparse | 5000 |    9 |   4 |   5 | paper    |   3 |        82902 |    108667 | 1.3108 |
| sparse | 5000 |   10 |   4 |   5 | paper    |   3 |        83821 |    110022 | 1.3126 |
| sparse | 5000 |   11 |   4 |   5 | paper    |   3 |        84319 |    108202 | 1.2832 |
| sparse | 5000 |   12 |   4 |   5 | paper    |   3 |        83573 |    107889 | 1.2910 |
| sparse | 5000 |   13 |   4 |   5 | paper    |   3 |        83059 |    110302 | 1.3280 |
| sparse | 5000 |   14 |   4 |   5 | paper    |   3 |        80799 |    106556 | 1.3188 |
| sparse | 5000 |   15 |   4 |   5 | paper    |   3 |        81926 |    107467 | 1.3118 |
| sparse | 5000 |   16 |   4 |   5 | paper    |   3 |        83816 |    111396 | 1.3291 |
| sparse | 5000 |   17 |   4 |   5 | paper    |   3 |        81853 |    108680 | 1.3277 |
| sparse | 5000 |   18 |   4 |   5 | paper    |   3 |        86964 |    115028 | 1.3227 |
| sparse | 5000 |   19 |   4 |   5 | paper    |   3 |        82466 |    106588 | 1.2925 |
