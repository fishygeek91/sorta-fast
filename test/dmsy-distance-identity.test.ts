import { describe, expect, it } from "vitest";

import { degreeReduce } from "../src/core/dmsy/degreeReduce.ts";
import { demoDmsyParams, paperDmsyParams, run, type DmsyParams } from "../src/core/dmsy/dmsy.ts";
import { generateGraph, type Graph } from "../src/core/graph.ts";

const SOURCE_VERTEX = 0;
const MAZE_N = 30;
const SEED_COUNT = 20;

/** Compare Float64Arrays including Infinity entries. */
function expectDistancesEqual(a: Float64Array, b: Float64Array): void {
  expect(Array.from(a)).toEqual(Array.from(b));
}

/**
 * Drain {@link run} to the final distance array.
 *
 * @param graph - CSR graph.
 * @param source - SSSP source.
 * @param params - Resolved DMSY parameters.
 * @throws If the generator finishes without returning a result object.
 */
function drainDmsyDistances(graph: Graph, source: number, params: DmsyParams): Float64Array {
  const gen = run(graph, source, params);
  let step = gen.next();
  while (!step.done) {
    step = gen.next();
  }
  if (step.value === undefined) {
    throw new Error("dmsy run finished without returning a result");
  }
  return step.value.distances;
}

describe("DMSY paper vs demo distance identity (#54)", () => {
  it("matches paper distances on 20 seeded maze graphs at n=30", () => {
    for (let seed = 0; seed < SEED_COUNT; seed += 1) {
      const graph = generateGraph("maze", MAZE_N, seed);
      const delta = degreeReduce(graph).delta ?? 3;

      const paperParams = paperDmsyParams(graph.n, delta);
      const demoParams = demoDmsyParams(graph.n, delta);

      const paperDistances = drainDmsyDistances(graph, SOURCE_VERTEX, paperParams);
      const demoDistances = drainDmsyDistances(graph, SOURCE_VERTEX, demoParams);

      expectDistancesEqual(paperDistances, demoDistances);
    }
  });
});
