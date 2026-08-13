/**
 * Offline helper: regenerate BMSSP fixture distances from local Dijkstra.
 *
 * Issue #11 — cross-check fixtures under `test/fixtures/bmssp/`. CI cannot
 * depend on npm-installing Braeniac; the primary oracle is the published README
 * example. This script recomputes all fixture `distances` fields with our
 * Dijkstra lane (same validation approach as Braeniac/bm-sssp).
 *
 * Run:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning bench/generate-bmssp-braeniac-fixtures.ts
 *
 * Optional local Braeniac comparison (not required for CI):
 *   npx bm-sssp <graph-file>
 * Compare stdout distances to the JSON `distances` field for each fixture.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { packCsr, type CsrEdge } from "../src/core/graph.ts";
import { drainRun } from "../test/dijkstra-helpers.ts";

/** On-disk fixture shape (matches `test/fixtures/bmssp/*.json`). */
type BmsspFixtureFile = {
  readonly name: string;
  readonly n: number;
  readonly edges: readonly CsrEdge[];
  readonly source: number;
  readonly distances: readonly (number | null)[];
};

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/bmssp");

/**
 * Serialize a distance array for JSON: finite numbers as-is, Infinity as null.
 */
function distancesToJson(distances: Float64Array): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < distances.length; i += 1) {
    const d = distances[i];
    if (d === undefined) {
      throw new Error(`distances[${i}] missing`);
    }
    out.push(Number.isFinite(d) ? d : null);
  }
  return out;
}

/**
 * Pack a fixture into CSR and run local Dijkstra for oracle distances.
 */
function dijkstraDistances(fixture: BmsspFixtureFile): Float64Array {
  const coords = Array.from({ length: fixture.n }, (_, i) => i);
  const graph = packCsr(
    fixture.n,
    [...fixture.edges],
    coords,
    coords.map(() => 0),
  );
  const { result } = drainRun(graph, fixture.source);
  return result.distances;
}

/**
 * Load every `*.json` fixture from the fixture directory.
 */
function loadFixtures(): BmsspFixtureFile[] {
  const files = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  return files.map((name) => {
    const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
    return JSON.parse(raw) as BmsspFixtureFile;
  });
}

function main(): void {
  const fixtures = loadFixtures();
  let updated = 0;

  for (const fixture of fixtures) {
    const computed = dijkstraDistances(fixture);
    const jsonDistances = distancesToJson(computed);
    const stored = fixture.distances;

    const storedFinite = stored.map((d) => (d === null ? Number.POSITIVE_INFINITY : d));
    const matches =
      storedFinite.length === jsonDistances.length &&
      storedFinite.every(
        (d, i) => d === (jsonDistances[i] === null ? Number.POSITIVE_INFINITY : jsonDistances[i]),
      );

    if (!matches) {
      const next: BmsspFixtureFile = {
        ...fixture,
        distances: jsonDistances,
      };
      const path = join(FIXTURE_DIR, `${fixture.name}.json`);
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
      console.log(`updated ${fixture.name}.json`);
      updated += 1;
    } else {
      console.log(`ok ${fixture.name}.json`);
    }
  }

  console.log(`\n${fixtures.length} fixture(s); ${updated} updated.`);
  console.log("\nOptional Braeniac CLI cross-check (offline, if installed):");
  console.log('  for f in test/fixtures/bmssp/*.json; do npx bm-sssp "$f"; done');
  console.log('Compare CLI output to each file\'s "distances" array.');
}

main();
