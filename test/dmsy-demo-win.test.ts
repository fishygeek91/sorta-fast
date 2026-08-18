import { describe, expect, it } from "vitest";

import { run as runDmsy } from "../src/core/dmsy/dmsy.ts";
import { run as runDijkstra } from "../src/core/dijkstra.ts";
import { generateGraph } from "../src/core/graph.ts";
import { scanCosts, TraceWriter, type TraceEvent } from "../src/core/trace.ts";
import { resolveDmsyRunParams } from "../src/harness/dmsyRunParams.ts";
import { DEFAULT_RACE_URL } from "../src/ui/raceUrl.ts";

const SOURCE_VERTEX = 0;

/**
 * Drain a trace generator through TraceWriter and sum billed work via scanCosts.
 *
 * Avoids materializing a TraceEvent[] so the 25k-node default race stays
 * inside the CI timeout.
 *
 * @param gen - Algorithm trace generator (Dijkstra or DMSY).
 * @returns Headline billed-op total.
 */
function billedWork(gen: Generator<TraceEvent, unknown, undefined>): number {
  const writer = new TraceWriter();
  for (;;) {
    const step = gen.next();
    if (step.done) {
      break;
    }
    writer.append(step.value);
  }

  let work = 0;
  for (const chunk of writer.takeChunks()) {
    work += scanCosts(chunk).work;
  }
  return work;
}

describe("DMSY demo default race (#54)", () => {
  it("beats Dijkstra on billed work for DEFAULT_RACE_URL demo params", () => {
    expect(DEFAULT_RACE_URL.g).toBe("sparse");
    expect(DEFAULT_RACE_URL.n).toBe(25000);
    expect(DEFAULT_RACE_URL.seed).toBe(4);
    expect(DEFAULT_RACE_URL.dmsy).toBe("demo");
    expect(DEFAULT_RACE_URL.dk).toBeNull();
    expect(DEFAULT_RACE_URL.dt).toBeNull();

    const graph = generateGraph(DEFAULT_RACE_URL.g, DEFAULT_RACE_URL.n, DEFAULT_RACE_URL.seed);
    const params = resolveDmsyRunParams(
      DEFAULT_RACE_URL.n,
      DEFAULT_RACE_URL.dmsy,
      DEFAULT_RACE_URL.dk,
      DEFAULT_RACE_URL.dt,
    );

    const dijkstraWork = billedWork(runDijkstra(graph, SOURCE_VERTEX));
    const dmsyWork = billedWork(runDmsy(graph, SOURCE_VERTEX, params));

    expect(dmsyWork).toBeLessThan(dijkstraWork);
  }, 60_000);
});
