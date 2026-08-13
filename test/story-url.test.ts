import { describe, expect, it } from "vitest";

import { parseRaceUrl } from "../src/ui/raceUrl.ts";
import {
  DEFAULT_STORY_URL,
  isStorySearch,
  parseStoryUrl,
  serializeStoryUrl,
  type StoryUrlState,
} from "../src/ui/storyUrl.ts";

describe("parseStoryUrl", () => {
  it("returns defaults on empty input", () => {
    expect(parseStoryUrl("")).toEqual(DEFAULT_STORY_URL);
    expect(parseStoryUrl("?")).toEqual(DEFAULT_STORY_URL);
    expect(parseStoryUrl(new URLSearchParams())).toEqual(DEFAULT_STORY_URL);
  });

  it("round-trips a full state with t greater than zero", () => {
    const state: StoryUrlState = {
      g: "maze",
      n: 1200,
      seed: 99,
      step: "pivots",
      t: 48210,
    };
    const query = serializeStoryUrl(state);
    expect(parseStoryUrl(query)).toEqual(state);
  });

  it("falls back field-by-field on invalid g, n, seed, and t", () => {
    expect(parseStoryUrl("?g=grid")).toEqual(DEFAULT_STORY_URL);
    expect(parseStoryUrl("?n=0")).toEqual({ ...DEFAULT_STORY_URL, n: DEFAULT_STORY_URL.n });
    expect(parseStoryUrl("?n=-5")).toEqual({ ...DEFAULT_STORY_URL, n: DEFAULT_STORY_URL.n });
    expect(parseStoryUrl("?seed=1.5")).toEqual({
      ...DEFAULT_STORY_URL,
      seed: DEFAULT_STORY_URL.seed,
    });
    expect(parseStoryUrl("?t=-1")).toEqual({ ...DEFAULT_STORY_URL, t: 0 });
    expect(parseStoryUrl("?t=abc")).toEqual({ ...DEFAULT_STORY_URL, t: 0 });
  });

  it("defaults step to wavefront when missing, invalid, empty, or forest", () => {
    expect(parseStoryUrl("?step=wavefront")).toEqual({ ...DEFAULT_STORY_URL, step: "wavefront" });
    expect(parseStoryUrl("?step=")).toEqual(DEFAULT_STORY_URL);
    expect(parseStoryUrl("?step=invalid")).toEqual(DEFAULT_STORY_URL);
    expect(parseStoryUrl("?step=forest")).toEqual(DEFAULT_STORY_URL);
    expect(parseStoryUrl("?g=city&n=500&seed=1729")).toEqual(DEFAULT_STORY_URL);
  });
});

describe("serializeStoryUrl", () => {
  it("omits t from serialize when zero", () => {
    const state: StoryUrlState = {
      g: "city",
      n: 500,
      seed: 1729,
      step: "race",
      t: 0,
    };
    const query = serializeStoryUrl(state);
    expect(query).not.toContain("t=");
    expect(parseStoryUrl(query)).toEqual(state);
  });

  it("always includes mode=story", () => {
    const query = serializeStoryUrl(DEFAULT_STORY_URL);
    expect(query).toContain("mode=story");
    const params = new URLSearchParams(query.slice(1));
    expect(params.get("mode")).toBe("story");
  });

  it("throws when step is reserved forest slug", () => {
    expect(() => serializeStoryUrl({ ...DEFAULT_STORY_URL, step: "forest" })).toThrow(
      /unshipped story step/i,
    );
  });
});

describe("isStorySearch", () => {
  it("returns true only for mode=story", () => {
    expect(isStorySearch("?mode=story")).toBe(true);
    expect(isStorySearch("?mode=race")).toBe(false);
    expect(isStorySearch("?mode=lens")).toBe(false);
    expect(isStorySearch("")).toBe(false);
  });
});

describe("story vs race URL dispatch", () => {
  it("parseRaceUrl with mode=story still yields mode race (Story is a raw peek, not RaceMode)", () => {
    expect(parseRaceUrl("?mode=story").mode).toBe("race");
  });
});
