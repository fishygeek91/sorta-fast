import { describe, expect, it } from "vitest";

import {
  createFakeSurface,
  createTestImageData,
  getFakeContext,
  pixelAt,
} from "./helpers/fake-canvas.ts";

describe("fake-canvas pixel buffer", () => {
  it("putImageData then getImageData round-trips a 2x2 red square", () => {
    const surface = createFakeSurface(8, 8);
    const ctx = getFakeContext(surface);

    const source = createTestImageData(2, 2);

    source.data[0] = 255;
    source.data[1] = 0;
    source.data[2] = 0;
    source.data[3] = 255;
    source.data[4] = 255;
    source.data[5] = 0;
    source.data[6] = 0;
    source.data[7] = 255;
    source.data[8] = 255;
    source.data[9] = 0;
    source.data[10] = 0;
    source.data[11] = 255;
    source.data[12] = 255;
    source.data[13] = 0;
    source.data[14] = 0;
    source.data[15] = 255;

    ctx.putImageData(source, 3, 4);

    expect(ctx.calls.some((call) => call.op === "putImageData")).toBe(true);
    expect(pixelAt(surface, 3, 4)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(pixelAt(surface, 4, 5)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    const readBack = ctx.getImageData(3, 4, 2, 2);
    expect(readBack.width).toBe(2);
    expect(readBack.height).toBe(2);
    expect(readBack.data[0]).toBe(255);
    expect(readBack.data[1]).toBe(0);
    expect(readBack.data[2]).toBe(0);
    expect(readBack.data[3]).toBe(255);
    expect(readBack.data[12]).toBe(255);
    expect(readBack.data[13]).toBe(0);
    expect(readBack.data[14]).toBe(0);
    expect(readBack.data[15]).toBe(255);
  });

  it("clearRect zeros pixels in the buffer", () => {
    const surface = createFakeSurface(6, 6);
    const ctx = getFakeContext(surface);

    ctx.fillStyle = "rgb(10, 20, 30)";
    ctx.fillRect(1, 1, 3, 3);
    expect(pixelAt(surface, 2, 2)).toEqual({ r: 10, g: 20, b: 30, a: 255 });

    ctx.clearRect(1, 1, 3, 3);
    expect(pixelAt(surface, 2, 2)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(pixelAt(surface, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
