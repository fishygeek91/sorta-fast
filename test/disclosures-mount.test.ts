import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

const TRACE_IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*trace(?:\.ts)?["']/;

const FORBIDDEN_DISCLOSURE_WORDS = /\b(pause|teardown|reload)\b/;

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("disclosures mount wiring", () => {
  it("race.ts source contains mountDisclosures", () => {
    const source = readUiSource("race.ts");
    expect(source).toContain("mountDisclosures");
  });

  it("lens.ts source contains mountDisclosures", () => {
    const source = readUiSource("lens.ts");
    expect(source).toContain("mountDisclosures");
  });

  it("race.ts source contains mountThemeToggle", () => {
    const source = readUiSource("race.ts");
    expect(source).toContain("mountThemeToggle");
  });

  it("lens.ts source contains mountThemeToggle", () => {
    const source = readUiSource("lens.ts");
    expect(source).toContain("mountThemeToggle");
  });

  it("disclosures.ts source sets dataset.accent on disclosure items", () => {
    const source = readUiSource("disclosures.ts");
    expect(source).toContain("dataset.accent");
  });

  it("disclosures.ts source does not reference pause, teardown, or reload", () => {
    const source = readUiSource("disclosures.ts");
    expect(source).not.toMatch(FORBIDDEN_DISCLOSURE_WORDS);
  });

  it("disclosures.ts does not import trace.ts", () => {
    const source = readUiSource("disclosures.ts");
    expect(source, "src/ui/disclosures.ts must not import trace.ts").not.toMatch(TRACE_IMPORT);
  });

  it("siteCopy.ts does not import trace.ts", () => {
    const source = readUiSource("siteCopy.ts");
    expect(source, "src/ui/siteCopy.ts must not import trace.ts").not.toMatch(TRACE_IMPORT);
  });
});
