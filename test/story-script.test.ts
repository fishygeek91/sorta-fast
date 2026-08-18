import { describe, expect, it } from "vitest";

import {
  STORY_FOREST_INSERT_AFTER,
  STORY_PRESET,
  STORY_STEPS,
  STORY_TOUR_IDS,
  isShippedStoryStepId,
  nextStoryStepId,
  prevStoryStepId,
  storyStepById,
  type StoryStepId,
} from "../src/ui/storyScript.ts";

/** Shipped tour slugs in canonical order. */
const SHIPPED_IDS: readonly StoryStepId[] = ["wavefront", "sorting", "pivots", "forest", "race"];

describe("STORY_TOUR_IDS", () => {
  it("equals wavefront, sorting, pivots, forest, race in order", () => {
    expect([...STORY_TOUR_IDS]).toEqual([...SHIPPED_IDS]);
  });

  it("includes forest slug after pivots", () => {
    const pivotsIndex = STORY_TOUR_IDS.indexOf("pivots");
    expect(STORY_TOUR_IDS[pivotsIndex + 1]).toBe("forest");
  });
});

describe("STORY_STEPS", () => {
  it("ids match STORY_TOUR_IDS order", () => {
    expect(STORY_STEPS.map((step) => step.id)).toEqual([...STORY_TOUR_IDS]);
  });

  it("includes forest beat after pivots", () => {
    const forestIndex = STORY_STEPS.findIndex((step) => step.id === "forest");
    expect(forestIndex).toBeGreaterThan(-1);
    expect(STORY_STEPS[forestIndex - 1]?.id).toBe("pivots");
    expect(STORY_STEPS[forestIndex + 1]?.id).toBe("race");
  });

  it("every caption length is in (0, 220]", () => {
    for (const step of STORY_STEPS) {
      expect(step.caption.length).toBeGreaterThan(0);
      expect(step.caption.length).toBeLessThanOrEqual(220);
    }
  });

  it("sorting step callout is comparisons; others null", () => {
    for (const step of STORY_STEPS) {
      if (step.id === "sorting") {
        expect(step.callout).toBe("comparisons");
      } else {
        expect(step.callout).toBeNull();
      }
    }
  });

  it("wavefront layout dijkstra; pivots bmssp; forest dmsy; race both", () => {
    expect(storyStepById("wavefront").layout).toBe("dijkstra");
    expect(storyStepById("pivots").layout).toBe("bmssp");
    expect(storyStepById("forest").layout).toBe("dmsy");
    expect(storyStepById("race").layout).toBe("both");
  });
});

describe("STORY_FOREST_INSERT_AFTER", () => {
  it("is pivots", () => {
    expect(STORY_FOREST_INSERT_AFTER).toBe("pivots");
  });
});

describe("STORY_PRESET", () => {
  it("is city / 500 / seed 1729", () => {
    expect(STORY_PRESET).toEqual({ g: "city", n: 500, seed: 1729 });
  });
});

describe("isShippedStoryStepId", () => {
  it("returns true for forest", () => {
    expect(isShippedStoryStepId("forest")).toBe(true);
  });

  it("returns true for each shipped beat", () => {
    for (const id of SHIPPED_IDS) {
      expect(isShippedStoryStepId(id)).toBe(true);
    }
  });
});

describe("storyStepById", () => {
  it("returns forest beat definition", () => {
    const forest = storyStepById("forest");
    expect(forest.layout).toBe("dmsy");
    expect(forest.startFrac).toBe(0);
    expect(forest.endFrac).toBe(0.7);
  });
});

describe("nextStoryStepId", () => {
  it("returns sorting after wavefront", () => {
    expect(nextStoryStepId("wavefront")).toBe("sorting");
  });

  it("returns forest after pivots", () => {
    expect(nextStoryStepId("pivots")).toBe("forest");
  });

  it("returns race after forest", () => {
    expect(nextStoryStepId("forest")).toBe("race");
  });

  it("returns null after race", () => {
    expect(nextStoryStepId("race")).toBeNull();
  });
});

describe("prevStoryStepId", () => {
  it("returns null before wavefront", () => {
    expect(prevStoryStepId("wavefront")).toBeNull();
  });

  it("returns forest before race", () => {
    expect(prevStoryStepId("race")).toBe("forest");
  });

  it("returns pivots before forest", () => {
    expect(prevStoryStepId("forest")).toBe("pivots");
  });
});
