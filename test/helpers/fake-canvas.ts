/**
 * Headless Canvas2D stub for Vitest (issues #6/#7, #20).
 *
 * Records every draw call and maintains a real RGBA pixel buffer so renderer
 * tests can assert layering, dirty rects, settle-gradient fills, and
 * ImageData round-trips without a real browser canvas.
 */

import type { CanvasSurface, DrawContext } from "../../src/render/surface.ts";

/** One recorded 2D draw operation plus optional style snapshot. */
export type DrawCall = {
  op: string;
  args: readonly unknown[];
  fillStyle?: string;
  strokeStyle?: string;
};

/** RGBA sample at one canvas pixel. */
export type PixelColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

/** CanvasRenderingContext2D-shaped recorder with a backing pixel buffer. */
export type FakeRenderingContext = DrawContext & {
  readonly canvas: CanvasSurface;
  strokeRect(x: number, y: number, w: number, h: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  readonly calls: DrawCall[];
};

/** Surface returned by {@link createFakeSurface}; context is always a recorder. */
export type FakeCanvasSurface = {
  width: number;
  height: number;
  getContext(id: "2d"): FakeRenderingContext | null;
};

type ContextState = {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
};

const DEFAULT_FILL = "#000000";
const DEFAULT_STROKE = "#000000";

/** Matches `rgb(r, g, b)` CSS literals used by fillStyle. */
const RGB_FILL_RE = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;

/** Matches `rgba(r, g, b, a)` CSS literals used by fillStyle. */
const RGBA_FILL_RE = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/;

/** WeakMap from fake surface to its RGBA buffer (length width*height*4). */
const pixelsBySurface = new WeakMap<FakeCanvasSurface, Uint8ClampedArray>();

/**
 * Allocate an {@link ImageData}-compatible object for the current test runtime.
 *
 * Vitest uses `environment: "node"` where `ImageData` is often undefined; a
 * plain `{ data, width, height }` object satisfies {@link DrawContext}.
 */
function createImageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  const pixelData = data ?? new Uint8ClampedArray(width * height * 4);
  if (typeof ImageData !== "undefined") {
    const imageData = new ImageData(width, height);
    imageData.data.set(pixelData);
    return imageData;
  }
  return {
    data: pixelData,
    width,
    height,
    colorSpace: "srgb",
  };
}

/**
 * Clamp a rectangle to the canvas bounds and return an empty rect when disjoint.
 */
function clampRect(
  x: number,
  y: number,
  w: number,
  h: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(canvasWidth, x + w);
  const y1 = Math.min(canvasHeight, y + h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Parse fillStyle into RGBA bytes; returns null when the color is unsupported.
 */
function parseFillStyle(fillStyle: string, globalAlpha: number): PixelColor | null {
  const rgbMatch = RGB_FILL_RE.exec(fillStyle);
  if (rgbMatch !== null) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
      a: Math.round(globalAlpha * 255),
    };
  }

  const rgbaMatch = RGBA_FILL_RE.exec(fillStyle);
  if (rgbaMatch !== null) {
    return {
      r: Number(rgbaMatch[1]),
      g: Number(rgbaMatch[2]),
      b: Number(rgbaMatch[3]),
      a: Math.round(Number(rgbaMatch[4]) * globalAlpha * 255),
    };
  }

  return null;
}

/**
 * Allocate a width×height {@link ImageData} for tests (works without global `ImageData`).
 */
export function createTestImageData(width: number, height: number): ImageData {
  return createImageData(width, height);
}

/**
 * Return the fake 2D context from a surface created by {@link createFakeSurface}.
 *
 * @throws If the surface has no 2d context.
 */
export function getFakeContext(surface: FakeCanvasSurface): FakeRenderingContext {
  const ctx = surface.getContext("2d");
  if (ctx === null) {
    throw new Error("expected 2d context");
  }
  return ctx;
}

/**
 * Read one RGBA pixel from a fake surface buffer.
 *
 * @throws If `x` or `y` is out of bounds.
 */
