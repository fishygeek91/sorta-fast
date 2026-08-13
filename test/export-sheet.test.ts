import { describe, expect, it } from "vitest";

import {
  drawExportSheet,
  FOOTER_HEIGHT,
  GAP,
  HUD_HEIGHT,
  LANE_TILE,
  PAD,
  sheetSize,
  wrapExportSheetContext,
  type ExportImageSource,
  type ExportSheetContext,
  type ExportSheetSpec,
} from "../src/ui/exportSheet.ts";
import { THEMES } from "../src/render/theme.ts";

type RecordedFillRect = { x: number; y: number; w: number; h: number; fillStyle: string };
type RecordedFillText = { text: string; x: number; y: number; fillStyle: string };
type RecordedDrawImage = {
  image: ExportImageSource;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

/** Headless recorder for {@link ExportSheetContext} draw calls (issue #18). */
function createFakeExportSheetContext(): ExportSheetContext & {
  fillRects: RecordedFillRect[];
  fillTexts: RecordedFillText[];
  drawImages: RecordedDrawImage[];
} {
  const fillRects: RecordedFillRect[] = [];
  const fillTexts: RecordedFillText[] = [];
  const drawImages: RecordedDrawImage[] = [];

  let fillStyle = "#000000";

  return {
    fillRects,
    fillTexts,
    drawImages,
    get fillStyle(): string {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    font: "",
    textAlign: "left",
    textBaseline: "top",
    fillRect(x: number, y: number, w: number, h: number): void {
      fillRects.push({ x, y, w, h, fillStyle });
    },
    fillText(text: string, x: number, y: number): void {
      fillTexts.push({ text, x, y, fillStyle });
    },
    drawImage(image: ExportImageSource, dx: number, dy: number, dw: number, dh: number): void {
      drawImages.push({ image, dx, dy, dw, dh });
    },
  };
}

function fakeLaneCanvas(): ExportImageSource {
  return { width: LANE_TILE, height: LANE_TILE };
}

function sampleSpec(laneCount: 2 | 3): ExportSheetSpec {
  const lanes =
    laneCount === 2
      ? [
          { label: "Dijkstra", comparisons: 48210.9, canvas: fakeLaneCanvas() },
          { label: "BMSSP", comparisons: 31077.2, canvas: fakeLaneCanvas() },
        ]
      : [
          { label: "Dijkstra", comparisons: 48210.9, canvas: fakeLaneCanvas() },
          { label: "BMSSP", comparisons: 31077.2, canvas: fakeLaneCanvas() },
          { label: "DMSY", comparisons: 29500.6, canvas: fakeLaneCanvas() },
        ];

  return {
    lanes,
    banner: "BMSSP beat Dijkstra by 17,133 comparisons on this graph.",
    seedLine: "Seed: 0xdeadbeef",
    urlLine: "https://example.test/race?seed=deadbeef",
    chrome: {
      paper: THEMES.dark.paper,
      ink: THEMES.dark.ink,
      muted: THEMES.dark.muted,
      gold: THEMES.dark.gold,
    },
  };
}

describe("export sheet layout (issue #18)", () => {
  it("sheetSize(2) matches PAD + tiles + gaps + footer formula", () => {
    expect(sheetSize(2)).toEqual({
      width: PAD + 2 * LANE_TILE + GAP + PAD,
      height: PAD + HUD_HEIGHT + LANE_TILE + GAP + FOOTER_HEIGHT + PAD,
    });
  });

  it("sheetSize(3) matches PAD + tiles + gaps + footer formula", () => {
    expect(sheetSize(3)).toEqual({
      width: PAD + 3 * LANE_TILE + 2 * GAP + PAD,
      height: PAD + HUD_HEIGHT + LANE_TILE + GAP + FOOTER_HEIGHT + PAD,
    });
  });

  it("sheetSize(1) and sheetSize(4) throw", () => {
    expect(() => sheetSize(1)).toThrow(/laneCount must be 2 or 3/);
    expect(() => sheetSize(4)).toThrow(/laneCount must be 2 or 3/);
  });

  it("drawExportSheet records background, lane tiles, and footer text", () => {
    const spec = sampleSpec(2);
    const ctx = createFakeExportSheetContext();
    const { width, height } = sheetSize(2);

    drawExportSheet(ctx, spec);

    expect(ctx.fillRects).toContainEqual({
      x: 0,
      y: 0,
      w: width,
      h: height,
      fillStyle: spec.chrome.paper,
    });

    expect(ctx.drawImages).toHaveLength(2);
    expect(ctx.drawImages.every((call) => call.dw === LANE_TILE && call.dh === LANE_TILE)).toBe(
      true,
    );

    const texts = ctx.fillTexts.map((call) => call.text);
    for (const lane of spec.lanes) {
      expect(texts).toContain(lane.label);
      expect(texts).toContain(`${lane.label}: ${String(Math.floor(lane.comparisons))}`);
    }

    expect(texts).toContain(spec.banner);
    expect(texts).toContain(spec.seedLine);
    expect(texts).toContain(spec.urlLine);
  });

  it("drawExportSheet draws one image per lane for three-lane races", () => {
    const spec = sampleSpec(3);
    const ctx = createFakeExportSheetContext();

    drawExportSheet(ctx, spec);

    expect(ctx.drawImages).toHaveLength(3);
    expect(ctx.fillTexts.map((call) => call.text)).toContain(spec.seedLine);
    expect(ctx.fillTexts.map((call) => call.text)).toContain(spec.urlLine);
  });

  it("drawExportSheet throws when lane count is invalid", () => {
    const ctx = createFakeExportSheetContext();
    const spec = sampleSpec(2);
    const badSpec: ExportSheetSpec = { ...spec, lanes: [spec.lanes[0]] };

    expect(() => drawExportSheet(ctx, badSpec)).toThrow(/lanes\.length must be 2 or 3/);
  });
});

describe("wrapExportSheetContext", () => {
  function createMockBrowserContext(): {
    raw: CanvasRenderingContext2D;
    fillRects: { x: number; y: number; w: number; h: number }[];
    fillTexts: { text: string; x: number; y: number }[];
    drawImageCalls: unknown[];
    setFillStyle(value: string | CanvasGradient | CanvasPattern): void;
  } {
    const fillRects: { x: number; y: number; w: number; h: number }[] = [];
    const fillTexts: { text: string; x: number; y: number }[] = [];
    const drawImageCalls: unknown[] = [];
    let fillStyleValue: string | CanvasGradient | CanvasPattern = "#000000";

    const raw = {
      get fillStyle(): string | CanvasGradient | CanvasPattern {
        return fillStyleValue;
      },
      set fillStyle(value: string | CanvasGradient | CanvasPattern) {
        fillStyleValue = value;
      },
      font: "",
      textAlign: "left" as CanvasTextAlign,
      textBaseline: "top" as CanvasTextBaseline,
      fillRect(x: number, y: number, w: number, h: number): void {
        fillRects.push({ x, y, w, h });
      },
      fillText(text: string, x: number, y: number): void {
        fillTexts.push({ text, x, y });
      },
      drawImage(...args: unknown[]): void {
        drawImageCalls.push(args);
      },
    } as CanvasRenderingContext2D;

    return {
      raw,
      fillRects,
      fillTexts,
      drawImageCalls,
      setFillStyle(value: string | CanvasGradient | CanvasPattern): void {
        fillStyleValue = value;
      },
    };
  }

  it("forwards fillStyle, fillRect, and fillText to the browser context", () => {
    const mock = createMockBrowserContext();
    const wrapped = wrapExportSheetContext(mock.raw);

    wrapped.fillStyle = "#ff00aa";
    wrapped.fillRect(1, 2, 3, 4);
    wrapped.fillText("race", 10, 20);

    expect(wrapped.fillStyle).toBe("#ff00aa");
    expect(mock.fillRects).toEqual([{ x: 1, y: 2, w: 3, h: 4 }]);
    expect(mock.fillTexts).toEqual([{ text: "race", x: 10, y: 20 }]);
  });

  it("throws when reading a non-string fillStyle from the browser context", () => {
    const mock = createMockBrowserContext();
    const wrapped = wrapExportSheetContext(mock.raw);
    const gradient = {} as CanvasGradient;
    mock.setFillStyle(gradient);

    expect(() => wrapped.fillStyle).toThrow(/only supports string fillStyle/);
  });

  it("drawImage rejects non-HTMLCanvasElement sources", () => {
    const mock = createMockBrowserContext();
    const wrapped = wrapExportSheetContext(mock.raw);
    const image: ExportImageSource = { width: LANE_TILE, height: LANE_TILE };

    expect(() => wrapped.drawImage(image, 0, 0, LANE_TILE, LANE_TILE)).toThrow(
      /expected an HTMLCanvasElement/,
    );
    expect(mock.drawImageCalls).toHaveLength(0);
  });

  it("throws when setting an invalid textAlign", () => {
    const mock = createMockBrowserContext();
    const wrapped = wrapExportSheetContext(mock.raw);

    expect(() => {
      wrapped.textAlign = "bogus";
    }).toThrow(/textAlign must be left, right, center, start, or end/);
    expect(mock.raw.textAlign).toBe("left");
  });

  it("throws when setting an invalid textBaseline", () => {
    const mock = createMockBrowserContext();
    const wrapped = wrapExportSheetContext(mock.raw);

    expect(() => {
      wrapped.textBaseline = "bogus";
    }).toThrow(/textBaseline must be top, hanging, middle, alphabetic, ideographic, or bottom/);
    expect(mock.raw.textBaseline).toBe("top");
  });
});
