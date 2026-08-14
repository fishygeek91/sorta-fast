/**
 * Photo-finish export sheet layout and draw (issue #18).
 *
 * UI-layer compositor for PNG export: lane tiles, HUD counters, and footer
 * metadata. Does not import the renderer.
 */

import type { ThemeTokens } from "../render/theme.ts";
import { RACE_LANE_CSS_PX } from "./raceLaneSize.ts";

/** Export tile edge in CSS pixels. Live Race canvases may be clientWidth × dpr (#77). */
export const LANE_TILE = RACE_LANE_CSS_PX;

/** Outer padding on all sides of the export sheet. */
export const PAD = 24;

/** Horizontal gap between adjacent lane columns. */
export const GAP = 16;

/** Height reserved above each lane tile for label and comparison text. */
export const HUD_HEIGHT = 56;

/** Height reserved below lane tiles for banner, seed, and URL lines. */
export const FOOTER_HEIGHT = 120;

/** Tabular font for export sheet labels and footer lines. */
const EXPORT_SHEET_FONT = '600 14px ui-monospace, "Cascadia Code", monospace';

/**
 * Read a canvas fillStyle as a CSS color string.
 *
 * @throws If the browser context holds a gradient or pattern instead of a string.
 */
function readFillStyle(value: string | CanvasGradient | CanvasPattern): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error("ExportSheetContext only supports string fillStyle");
}

/**
 * Validate a CSS canvas `text-align` keyword before forwarding to the browser context.
 *
 * @throws If `value` is not one of the supported alignment keywords.
 */
function assertCanvasTextAlign(value: string): CanvasTextAlign {
  switch (value) {
    case "left":
    case "right":
    case "center":
    case "start":
    case "end":
      return value;
    default:
      throw new Error(
        `ExportSheetContext textAlign must be left, right, center, start, or end; got ${JSON.stringify(value)}`,
      );
  }
}

/**
 * Validate a CSS canvas `text-baseline` keyword before forwarding to the browser context.
 *
 * @throws If `value` is not one of the supported baseline keywords.
 */
function assertCanvasTextBaseline(value: string): CanvasTextBaseline {
  switch (value) {
    case "top":
    case "hanging":
    case "middle":
    case "alphabetic":
    case "ideographic":
    case "bottom":
      return value;
    default:
      throw new Error(
        `ExportSheetContext textBaseline must be top, hanging, middle, alphabetic, ideographic, or bottom; got ${JSON.stringify(value)}`,
      );
  }
}

/**
 * Wrap a browser `CanvasRenderingContext2D` for {@link drawExportSheet}.
 *
 * Forwards fill, text, and image draw calls. {@link ExportSheetContext.drawImage}
 * accepts only `HTMLCanvasElement` sources (lane tile bitmaps from the race UI).
 *
 * @param ctx - Real 2D context from an export or offscreen canvas.
 * @returns Drawing surface compatible with {@link drawExportSheet}.
 */
export function wrapExportSheetContext(ctx: CanvasRenderingContext2D): ExportSheetContext {
  return {
    get fillStyle(): string {
      return readFillStyle(ctx.fillStyle);
    },
    set fillStyle(value: string) {
      ctx.fillStyle = value;
    },
    get font(): string {
      return ctx.font;
    },
    set font(value: string) {
      ctx.font = value;
    },
    get textAlign(): string {
      return ctx.textAlign;
    },
    set textAlign(value: string) {
      ctx.textAlign = assertCanvasTextAlign(value);
    },
    get textBaseline(): string {
      return ctx.textBaseline;
    },
    set textBaseline(value: string) {
      ctx.textBaseline = assertCanvasTextBaseline(value);
    },
    fillRect(x: number, y: number, w: number, h: number): void {
      ctx.fillRect(x, y, w, h);
    },
    fillText(text: string, x: number, y: number): void {
      ctx.fillText(text, x, y);
    },
    drawImage(image: ExportImageSource, dx: number, dy: number, dw: number, dh: number): void {
      if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) {
        ctx.drawImage(image, dx, dy, dw, dh);
        return;
      }
      throw new Error("drawImage: expected an HTMLCanvasElement");
    },
  };
}

