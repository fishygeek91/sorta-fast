import { describe, expect, it } from "vitest";

import { LANE_TILE } from "../src/ui/exportSheet.ts";
import {
  RACE_LANE_CSS_PX,
  RACE_LANE_DPR_CAP,
  raceBackingStorePx,
  racePixelScale,
} from "../src/ui/raceLaneSize.ts";

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

describe("issue #79 racePixelScale", () => {
  it("returns 1 when backing matches CSS width", () => {
    expect(racePixelScale(560, 560)).toBe(1);
  });

  it("returns 2 when backing is 2× CSS width", () => {
    expect(racePixelScale(1120, 560)).toBe(2);
  });

  it("falls back to RACE_LANE_CSS_PX when clientWidth is 0", () => {
    expect(racePixelScale(800, 0)).toBe(800 / RACE_LANE_CSS_PX);
    expect(racePixelScale(800, 0)).toBe(2);
  });

  it("falls back to RACE_LANE_CSS_PX when clientWidth is negative", () => {
    expect(racePixelScale(400, -10)).toBe(400 / RACE_LANE_CSS_PX);
    expect(racePixelScale(400, -10)).toBe(1);
  });

  it("throws when backingPx is 0, NaN, Infinity, or negative", () => {
    expect(() => racePixelScale(0, 560)).toThrow(
      "racePixelScale: backingPx must be a finite number >= 1, got 0",
    );
    expect(() => racePixelScale(NaN, 560)).toThrow(
      "racePixelScale: backingPx must be a finite number >= 1, got NaN",
    );
    expect(() => racePixelScale(Infinity, 560)).toThrow(
      "racePixelScale: backingPx must be a finite number >= 1, got Infinity",
    );
    expect(() => racePixelScale(-1, 560)).toThrow(
      "racePixelScale: backingPx must be a finite number >= 1, got -1",
    );
  });
});
