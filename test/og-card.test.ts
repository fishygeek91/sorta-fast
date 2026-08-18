import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const OG_CARD_PATH = join(TEST_DIR, "../public/og-card.png");

/** PNG file signature per RFC 2083 — every valid PNG starts with these 8 bytes. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Regression ceiling from issue #51 (815,118 → 225,213 bytes after pngquant+oxipng). */
const MAX_OG_CARD_BYTES = 400_000;

/**
 * Read IHDR width/height from a PNG buffer.
 * Bytes 8–11 are the IHDR chunk length; 12–15 are "IHDR"; dimensions follow at 16 and 20.
 * @param buffer - Full PNG file contents.
 * @returns Width and height as big-endian uint32 values from the IHDR chunk.
 */
function readIhdrDimensions(buffer: Buffer): { width: number; height: number } {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe("issue #51 og-card asset contract", () => {
  it("exists at public/og-card.png", () => {
    expect(existsSync(OG_CARD_PATH)).toBe(true);
  });

  it("is a valid PNG with 1200×630 IHDR matching og:image meta", () => {
    const bytes = readFileSync(OG_CARD_PATH);
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

    const { width, height } = readIhdrDimensions(bytes);
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });

  it("stays under the compressed size ceiling", () => {
    const { size } = statSync(OG_CARD_PATH);
    expect(size).toBeLessThan(MAX_OG_CARD_BYTES);
  });
});
