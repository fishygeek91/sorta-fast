import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CHECKLIST_PATH = join(TEST_DIR, "../docs/launch-checklist.md");

/**
 * Return true when `haystack` contains `needle`, case-insensitive.
 */
function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Read the launch checklist or fail with a clear prerequisite message.
 */
function readLaunchChecklist(): string {
  if (!existsSync(CHECKLIST_PATH)) {
    throw new Error(
      "docs/launch-checklist.md must exist before CI — create and verify the launch checklist",
    );
  }
  return readFileSync(CHECKLIST_PATH, "utf8");
}

describe("issue #21 launch checklist", () => {
  const checklist = readLaunchChecklist();

  it("covers Pages, OG, export, seed, CI, Fairness, hero, and ffmpeg", () => {
    const requiredFragments = [
      "Pages live",
      "OG",
      "export",
      "seed",
      "CI",
      "Fairness",
      "hero",
      "ffmpeg",
    ] as const;

    for (const fragment of requiredFragments) {
      expect(
        includesIgnoreCase(checklist, fragment),
        `launch checklist must mention "${fragment}"`,
      ).toBe(true);
    }
  });

  it("has no unchecked required checklist items", () => {
    const uncheckedPattern = /^- \[ \]/m;
    expect(
      uncheckedPattern.test(checklist),
      "launch checklist must use - [x] for all verified items (no - [ ] boxes)",
    ).toBe(false);
  });
});
