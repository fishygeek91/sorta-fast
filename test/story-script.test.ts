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
const SHIPPED_IDS: readonly StoryStepId[] = ["wavefront", "sorting", "pivots", "race"];

describe("STORY_TOUR_IDS", () => {
  it("equals wavefront, sorting, pivots, race in order", () => {
    expect([...STORY_TOUR_IDS]).toEqual([...SHIPPED_IDS]);
  });

  it("excludes reserved forest slug", () => {
    expect(STORY_TOUR_IDS).not.toContain("forest");
  });
});

describe("STORY_STEPS", () => {
  it("ids match STORY_TOUR_IDS order", () => {
    expect(STORY_STEPS.map((step) => step.id)).toEqual([...STORY_TOUR_IDS]);
  });

  it("does not include forest beat", () => {
    expect(STORY_STEPS.some((step) => step.id === "forest")).toBe(false);
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

  it("wavefront layout dijkstra; pivots bmssp; race both", () => {
    expect(storyStepById("wavefront").layout).toBe("dijkstra");
    expect(storyStepById("pivots").layout).toBe("bmssp");
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
  it("returns false for forest", () => {
    expect(isShippedStoryStepId("forest")).toBe(false);
  });

  it("returns true for each shipped beat", () => {
    for (const id of SHIPPED_IDS) {
      expect(isShippedStoryStepId(id)).toBe(true);
    }
  });
});

describe("storyStepById", () => {
  it("throws for reserved forest slug", () => {
    expect(() => storyStepById("forest")).toThrow(/not shipped/i);
  });
});

describe("nextStoryStepId", () => {
  it("returns sorting after wavefront", () => {
    expect(nextStoryStepId("wavefront")).toBe("sorting");
  });

  it("returns null after race", () => {
    expect(nextStoryStepId("race")).toBeNull();
  });
});

describe("prevStoryStepId", () => {
  it("returns null before wavefront", () => {
    expect(prevStoryStepId("wavefront")).toBeNull();
  });

  it("returns pivots before race", () => {
    expect(prevStoryStepId("race")).toBe("pivots");
  });
});
