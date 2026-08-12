/**
 * Headless Canvas2D stub for Vitest (issues #6/#7).
 *
 * Records every draw call so renderer tests can assert layering, dirty rects,
 * and settle-gradient fills without a real browser canvas.
 */

import type { CanvasSurface, DrawContext } from "../../src/render/surface.ts";

/** One recorded 2D draw operation plus optional style snapshot. */
export type DrawCall = {
  op: string;
  args: readonly unknown[];
  fillStyle?: string;
  strokeStyle?: string;
};

/** CanvasRenderingContext2D-shaped recorder; no pixels are drawn. */
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
      pushCall("clearRect", [x, y, w, h]);
    },
    fillRect(x: number, y: number, w: number, h: number): void {
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
  };

  return surface;
}
