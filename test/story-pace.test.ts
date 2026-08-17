import { describe, expect, it } from "vitest";

import { storyNominalSeconds } from "../src/ui/storyDrive.ts";
import { type TraceJobSpec } from "../src/workers/traceJob.ts";
import { collectTraceJob, totalsFromTraces } from "./helpers/story-traces.ts";

/** Pedagogical preset for story-mode nominal duration (#19). */
const STORY_TRACE_SPEC: TraceJobSpec = {
  kind: "city",
  n: 500,
  seed: 1729,
  source: 0,
};

describe("storyNominalSeconds — pedagogical seed", () => {
  it("nominal tour duration is about 90 seconds on city/500/1729", () => {
    const dijkstra = collectTraceJob("dijkstra", STORY_TRACE_SPEC);
    const bmssp = collectTraceJob("bmssp", STORY_TRACE_SPEC);
    const dmsy = collectTraceJob("dmsy", STORY_TRACE_SPEC);
    const totals = totalsFromTraces(dijkstra, bmssp, dmsy);
    const seconds = storyNominalSeconds(totals);

    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(60);
    expect(seconds).toBeLessThanOrEqual(120);
  });
});
