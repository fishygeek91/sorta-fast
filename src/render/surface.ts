/**
 * Shared canvas surface types for the layered renderer (issue #6).
 *
 * Production code uses {@link createDomSurface}; tests supply their own
 * {@link SurfaceFactory}. Renderer modules must not import from `test/`.
 */

/** Minimal Canvas2D draw API used by the layered renderer. */
export type DrawContext = {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
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
  ): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
  putImageData(
    imageData: ImageData,
    dx: number,
    dy: number,
    dirtyX: number,
    dirtyY: number,
    dirtyWidth: number,
    dirtyHeight: number,
  ): void;
};

/** Offscreen or on-screen bitmap the renderer can target or blit. */
export type CanvasSurface = {
  width: number;
  height: number;
  getContext(id: "2d"): DrawContext | null;
};

/** Allocate a width×height surface (DOM canvas in the browser, fake in tests). */
export type SurfaceFactory = (width: number, height: number) => CanvasSurface;
