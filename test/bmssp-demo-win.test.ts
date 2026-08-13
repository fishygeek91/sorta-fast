import { describe, expect, it } from "vitest";

import { run as runBmssp } from "../src/core/bmssp/bmssp.ts";
import { run as runDijkstra } from "../src/core/dijkstra.ts";
import { generateGraph } from "../src/core/graph.ts";
import { scanCosts, TraceWriter, type TraceEvent } from "../src/core/trace.ts";
import { resolveBmsspRunParams } from "../src/harness/bmsspRunParams.ts";
import { DEFAULT_RACE_URL } from "../src/ui/raceUrl.ts";

const SOURCE_VERTEX = 0;

/**
 * Drain a trace generator through TraceWriter and sum billed work via scanCosts.
 *
 * Avoids materializing a TraceEvent[] so the 25k-node default race stays
 * inside the CI timeout.
 *
 * @param gen - Algorithm trace generator (Dijkstra or BMSSP).
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

describe("BMSSP demo default race (#52)", () => {
  it("beats Dijkstra on billed work for DEFAULT_RACE_URL demo params", () => {
    expect(DEFAULT_RACE_URL.g).toBe("sparse");
    expect(DEFAULT_RACE_URL.n).toBe(25000);
    expect(DEFAULT_RACE_URL.seed).toBe(4);
    expect(DEFAULT_RACE_URL.bmssp).toBe("demo");
    expect(DEFAULT_RACE_URL.bk).toBeNull();
    expect(DEFAULT_RACE_URL.bt).toBeNull();

    const graph = generateGraph(DEFAULT_RACE_URL.g, DEFAULT_RACE_URL.n, DEFAULT_RACE_URL.seed);
    const params = resolveBmsspRunParams(
      DEFAULT_RACE_URL.n,
      DEFAULT_RACE_URL.bmssp,
      DEFAULT_RACE_URL.bk,
      DEFAULT_RACE_URL.bt,
    );

    const dijkstraWork = billedWork(runDijkstra(graph, SOURCE_VERTEX));
    const bmsspWork = billedWork(runBmssp(graph, SOURCE_VERTEX, params));

    expect(bmsspWork).toBeLessThan(dijkstraWork);
  }, 60_000);
});
