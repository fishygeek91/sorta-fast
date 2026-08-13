/**
 * Paint a photo-finish export sheet onto an offscreen canvas (issue #18).
 */

import { drawExportSheet, wrapExportSheetContext, type ExportSheetSpec } from "./exportSheet.ts";

/**
 * Composite {@link ExportSheetSpec} onto `sheet` using a 2D context.
 *
 * @param sheet - Target canvas sized via {@link sheetSize}.
 * @param spec - Lane tiles, banner, and footer metadata.
 * @throws When the canvas 2D context is unavailable.
 */
export function paintRaceExportSheet(sheet: HTMLCanvasElement, spec: ExportSheetSpec): void {
  const ctx = sheet.getContext("2d");
  if (ctx === null) {
    throw new Error("export sheet canvas 2d context unavailable");
  }
  drawExportSheet(wrapExportSheetContext(ctx), spec);
}
