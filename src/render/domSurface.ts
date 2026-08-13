/**
 * Browser {@link SurfaceFactory} wrapping `document.createElement("canvas")` (issue #6).
 *
 * Delegates draw calls to the real 2D context. A WeakMap links each
 * {@link CanvasSurface} wrapper back to its HTMLCanvasElement so layer
 * compositing can call `drawImage` without type assertions.
 */

import type { CanvasSurface, DrawContext } from "./surface.ts";

/** Backing element for each DOM-backed {@link CanvasSurface}. */
const canvasBySurface = new WeakMap<CanvasSurface, HTMLCanvasElement>();

/**
 * @throws If `value` is not an integer >= 1.
 */
function assertDimension(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer >= 1, got ${String(value)}`);
  }
}

/**
 * Read a canvas style property as a CSS color string.
 *
 * @throws If the browser context holds a gradient or pattern instead of a string.
 */
function readColorStyle(value: string | CanvasGradient | CanvasPattern): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error("DrawContext only supports string fillStyle/strokeStyle");
}

/**
 * Wrap a browser `CanvasRenderingContext2D` as a {@link DrawContext}.
 */
function wrapContext(ctx: CanvasRenderingContext2D): DrawContext {
  return {
    get fillStyle(): string {
      return readColorStyle(ctx.fillStyle);
    },
    set fillStyle(value: string) {
      ctx.fillStyle = value;
    },
    get strokeStyle(): string {
      return readColorStyle(ctx.strokeStyle);
    },
    set strokeStyle(value: string) {
      ctx.strokeStyle = value;
    },
    get lineWidth(): number {
      return ctx.lineWidth;
    },
    set lineWidth(value: number) {
      ctx.lineWidth = value;
    },
    get globalAlpha(): number {
      return ctx.globalAlpha;
    },
    set globalAlpha(value: number) {
      ctx.globalAlpha = value;
    },
    save(): void {
      ctx.save();
    },
    restore(): void {
      ctx.restore();
    },
    beginPath(): void {
      ctx.beginPath();
    },
    closePath(): void {
      ctx.closePath();
    },
    rect(x: number, y: number, w: number, h: number): void {
      ctx.rect(x, y, w, h);
    },
    arc(x: number, y: number, r: number, a0: number, a1: number): void {
      ctx.arc(x, y, r, a0, a1);
    },
    fill(): void {
      ctx.fill();
    },
    stroke(): void {
      ctx.stroke();
    },
    clip(): void {
      ctx.clip();
    },
    clearRect(x: number, y: number, w: number, h: number): void {
      ctx.clearRect(x, y, w, h);
    },
    fillRect(x: number, y: number, w: number, h: number): void {
      ctx.fillRect(x, y, w, h);
    },
    drawImage(
      image: CanvasSurface,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ): void {
      const sourceCanvas = canvasBySurface.get(image);
      if (sourceCanvas === undefined) {
        throw new Error("drawImage: source CanvasSurface has no backing HTMLCanvasElement");
      }
      ctx.drawImage(sourceCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
    },
    moveTo(x: number, y: number): void {
      ctx.moveTo(x, y);
    },
    lineTo(x: number, y: number): void {
      ctx.lineTo(x, y);
    },
    getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
      return ctx.getImageData(sx, sy, sw, sh);
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
      if (
        dirtyX !== undefined &&
        dirtyY !== undefined &&
        dirtyWidth !== undefined &&
        dirtyHeight !== undefined
      ) {
        ctx.putImageData(imageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight);
        return;
      }
      ctx.putImageData(imageData, dx, dy);
    },
  };
}

/**
 * Wrap an existing DOM canvas already in the page (issue #6 demo / #8 Lens).
 *
 * @param canvas - An HTMLCanvasElement with width/height already set.
 * @throws If the 2D context cannot be created.
 */
export function wrapDomCanvas(canvas: HTMLCanvasElement): CanvasSurface {
  const ctx2d = canvas.getContext("2d");
  if (ctx2d === null) {
    throw new Error("wrapDomCanvas: 2d context is unavailable");
  }

  const drawContext = wrapContext(ctx2d);

  const surface: CanvasSurface = {
    get width(): number {
      return canvas.width;
    },
    get height(): number {
      return canvas.height;
    },
    getContext(id: "2d"): DrawContext | null {
      if (id !== "2d") {
        return null;
      }
      return drawContext;
    },
  };

  canvasBySurface.set(surface, canvas);
  return surface;
}

/**
 * Create a DOM-backed {@link CanvasSurface} (not attached to the document).
 *
 * @param width - Canvas width in pixels; integer >= 1.
 * @param height - Canvas height in pixels; integer >= 1.
 * @throws If dimensions are invalid or the 2D context cannot be created.
 */
export function createDomSurface(width: number, height: number): CanvasSurface {
  assertDimension("width", width);
  assertDimension("height", height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return wrapDomCanvas(canvas);
}
