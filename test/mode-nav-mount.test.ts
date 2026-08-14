import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

const MODE_SURFACE_FILES = ["race.ts", "lens.ts", "story.ts"] as const;

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `modeNav.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("issue #64 mode nav mount wiring", () => {
  it("modeNav.ts exposes accessibility and chrome class hooks", () => {
    const source = readUiSource("modeNav.ts");
    expect(source).toContain("aria-current");
    expect(source).toContain("mode-nav-btn-current");
    expect(source).toContain("lens-header-sep");
    expect(source).toContain("aria-label");
    expect(source).toContain('"Mode"');
  });

  it("modeNav.ts does not disable mode buttons via .disabled", () => {
    const source = readUiSource("modeNav.ts");
    expect(source).not.toContain("button.disabled");
    expect(source).not.toMatch(/\.(race|lens|story)\.disabled/);
  });

  it("race.ts, lens.ts, and story.ts each call mountModeNav", () => {
    for (const filename of MODE_SURFACE_FILES) {
      const source = readUiSource(filename);
      expect(source, `src/ui/${filename} must mount shared mode nav`).toContain("mountModeNav");
    }
  });

  it("race.ts does not disable the active race mode button", () => {
    const source = readUiSource("race.ts");
    expect(source).not.toContain("raceModeBtn.disabled");
  });

  it("lens.ts does not disable the active lens mode button", () => {
    const source = readUiSource("lens.ts");
    expect(source).not.toContain("lensModeBtn.disabled");
  });

  it("story.ts does not disable the active story mode button", () => {
    const source = readUiSource("story.ts");
    expect(source).not.toContain("storyModeBtn.disabled");
  });

  it("each surface leaves its active mode button without a click listener", () => {
    const raceSource = readUiSource("race.ts");
    const lensSource = readUiSource("lens.ts");
    const storySource = readUiSource("story.ts");
    expect(raceSource).not.toMatch(/race(?:ModeBtn)?\.addEventListener/);
    expect(lensSource).not.toMatch(/lens(?:ModeBtn)?\.addEventListener/);
    expect(storySource).not.toMatch(/story(?:ModeBtn)?\.addEventListener/);
  });

  it("race.ts, lens.ts, and story.ts do not assign mode subtitles via textContent", () => {
    for (const filename of MODE_SURFACE_FILES) {
      const source = readUiSource(filename);
      expect(source, `src/ui/${filename} must not set Race subtitle`).not.toContain(
        'subtitle.textContent = "Race"',
      );
      expect(source, `src/ui/${filename} must not set Lens subtitle`).not.toContain(
        'subtitle.textContent = "Lens"',
      );
      expect(source, `src/ui/${filename} must not set Story subtitle`).not.toContain(
        'subtitle.textContent = "Story"',
      );
    }
  });

  it("race.ts, lens.ts, and story.ts do not use the old Lens subtitle prefix", () => {
    for (const filename of MODE_SURFACE_FILES) {
      const source = readUiSource(filename);
      expect(source, `src/ui/${filename} must not use Lens · prefix`).not.toContain("Lens ·");
    }
  });

  it("race.ts, lens.ts, and story.ts parent theme toggle on chrome, not modeNav", () => {
    for (const filename of MODE_SURFACE_FILES) {
      const source = readUiSource(filename);
      expect(source, `src/ui/${filename} must not mount theme toggle on modeNav`).not.toContain(
        "mountThemeToggle(modeNav",
      );
    }
  });

  it("race.ts source still contains race-story-button id", () => {
    const source = readUiSource("race.ts");
    expect(source).toContain("race-story-button");
  });

  it("lens.ts source still contains lens-story-button id", () => {
    const source = readUiSource("lens.ts");
    expect(source).toContain("lens-story-button");
  });

  it("story.ts source still contains story-skip control", () => {
    const source = readUiSource("story.ts");
    expect(source).toContain("story-skip");
  });

  it("race.ts, lens.ts, and story.ts mount theme toggle on chrome", () => {
    for (const filename of MODE_SURFACE_FILES) {
      const source = readUiSource(filename);
      expect(source, `src/ui/${filename} must mount theme toggle on chrome`).toContain(
        "mountThemeToggle(chrome",
      );
    }
  });
});
