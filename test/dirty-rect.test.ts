import { describe, expect, it } from "vitest";

import {
  createDirtyRect,
  DIRTY_HIT_CAP,
  includeNode,
  resetDirty,
} from "../src/render/dirtyRect.ts";

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 300;
const RADIUS = 5;

function expectedNodeBounds(
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const x1 = Math.min(CANVAS_WIDTH - 1, Math.floor(cx + radius + 1));
  const y1 = Math.min(CANVAS_HEIGHT - 1, Math.floor(cy + radius + 1));
  return {
    x: x0,
    y: y0,
    w: x1 - x0 + 1,
    h: y1 - y0 + 1,
  };
}

describe("dirtyRect", () => {
  it("createDirtyRect starts empty", () => {
    const dirty = createDirtyRect();
    expect(dirty).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      full: false,
      hits: 0,
    });
  });

  it("includeNode sets positive bounds for one circle", () => {
    const dirty = createDirtyRect();
    const cx = 50;
    const cy = 60;

    includeNode(dirty, cx, cy, RADIUS, CANVAS_WIDTH, CANVAS_HEIGHT);

    const expected = expectedNodeBounds(cx, cy, RADIUS);
    expect(dirty.w).toBeGreaterThan(0);
    expect(dirty.h).toBeGreaterThan(0);
    expect(dirty.x).toBe(expected.x);
    expect(dirty.y).toBe(expected.y);
    expect(dirty.w).toBe(expected.w);
    expect(dirty.h).toBe(expected.h);
    expect(dirty.full).toBe(false);
    expect(dirty.hits).toBe(1);
  });

  it("includeNode unions bounds for two nodes", () => {
    const dirty = createDirtyRect();
    const first = { cx: 50, cy: 50 };
    const second = { cx: 200, cy: 150 };

    includeNode(dirty, first.cx, first.cy, RADIUS, CANVAS_WIDTH, CANVAS_HEIGHT);
    const afterFirst = { x: dirty.x, y: dirty.y, w: dirty.w, h: dirty.h };

    includeNode(dirty, second.cx, second.cy, RADIUS, CANVAS_WIDTH, CANVAS_HEIGHT);

    expect(dirty.w).toBeGreaterThan(afterFirst.w);
    expect(dirty.h).toBeGreaterThan(afterFirst.h);

    const unionX0 = Math.min(afterFirst.x, expectedNodeBounds(second.cx, second.cy, RADIUS).x);
    const unionY0 = Math.min(afterFirst.y, expectedNodeBounds(second.cx, second.cy, RADIUS).y);
    const firstX1 = afterFirst.x + afterFirst.w - 1;
    const firstY1 = afterFirst.y + afterFirst.h - 1;
    const secondBounds = expectedNodeBounds(second.cx, second.cy, RADIUS);
    const unionX1 = Math.max(firstX1, secondBounds.x + secondBounds.w - 1);
    const unionY1 = Math.max(firstY1, secondBounds.y + secondBounds.h - 1);

    expect(dirty.x).toBe(unionX0);
    expect(dirty.y).toBe(unionY0);
    expect(dirty.w).toBe(unionX1 - unionX0 + 1);
    expect(dirty.h).toBe(unionY1 - unionY0 + 1);
    expect(dirty.hits).toBe(2);
  });

  it(`marks full after ${String(DIRTY_HIT_CAP + 1)} includeNode calls`, () => {
    const dirty = createDirtyRect();

    for (let i = 0; i <= DIRTY_HIT_CAP; i += 1) {
      includeNode(dirty, 10 + i, 20, RADIUS, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    expect(dirty.hits).toBe(DIRTY_HIT_CAP + 1);
    expect(dirty.full).toBe(true);
    expect(dirty.w).toBe(CANVAS_WIDTH);
    expect(dirty.h).toBe(CANVAS_HEIGHT);
  });

  it("resetDirty clears accumulated state", () => {
    const dirty = createDirtyRect();
    includeNode(dirty, 50, 50, RADIUS, CANVAS_WIDTH, CANVAS_HEIGHT);

    resetDirty(dirty);

    expect(dirty).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      full: false,
      hits: 0,
    });
  });
});
