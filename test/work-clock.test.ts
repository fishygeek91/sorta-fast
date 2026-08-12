import { describe, expect, it } from "vitest";

import { BASE_OPS_PER_SECOND, WorkClock } from "../src/harness/workClock.ts";

describe("WorkClock", () => {
  it("starts at cursor 0, paused, speed 1", () => {
    const clock = new WorkClock();
    expect(clock.cursor).toBe(0);
    expect(clock.playing).toBe(false);
    expect(clock.speed).toBe(1);
  });

  it("play then advance(1) bills BASE_OPS_PER_SECOND", () => {
    const clock = new WorkClock();
    clock.play();
    const cursor = clock.advance(1);
    expect(cursor).toBe(BASE_OPS_PER_SECOND);
    expect(clock.cursor).toBe(BASE_OPS_PER_SECOND);
  });

  it("pause then advance does not change cursor", () => {
    const clock = new WorkClock();
    clock.play();
    clock.advance(1);
    clock.pause();
    const cursor = clock.advance(1);
    expect(cursor).toBe(BASE_OPS_PER_SECOND);
    expect(clock.cursor).toBe(BASE_OPS_PER_SECOND);
  });

  it("setSpeed(2) play advance(1) bills 2 * BASE_OPS_PER_SECOND", () => {
    const clock = new WorkClock();
    clock.setSpeed(2);
    clock.play();
    const cursor = clock.advance(1);
    expect(cursor).toBe(2 * BASE_OPS_PER_SECOND);
    expect(clock.cursor).toBe(2 * BASE_OPS_PER_SECOND);
  });

  it("setSpeed(-1) throws", () => {
    const clock = new WorkClock();
    expect(() => clock.setSpeed(-1)).toThrow(/speed must be >= 0/);
  });

  it("advance(-0.1) throws", () => {
    const clock = new WorkClock();
    clock.play();
    expect(() => clock.advance(-0.1)).toThrow(/dtSeconds must be >= 0/);
  });

  it("seek(-1) throws", () => {
    const clock = new WorkClock();
    expect(() => clock.seek(-1)).toThrow(/t must be >= 0/);
  });

  it("seek(100) sets cursor without changing playing", () => {
    const clock = new WorkClock();
    clock.play();
    clock.seek(100);
    expect(clock.cursor).toBe(100);
    expect(clock.playing).toBe(true);
  });
});
