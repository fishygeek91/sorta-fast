import { describe, expect, it } from "vitest";

import { BASE_OPS_PER_SECOND } from "../src/harness/workClock.ts";
import { applyStoryStep, storyNominalSeconds, type StoryLaneTotals } from "../src/ui/storyDrive.ts";
import { STORY_SPEED, STORY_STEPS } from "../src/ui/storyScript.ts";
import { type TraceJobSpec } from "../src/workers/traceJob.ts";
import { collectTraceJob, totalsFromTraces } from "./helpers/story-traces.ts";

/** Synthetic lane totals for fast drive resolution tests. */
const SYNTHETIC_TOTALS: StoryLaneTotals = {
  dijkstraWork: 1000,
  bmsspWork: 800,
};

/**
 * Serialize seek/end pairs for every shipped step (determinism checks).
 *
 * @param totals - Lane billed work totals.
 */
function driveWindowsForAllSteps(totals: StoryLaneTotals): Array<{ seekT: number; endT: number }> {
  return STORY_STEPS.map((step) => {
    const drive = applyStoryStep(step, totals);
    return { seekT: drive.seekT, endT: drive.endT };
  });
}

describe("applyStoryStep — synthetic totals", () => {
  it("wavefront shows dijkstra only with seekT 0 and endT 850", () => {
    const drive = applyStoryStep("wavefront", SYNTHETIC_TOTALS);
    expect(drive.showDijkstra).toBe(true);
    expect(drive.showBmssp).toBe(false);
    expect(drive.seekT).toBe(0);
    expect(drive.endT).toBe(850);
    expect(drive.callout).toBeNull();
  });

  it("sorting seeks to end of dijkstra work with comparisons callout", () => {
    const drive = applyStoryStep("sorting", SYNTHETIC_TOTALS);
    expect(drive.seekT).toBe(1000);
    expect(drive.endT).toBe(1000);
    expect(drive.callout).toBe("comparisons");
    expect(drive.showBmssp).toBe(false);
  });

  it("pivots shows bmssp only with seekT 0 and endT 560", () => {
    const drive = applyStoryStep("pivots", SYNTHETIC_TOTALS);
    expect(drive.showDijkstra).toBe(false);
    expect(drive.showBmssp).toBe(true);
    expect(drive.seekT).toBe(0);
    expect(drive.endT).toBe(560);
  });

  it("race shows both lanes with endT floor(0.6 * dijkstra work)", () => {
    const drive = applyStoryStep("race", SYNTHETIC_TOTALS);
    expect(drive.showDijkstra).toBe(true);
    expect(drive.showBmssp).toBe(true);
    expect(drive.seekT).toBe(0);
    expect(drive.endT).toBe(Math.floor(0.6 * SYNTHETIC_TOTALS.dijkstraWork));
  });

  it("throws for reserved forest slug", () => {
    expect(() => applyStoryStep("forest", SYNTHETIC_TOTALS)).toThrow(/not shipped/i);
  });

  it("throws when dijkstraWork is negative", () => {
    expect(() => applyStoryStep("wavefront", { dijkstraWork: -1, bmsspWork: 800 })).toThrow(
      /dijkstraWork/,
    );
  });

  it("throws when bmsspWork is negative", () => {
    expect(() => applyStoryStep("wavefront", { dijkstraWork: 1000, bmsspWork: -1 })).toThrow(
      /bmsspWork/,
    );
  });
});

describe("storyNominalSeconds — synthetic totals", () => {
  it("equals sum of beat windows divided by STORY_SPEED * BASE_OPS_PER_SECOND", () => {
    const opsPerSecond = STORY_SPEED * BASE_OPS_PER_SECOND;
    let expected = 0;
    for (const step of STORY_STEPS) {
      const drive = applyStoryStep(step, SYNTHETIC_TOTALS);
      expected += (drive.endT - drive.seekT) / opsPerSecond;
    }
    expect(storyNominalSeconds(SYNTHETIC_TOTALS)).toBe(expected);
  });
});

describe("applyStoryStep — real seeded playback", () => {
  const STORY_TRACE_SPEC: TraceJobSpec = {
    kind: "city",
    n: 500,
    seed: 1729,
    source: 0,
  };

  const dijkstra = collectTraceJob("dijkstra", STORY_TRACE_SPEC);
  const bmssp = collectTraceJob("bmssp", STORY_TRACE_SPEC);
  const totals = totalsFromTraces(dijkstra, bmssp);

  it("wavefront seeks to work-clock zero", () => {
    expect(applyStoryStep("wavefront", totals).seekT).toBe(0);
  });

  it("sorting highlights comparisons callout", () => {
    expect(applyStoryStep("sorting", totals).callout).toBe("comparisons");
  });

  it("wavefront hides bmssp lane", () => {
    expect(applyStoryStep("wavefront", totals).showBmssp).toBe(false);
  });

  it("race shows both lanes", () => {
    const drive = applyStoryStep("race", totals);
    expect(drive.showDijkstra).toBe(true);
    expect(drive.showBmssp).toBe(true);
  });

  it("same seed yields identical seekT and endT for every shipped step", () => {
    const first = totalsFromTraces(
      collectTraceJob("dijkstra", STORY_TRACE_SPEC),
      collectTraceJob("bmssp", STORY_TRACE_SPEC),
    );
    const second = totalsFromTraces(
      collectTraceJob("dijkstra", STORY_TRACE_SPEC),
      collectTraceJob("bmssp", STORY_TRACE_SPEC),
    );

    expect(driveWindowsForAllSteps(first)).toEqual(driveWindowsForAllSteps(second));
  });
});
