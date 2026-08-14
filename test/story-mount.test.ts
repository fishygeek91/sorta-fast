import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(TEST_DIR, "../src/ui");

const TRACE_IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'][^"']*trace(?:\.ts)?["']/;

const STORY_UI_FILES = [
  "story.ts",
  "storyScript.ts",
  "storyUrl.ts",
  "storyDrive.ts",
  "storyWheel.ts",
];

/**
 * Read a UI module source file as UTF-8 text.
 *
 * @param filename - Basename under `src/ui` (e.g. `story.ts`).
 * @returns File contents for source-scan assertions.
 */
function readUiSource(filename: string): string {
  return readFileSync(join(UI_DIR, filename), "utf8");
}

describe("story mount wiring", () => {
  it("race.ts source contains isStorySearch and mountStory", () => {
    const source = readUiSource("race.ts");
    expect(source).toContain("isStorySearch");
    expect(source).toContain("mountStory");
  });

  it("race.ts source contains race-story-button", () => {
    const source = readUiSource("race.ts");
    expect(source).toContain("race-story-button");
  });

  it("lens.ts source contains lens-story-button", () => {
    const source = readUiSource("lens.ts");
    expect(source).toContain("lens-story-button");
  });

  it("story.ts source exports mountStory", () => {
    const source = readUiSource("story.ts");
    expect(source).toContain("export function mountStory");
  });

  it("story.ts source contains story-skip", () => {
    const source = readUiSource("story.ts");
    expect(source).toContain("story-skip");
  });

  it("story.ts source contains DEFAULT_RACE_URL for free-play handoff", () => {
    const source = readUiSource("story.ts");
    expect(source).toContain("DEFAULT_RACE_URL");
  });

  it("story.ts source contains STORY_SCROLL_THRESHOLD_PX for wheel and swipe", () => {
    const source = readUiSource("story.ts");
    expect(source).toContain("STORY_SCROLL_THRESHOLD_PX");
  });

  it("story.ts source uses decideStoryWheel for wheel navigation", () => {
    const source = readUiSource("story.ts");
    expect(source).toContain("decideStoryWheel");
  });

  for (const filename of STORY_UI_FILES) {
    it(`${filename} does not import trace.ts`, () => {
      const source = readUiSource(filename);
      expect(source, `src/ui/${filename} must not import trace.ts`).not.toMatch(TRACE_IMPORT);
    });
  }
});
