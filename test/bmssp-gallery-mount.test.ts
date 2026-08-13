import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `race.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("issue #52 BMSSP gallery wiring", () => {
  const raceSource = readUiSource("race.ts");
  const lensSource = readUiSource("lens.ts");

  it("race.ts mounts a Demo vs Paper BMSSP select and writes bmssp=", () => {
    expect(raceSource).toContain("race-bmssp-select");
    expect(raceSource).toContain("Demo (browser-scale)");
    expect(raceSource).toContain("Paper (asymptotic)");
    expect(raceSource).toContain("applyRaceState({ ...raceState, bmssp: raw })");
    expect(raceSource).toContain("resolveBmsspRunParams");
    expect(raceSource).toContain("mode: raceState.bmssp");
  });

  it("lens.ts mounts a Demo vs Paper BMSSP select and writes bmssp=", () => {
    expect(lensSource).toContain("lens-bmssp-select");
    expect(lensSource).toContain("Demo (browser-scale)");
    expect(lensSource).toContain("Paper (asymptotic)");
    expect(lensSource).toContain("applyLensState({ ...lensState, bmssp: raw })");
    expect(lensSource).toContain("resolveBmsspRunParams");
    expect(lensSource).toContain("mode: lensState.bmssp");
  });

  it("race.ts does not import core/bmssp algorithm modules", () => {
    expect(raceSource).not.toMatch(/from\s+["'][^"']*core\/bmssp/);
  });

  it("lens.ts does not import core/bmssp algorithm modules", () => {
    expect(lensSource).not.toMatch(/from\s+["'][^"']*core\/bmssp/);
  });
});
