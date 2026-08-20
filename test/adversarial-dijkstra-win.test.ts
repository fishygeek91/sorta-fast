/**
 * Issue #104: pins the adversarial gallery relabel — `g=adversarial` is Dijkstra
 * territory on the shared work clock (BMSSP-demo and DMSY-demo billed work exceed
 * Dijkstra at S/M for seeds 0–4). This is not a claim that Dijkstra loses elsewhere.
 */

import { describe, expect, it } from "vitest";

import { run as runBmssp } from "../src/core/bmssp/bmssp.ts";
import { run as runDmsy } from "../src/core/dmsy/dmsy.ts";
import { run as runDijkstra } from "../src/core/dijkstra.ts";
import { generateGraph, SIZE_PRESETS } from "../src/core/graph.ts";
import { scanCosts, TraceWriter, type TraceEvent } from "../src/core/trace.ts";

const SOURCE_VERTEX = 0;

const ADVERSARIAL_SIZES = [SIZE_PRESETS.S, SIZE_PRESETS.M] as const;
const ADVERSARIAL_SEEDS = [0, 1, 2, 3, 4] as const;

/**
 * Drain a trace generator through TraceWriter and sum billed work via scanCosts.
 *
 * Avoids materializing a TraceEvent[] so multi-lane S/M sweeps stay inside CI
 * timeouts.
 *
 * @param gen - Algorithm trace generator (Dijkstra, BMSSP, or DMSY).
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

describe("adversarial gallery — Dijkstra wins on work clock (#104)", () => {
  it("beats BMSSP-demo and DMSY-demo at S/M for seeds 0–4", () => {
    for (const n of ADVERSARIAL_SIZES) {
      for (const seed of ADVERSARIAL_SEEDS) {
        const graph = generateGraph("adversarial", n, seed);

        const dijkstraWork = billedWork(runDijkstra(graph, SOURCE_VERTEX));
        const bmsspWork = billedWork(runBmssp(graph, SOURCE_VERTEX));
        const dmsyWork = billedWork(runDmsy(graph, SOURCE_VERTEX));

        expect(
          dijkstraWork,
          `n=${String(n)} seed=${String(seed)}: Dijkstra ${String(dijkstraWork)} vs BMSSP ${String(bmsspWork)}`,
        ).toBeLessThan(bmsspWork);
        expect(
          dijkstraWork,
          `n=${String(n)} seed=${String(seed)}: Dijkstra ${String(dijkstraWork)} vs DMSY ${String(dmsyWork)}`,
        ).toBeLessThan(dmsyWork);
      }
    }
  }, 120_000);
});
