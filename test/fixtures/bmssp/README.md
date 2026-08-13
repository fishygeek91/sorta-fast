# BMSSP cross-check fixtures (issue #11)

Frozen small graphs used by `test/bmssp-crosscheck.test.ts` to verify our BMSSP lane against an external oracle without network access in CI.

## Primary oracle: Braeniac README example

[`braeniac-readme-example.json`](./braeniac-readme-example.json) is the exact graph published in the [Braeniac/bm-sssp](https://github.com/Braeniac/bm-sssp) README as BM-SSSP output:

- `n = 6`, `source = 0`
- edges: `(0,1,2)`, `(0,2,3)`, `(1,3,2)`, `(2,3,2)`, `(3,4,1)`, `(1,5,10)`
- expected distances: `[0, 2, 3, 4, 5, 12]`

That published result satisfies the issue #11 requirement to cross-check against at least one existing BMSSP implementation.

## Additional fixtures

The other JSON files are hand-chosen small graphs (chains, diamonds with ties, stars, sparse DAGs, cycles) where expected distances were computed with **local Dijkstra** (`src/core/dijkstra.ts`). This matches Braeniac's own validation approach (BM-SSSP must agree with Dijkstra on non-negative weights).

Regenerate distances offline with:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning bench/generate-bmssp-braeniac-fixtures.ts
```

If you have Braeniac's CLI installed locally, the script prints optional `npx bm-sssp` comparison instructions — not required for CI.

## JSON schema

Each file:

```json
{
  "name": "string",
  "n": 6,
  "edges": [{ "from": 0, "to": 1, "weight": 2 }],
  "source": 0,
  "distances": [0, 2, 3, 4, 5, 12]
}
```

Unreachable vertices use JSON `null` for `Infinity`; tests convert `null → Infinity` before comparing distance arrays.
