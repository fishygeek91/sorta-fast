import { describe, expect, it } from "vitest";

import { run as runBmssp } from "../src/core/bmssp/bmssp.ts";
import { run as runDmsy } from "../src/core/dmsy/dmsy.ts";
import { run as runDijkstra } from "../src/core/dijkstra.ts";
import { generateGraph } from "../src/core/graph.ts";
import { scanCosts, TraceWriter, type TraceEvent } from "../src/core/trace.ts";
import { resolveBmsspRunParams } from "../src/harness/bmsspRunParams.ts";
import { resolveDmsyRunParams } from "../src/harness/dmsyRunParams.ts";
import { FEATURED_RACE_URL } from "../src/ui/raceUrl.ts";

const SOURCE_VERTEX = 0;

/**
 * Drain a trace generator through TraceWriter and sum billed work via scanCosts.
 *
 * Avoids materializing a TraceEvent[] so the 100k-node featured race stays
 * inside the CI timeout. Periodic `setImmediate` yields keep the vitest worker
 * RPC heartbeat alive during the 100k DMSY drain (#103 review).
 *
 * @param gen - Algorithm trace generator (Dijkstra, BMSSP, or DMSY).
 * @returns Headline billed-op total.
 */
async function billedWork(gen: Generator<TraceEvent, unknown, undefined>): Promise<number> {
  const writer = new TraceWriter();
  let i = 0;
  for (;;) {
    const step = gen.next();
    if (step.done) {
      break;
    }
    writer.append(step.value);
    i += 1;
    if (i % 500_000 === 0) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
  }

  let work = 0;
  for (const chunk of writer.takeChunks()) {
    work += scanCosts(chunk).work;
  }
  return work;
}

describe("featured barrier race (#103)", () => {
  it("pins FEATURED_RACE_URL identity (sparse XL seed 4, settle-all)", () => {
    expect(FEATURED_RACE_URL.g).toBe("sparse");
    expect(FEATURED_RACE_URL.n).toBe(100000);
    expect(FEATURED_RACE_URL.seed).toBe(4);
    expect(FEATURED_RACE_URL.target).toBe("none");
    expect(FEATURED_RACE_URL.bmssp).toBe("demo");
    expect(FEATURED_RACE_URL.dmsy).toBe("demo");
    expect(FEATURED_RACE_URL.bk).toBeNull();
    expect(FEATURED_RACE_URL.bt).toBeNull();
    expect(FEATURED_RACE_URL.dk).toBeNull();
    expect(FEATURED_RACE_URL.dt).toBeNull();
  });

  it("BMSSP and DMSY billed work ≤ 0.95 × Dijkstra on FEATURED_RACE_URL", async () => {
    const graph = generateGraph(FEATURED_RACE_URL.g, FEATURED_RACE_URL.n, FEATURED_RACE_URL.seed);
    const bmsspParams = resolveBmsspRunParams(
      FEATURED_RACE_URL.n,
      FEATURED_RACE_URL.bmssp,
      FEATURED_RACE_URL.bk,
      FEATURED_RACE_URL.bt,
    );
    const dmsyParams = resolveDmsyRunParams(
      FEATURED_RACE_URL.n,
      FEATURED_RACE_URL.dmsy,
      FEATURED_RACE_URL.dk,
      FEATURED_RACE_URL.dt,
    );

    const dijkstraWork = await billedWork(runDijkstra(graph, SOURCE_VERTEX));
    const bmsspWork = await billedWork(runBmssp(graph, SOURCE_VERTEX, bmsspParams));
    const dmsyWork = await billedWork(runDmsy(graph, SOURCE_VERTEX, dmsyParams));

    expect(bmsspWork / dijkstraWork).toBeLessThanOrEqual(0.95);
    expect(dmsyWork / dijkstraWork).toBeLessThanOrEqual(0.95);
    // GHA/sandbox DMSY 100k drain can exceed 3 minutes.
  }, 600_000);
});