/** Minimal bitmap source accepted by {@link ExportSheetContext.drawImage}. */
export type ExportImageSource = {
  width: number;
  height: number;
};

/** Canvas-like 2D context surface for {@link drawExportSheet}. */
export type ExportSheetContext = {
  fillStyle: string;
  font: string;
  textAlign: CanvasTextAlign | string;
  textBaseline: CanvasTextBaseline | string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: ExportImageSource, dx: number, dy: number, dw: number, dh: number): void;
};

/** One lane column on the export sheet. */
export type ExportLaneTile = {
  /** Lane display label, e.g. `"Dijkstra"`. */
  label: string;
  /** Total billed comparisons ({@link Math.floor} applied when drawing). */
  comparisons: number;
  /** Bitmap already composited by the race renderer (HTMLCanvasElement in browser). */
  canvas: ExportImageSource;
};

/** Full export sheet content and chrome tokens. */
export type ExportSheetSpec = {
  lanes: readonly ExportLaneTile[];
  banner: string;
  seedLine: string;
  urlLine: string;
  chrome: Pick<ThemeTokens, "paper" | "ink" | "muted" | "gold">;
};

/**
 * Pixel dimensions of a photo-finish export sheet for the given lane count.
 *
 * @param laneCount - Number of race lanes (`2` or `3`).
 * @returns `{ width, height }` in CSS pixels.
 * @throws {RangeError} When `laneCount` is not `2` or `3`.
 */
export function sheetSize(laneCount: number): { width: number; height: number } {
  if (laneCount !== 2 && laneCount !== 3) {
    throw new RangeError(`sheetSize: laneCount must be 2 or 3, got ${String(laneCount)}`);
  }

  return {
    width: PAD + laneCount * LANE_TILE + (laneCount - 1) * GAP + PAD,
    height: PAD + HUD_HEIGHT + LANE_TILE + GAP + FOOTER_HEIGHT + PAD,
  };
}

/** Horizontal offset of lane column `index` from the sheet left edge. */
function laneColumnX(index: number): number {
  return PAD + index * (LANE_TILE + GAP);
}

/**
 * Draw a photo-finish export sheet onto `ctx`.
 *
 * Fills the full {@link sheetSize} with `chrome.paper`, renders each lane HUD
 * and tile, then writes banner, seed, and URL lines in the footer.
 *
 * @param ctx - Target 2D context (browser canvas or test recorder).
 * @param spec - Lane tiles and footer copy.
 * @throws {RangeError} When `spec.lanes.length` is not `2` or `3`.
 */
export function drawExportSheet(ctx: ExportSheetContext, spec: ExportSheetSpec): void {
  const laneCount = spec.lanes.length;
  if (laneCount !== 2 && laneCount !== 3) {
    throw new RangeError(`drawExportSheet: lanes.length must be 2 or 3, got ${String(laneCount)}`);
  }

  const { width, height } = sheetSize(laneCount);
  const tileTop = PAD + HUD_HEIGHT;
  const footerTop = tileTop + LANE_TILE + GAP;

  ctx.fillStyle = spec.chrome.paper;
  ctx.fillRect(0, 0, width, height);

  ctx.font = EXPORT_SHEET_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  for (let index = 0; index < laneCount; index += 1) {
    const lane = spec.lanes[index];
    if (lane === undefined) {
      throw new RangeError(`drawExportSheet: missing lane at index ${String(index)}`);
    }
    const columnX = laneColumnX(index);
    const comparisonsText = `${lane.label}: ${String(Math.floor(lane.comparisons))}`;

    ctx.fillStyle = spec.chrome.ink;
    ctx.fillText(lane.label, columnX, PAD);
    ctx.fillText(comparisonsText, columnX, PAD + 22);

    ctx.drawImage(lane.canvas, columnX, tileTop, LANE_TILE, LANE_TILE);
  }

  ctx.fillStyle = spec.chrome.ink;
  ctx.fillText(spec.banner, PAD, footerTop + 8);

  ctx.fillStyle = spec.chrome.muted;
  ctx.fillText(spec.seedLine, PAD, footerTop + 36);
  ctx.fillText(spec.urlLine, PAD, footerTop + 64);
}
