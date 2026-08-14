import { describe, expect, it } from "vitest";

import { LANE_TILE } from "../src/ui/exportSheet.ts";
import { RACE_LANE_CSS_PX, RACE_LANE_DPR_CAP, raceBackingStorePx } from "../src/ui/raceLaneSize.ts";

describe("issue #77 race lane backing store", () => {
  it("matches CSS pixels at 1× DPR", () => {
    expect(raceBackingStorePx(560, 1)).toBe(560);
  });

  it("scales by 2× DPR", () => {
    expect(raceBackingStorePx(560, 2)).toBe(1120);
  });

  it("caps DPR at RACE_LANE_DPR_CAP", () => {
    expect(RACE_LANE_DPR_CAP).toBe(2);
    expect(raceBackingStorePx(560, 3)).toBe(1120);
  });

  it("falls back to RACE_LANE_CSS_PX times capped DPR when clientWidth is 0", () => {
    expect(raceBackingStorePx(0, 2)).toBe(RACE_LANE_CSS_PX * 2);
  });

  it("keeps export LANE_TILE equal to RACE_LANE_CSS_PX", () => {
    expect(LANE_TILE).toBe(RACE_LANE_CSS_PX);
    expect(LANE_TILE).toBe(400);
  });

  it("falls back to RACE_LANE_CSS_PX when clientWidth is negative", () => {
    expect(raceBackingStorePx(-100, 1)).toBe(RACE_LANE_CSS_PX);
  });

  it("treats non-finite DPR as 1", () => {
    expect(raceBackingStorePx(560, NaN)).toBe(560);
    expect(raceBackingStorePx(560, Infinity)).toBe(560);
  });
});
