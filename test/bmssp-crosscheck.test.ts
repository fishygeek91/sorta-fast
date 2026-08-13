/**
 * BMSSP cross-check against frozen fixtures (issue #11).
 *
 * Primary oracle: Braeniac/bm-sssp README example (`braeniac-readme-example.json`).
 * Additional graphs: local Dijkstra distances (same validation as Braeniac).
 * No network; fixtures loaded from `test/fixtures/bmssp/*.json`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { packCsr, type CsrEdge } from "../src/core/graph.ts";
import { drainBmsspRun } from "./bmssp-helpers.ts";
import { drainRun } from "./dijkstra-helpers.ts";

/** On-disk fixture shape. */
type BmsspFixture = {
  readonly name: string;
  readonly n: number;
  readonly edges: readonly CsrEdge[];
  readonly source: number;
  readonly distances: readonly (number | null)[];
};

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/bmssp");

/** Compare Float64Arrays including Infinity entries. */
function expectDistancesEqual(a: Float64Array, b: Float64Array): void {
  expect(Array.from(a)).toEqual(Array.from(b));
}

/**
 * Convert JSON distances to a Float64Array (`null` → Infinity).
 */
function parseFixtureDistances(raw: readonly (number | null)[]): Float64Array {
  const out = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const d = raw[i];
    if (d === null) {
      out[i] = Number.POSITIVE_INFINITY;
    } else if (typeof d === "number" && Number.isFinite(d)) {
      out[i] = d;
    } else {
      throw new Error(`fixture distances[${i}] must be a finite number or null, got ${String(d)}`);
    }
  }
  return out;
}

/**
 * Load all JSON fixtures from the fixture directory.
 */
function loadBmsspFixtures(): BmsspFixture[] {
  const files = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error(`no JSON fixtures found in ${FIXTURE_DIR}`);
  }

  return files.map((name) => {
    const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
    const fixture = JSON.parse(raw) as BmsspFixture;
    if (fixture.name !== name.replace(/\.json$/, "")) {
      throw new Error(`fixture name "${fixture.name}" does not match file "${name}"`);
    }
    return fixture;
  });
}

/**
 * Pack fixture edges into CSR with deterministic placeholder layout coords.
 */
function graphFromFixture(fixture: BmsspFixture) {
  const coords = Array.from({ length: fixture.n }, (_, i) => i);
  return packCsr(
    fixture.n,
    [...fixture.edges],
    coords,
    coords.map(() => 0),
  );
}

const fixtures = loadBmsspFixtures();

describe("bmssp cross-check fixtures", () => {
  it("includes the Braeniac README example oracle", () => {
    const braeniac = fixtures.find((f) => f.name === "braeniac-readme-example");
    expect(braeniac).toBeDefined();
    expect(parseFixtureDistances(braeniac?.distances ?? [])).toEqual(
      new Float64Array([0, 2, 3, 4, 5, 12]),
    );
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    "%s: BMSSP matches fixture and Dijkstra",
    (_name, fixture) => {
      const expected = parseFixtureDistances(fixture.distances);
      const graph = graphFromFixture(fixture);

      const { result: bmsspResult } = drainBmsspRun(graph, fixture.source);
      const { result: dijkstraResult } = drainRun(graph, fixture.source);

      expectDistancesEqual(bmsspResult.distances, expected);
      expectDistancesEqual(dijkstraResult.distances, expected);
      expectDistancesEqual(bmsspResult.distances, dijkstraResult.distances);
    },
  );
});
