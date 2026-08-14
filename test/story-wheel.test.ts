import { describe, expect, it } from "vitest";

import { STORY_WHEEL_COOLDOWN_MS, decideStoryWheel } from "../src/ui/storyWheel.ts";

describe("STORY_WHEEL_COOLDOWN_MS", () => {
  it("is 600", () => {
    expect(STORY_WHEEL_COOLDOWN_MS).toBe(600);
  });
});

describe("decideStoryWheel", () => {
  it("700px in one call yields exactly one next and resets accumulator", () => {
    const result = decideStoryWheel({
      accumulator: 0,
      lastStepMs: 0,
      deltaY: 700,
      nowMs: 10_000,
      allowNext: true,
      allowBack: true,
    });
    expect(result).toEqual({
      action: "next",
      accumulator: 0,
      lastStepMs: 10_000,
    });
  });

  it("six 120px ticks at the same nowMs emit only one next", () => {
    let accumulator = 0;
    let lastStepMs = 0;
    const nowMs = 10_000;

    for (let tick = 0; tick < 6; tick += 1) {
      const result = decideStoryWheel({
        accumulator,
        lastStepMs,
        deltaY: 120,
        nowMs,
        allowNext: true,
        allowBack: true,
      });
      if (tick === 0) {
        expect(result.action).toBe("next");
        expect(result.lastStepMs).toBe(nowMs);
      } else {
        expect(result.action).toBe("none");
        expect(result.lastStepMs).toBe(nowMs);
      }
      accumulator = result.accumulator;
      lastStepMs = result.lastStepMs;
    }
    expect(accumulator).toBe(0);
  });

  it("may step again after cooldown plus another 120px tick", () => {
    const first = decideStoryWheel({
      accumulator: 0,
      lastStepMs: 0,
      deltaY: 120,
      nowMs: 10_000,
      allowNext: true,
      allowBack: true,
    });
    expect(first.action).toBe("next");
    expect(first.lastStepMs).toBe(10_000);

    const second = decideStoryWheel({
      accumulator: first.accumulator,
      lastStepMs: first.lastStepMs,
      deltaY: 120,
      nowMs: 10_000 + STORY_WHEEL_COOLDOWN_MS,
      allowNext: true,
      allowBack: true,
    });
    expect(second).toEqual({
      action: "next",
      accumulator: 0,
      lastStepMs: 10_000 + STORY_WHEEL_COOLDOWN_MS,
    });
  });

  it("allowNext false at 700px consumes burst without stepping", () => {
    const nowMs = 10_000;
    const first = decideStoryWheel({
      accumulator: 0,
      lastStepMs: 0,
      deltaY: 700,
      nowMs,
      allowNext: false,
      allowBack: true,
    });
    expect(first).toEqual({
      action: "none",
      accumulator: 0,
      lastStepMs: nowMs,
    });

    const second = decideStoryWheel({
      accumulator: 0,
      lastStepMs: first.lastStepMs,
      deltaY: 700,
      nowMs,
      allowNext: false,
      allowBack: true,
    });
    expect(second).toEqual({
      action: "none",
      accumulator: 0,
      lastStepMs: nowMs,
    });
  });

  it("allowBack false on -700px consumes burst without stepping back", () => {
    const result = decideStoryWheel({
      accumulator: 0,
      lastStepMs: 0,
      deltaY: -700,
      nowMs: 10_000,
      allowNext: true,
      allowBack: false,
    });
    expect(result).toEqual({
      action: "none",
      accumulator: 0,
      lastStepMs: 10_000,
    });
  });

  it("allowBack true on -700px yields back", () => {
    const result = decideStoryWheel({
      accumulator: 0,
      lastStepMs: 0,
      deltaY: -700,
      nowMs: 10_000,
      allowNext: true,
      allowBack: true,
    });
    expect(result).toEqual({
      action: "back",
      accumulator: 0,
      lastStepMs: 10_000,
    });
  });

  it("cooldown swallows leftover accumulator when lastStepMs equals nowMs", () => {
    const nowMs = 10_000;
    const result = decideStoryWheel({
      accumulator: 50,
      lastStepMs: nowMs,
      deltaY: 120,
      nowMs,
      allowNext: true,
      allowBack: true,
    });
    expect(result).toEqual({
      action: "none",
      accumulator: 0,
      lastStepMs: nowMs,
    });
  });

  it("accumulates sub-threshold ticks across calls at the same nowMs", () => {
    const nowMs = 10_000;
    const first = decideStoryWheel({
      accumulator: 0,
      lastStepMs: 0,
      deltaY: 40,
      nowMs,
      allowNext: true,
      allowBack: true,
    });
    expect(first).toEqual({
      action: "none",
      accumulator: 40,
      lastStepMs: 0,
    });

    const second = decideStoryWheel({
      accumulator: first.accumulator,
      lastStepMs: first.lastStepMs,
      deltaY: 40,
      nowMs,
      allowNext: true,
      allowBack: true,
    });
    expect(second).toEqual({
      action: "next",
      accumulator: 0,
      lastStepMs: nowMs,
    });
  });

  it("during cooldown ignores deltaY and clears accumulator", () => {
    const lastStepMs = 10_000;
    const nowMs = lastStepMs + STORY_WHEEL_COOLDOWN_MS - 1;
    const result = decideStoryWheel({
      accumulator: 75,
      lastStepMs,
      deltaY: 500,
      nowMs,
      allowNext: true,
      allowBack: true,
    });
    expect(result).toEqual({
      action: "none",
      accumulator: 0,
      lastStepMs: lastStepMs,
    });
  });
});