export function pixelAt(surface: FakeCanvasSurface, x: number, y: number): PixelColor {
  const pixels = pixelsBySurface.get(surface);
  if (pixels === undefined) {
    throw new Error("pixelAt: surface has no pixel buffer");
  }
  if (!Number.isInteger(x) || x < 0 || x >= surface.width) {
    throw new Error(`pixelAt: x out of bounds, got ${String(x)}`);
  }
  if (!Number.isInteger(y) || y < 0 || y >= surface.height) {
    throw new Error(`pixelAt: y out of bounds, got ${String(y)}`);
  }

  const offset = (y * surface.width + x) * 4;
  return {
    r: pixels[offset],
    g: pixels[offset + 1],
    b: pixels[offset + 2],
    a: pixels[offset + 3],
  };
}

/**
 * @throws If `width` or `height` is not an integer >= 1.
 */
export function createFakeSurface(width: number, height: number): FakeCanvasSurface {
  if (!Number.isInteger(width) || width < 1) {
    throw new Error(`width must be an integer >= 1, got ${String(width)}`);
  }
  if (!Number.isInteger(height) || height < 1) {
    throw new Error(`height must be an integer >= 1, got ${String(height)}`);
  }

  const calls: DrawCall[] = [];
  const stateStack: ContextState[] = [];
  const pixels = new Uint8ClampedArray(width * height * 4);

  let fillStyle = DEFAULT_FILL;
  let strokeStyle = DEFAULT_STROKE;
  let lineWidth = 1;
  let globalAlpha = 1;

  const snapshotState = (): ContextState => ({
    fillStyle,
    strokeStyle,
    lineWidth,
    globalAlpha,
  });

  const restoreState = (state: ContextState): void => {
    fillStyle = state.fillStyle;
    strokeStyle = state.strokeStyle;
    lineWidth = state.lineWidth;
    globalAlpha = state.globalAlpha;
  };

  const pushCall = (op: string, args: readonly unknown[]): void => {
    const call: DrawCall = { op, args };
    if (op === "fill" || op === "fillRect") {
      call.fillStyle = fillStyle;
    }
    if (op === "stroke" || op === "strokeRect") {
      call.strokeStyle = strokeStyle;
    }
    calls.push(call);
  };

  const writePixel = (px: number, py: number, color: PixelColor): void => {
    if (px < 0 || py < 0 || px >= width || py >= height) {
      return;
    }
    const offset = (py * width + px) * 4;
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
    pixels[offset + 3] = color.a;
  };

  const clearRectPixels = (x: number, y: number, w: number, h: number): void => {
    const rect = clampRect(x, y, w, h, width, height);
    if (rect.w === 0 || rect.h === 0) {
      return;
    }
    if (rect.x === 0 && rect.y === 0 && rect.w === width && rect.h === height) {
      pixels.fill(0);
      return;
    }
    for (let py = rect.y; py < rect.y + rect.h; py += 1) {
      for (let px = rect.x; px < rect.x + rect.w; px += 1) {
        writePixel(px, py, { r: 0, g: 0, b: 0, a: 0 });
      }
    }
  };

  /** Small rects stay pixel-accurate; large perf-test fills skip per-pixel writes. */
  const FILL_RECT_PIXEL_BUDGET = 256;

  const fillRectPixels = (x: number, y: number, w: number, h: number): void => {
    const color = parseFillStyle(fillStyle, globalAlpha);
    if (color === null) {
      return;
    }
    const rect = clampRect(x, y, w, h, width, height);
    if (rect.w === 0 || rect.h === 0) {
      return;
    }
    if (rect.w * rect.h > FILL_RECT_PIXEL_BUDGET) {
      return;
    }
    for (let py = rect.y; py < rect.y + rect.h; py += 1) {
      for (let px = rect.x; px < rect.x + rect.w; px += 1) {
        writePixel(px, py, color);
      }
    }
  };

  const surface: FakeCanvasSurface = {
    width,
    height,
    getContext(id: "2d"): FakeRenderingContext | null {
      if (id !== "2d") {
        return null;
      }
      return context;
    },
  };

  pixelsBySurface.set(surface, pixels);

  const context: FakeRenderingContext = {
    get fillStyle(): string {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    get strokeStyle(): string {
      return strokeStyle;
    },
    set strokeStyle(value: string) {
      strokeStyle = value;
    },
    get lineWidth(): number {
      return lineWidth;
    },
    set lineWidth(value: number) {
      lineWidth = value;
    },
    get globalAlpha(): number {
      return globalAlpha;
    },
    set globalAlpha(value: number) {
      globalAlpha = value;
    },
    get canvas(): CanvasSurface {
      return surface;
    },
    get calls(): DrawCall[] {
      return calls;
    },
    save(): void {
      stateStack.push(snapshotState());
      pushCall("save", []);
    },
    restore(): void {
      const prior = stateStack.pop();
      if (prior !== undefined) {
        restoreState(prior);
      }
      pushCall("restore", []);
    },
    beginPath(): void {
      pushCall("beginPath", []);
    },
    closePath(): void {
      pushCall("closePath", []);
    },
    rect(x: number, y: number, w: number, h: number): void {
      pushCall("rect", [x, y, w, h]);
    },
    arc(x: number, y: number, r: number, a0: number, a1: number): void {
      pushCall("arc", [x, y, r, a0, a1]);
    },
    fill(): void {
      pushCall("fill", []);
    },
    stroke(): void {
      pushCall("stroke", []);
    },
    clip(): void {
      pushCall("clip", []);
    },
    clearRect(x: number, y: number, w: number, h: number): void {
      clearRectPixels(x, y, w, h);
      pushCall("clearRect", [x, y, w, h]);
    },
    fillRect(x: number, y: number, w: number, h: number): void {
      fillRectPixels(x, y, w, h);
      pushCall("fillRect", [x, y, w, h]);
    },
    strokeRect(x: number, y: number, w: number, h: number): void {
      pushCall("strokeRect", [x, y, w, h]);
    },
    drawImage(
      _image: CanvasSurface,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ): void {
      pushCall("drawImage", ["surface", sx, sy, sw, sh, dx, dy, dw, dh]);
    },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
      pushCall("setTransform", [a, b, c, d, e, f]);
    },
    translate(x: number, y: number): void {
      pushCall("translate", [x, y]);
    },
    scale(x: number, y: number): void {
      pushCall("scale", [x, y]);
    },
    moveTo(x: number, y: number): void {
      pushCall("moveTo", [x, y]);
    },
    lineTo(x: number, y: number): void {
      pushCall("lineTo", [x, y]);
    },
    getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
      const rect = clampRect(sx, sy, sw, sh, width, height);
      const data = new Uint8ClampedArray(rect.w * rect.h * 4);

      for (let row = 0; row < rect.h; row += 1) {
        const srcY = rect.y + row;
        const srcOffset = (srcY * width + rect.x) * 4;
        const dstOffset = row * rect.w * 4;
        data.set(pixels.subarray(srcOffset, srcOffset + rect.w * 4), dstOffset);
      }

      return createImageData(rect.w, rect.h, data);
    },
    putImageData(
      imageData: ImageData,
      dx: number,
      dy: number,
      dirtyX?: number,
      dirtyY?: number,
      dirtyWidth?: number,
      dirtyHeight?: number,
    ): void {
      const hasDirty =
        dirtyX !== undefined &&
        dirtyY !== undefined &&
        dirtyWidth !== undefined &&
        dirtyHeight !== undefined;

      const sourceX = hasDirty ? dirtyX : 0;
      const sourceY = hasDirty ? dirtyY : 0;
      const sourceW = hasDirty ? dirtyWidth : imageData.width;
      const sourceH = hasDirty ? dirtyHeight : imageData.height;

      for (let row = 0; row < sourceH; row += 1) {
        for (let col = 0; col < sourceW; col += 1) {
          const srcOffset = ((sourceY + row) * imageData.width + (sourceX + col)) * 4;
          writePixel(dx + sourceX + col, dy + sourceY + row, {
            r: imageData.data[srcOffset],
            g: imageData.data[srcOffset + 1],
            b: imageData.data[srcOffset + 2],
            a: imageData.data[srcOffset + 3],
          });
        }
      }

      if (hasDirty) {
        pushCall("putImageData", [imageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight]);
      } else {
        pushCall("putImageData", [imageData, dx, dy]);
      }
    },
  };

  return surface;
}
