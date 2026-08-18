import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(TEST_DIR, "../README.md");
const HERO_GIF_PATH = join(TEST_DIR, "../docs/assets/hero.gif");

/**
 * Return true when `haystack` contains `needle`, case-insensitive.
 */
function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

describe("issue #21 / #28 README launch copy", () => {
  const readme = readFileSync(README_PATH, "utf8");

  it("links the hero GIF and live GitHub Pages URL", () => {
    expect(readme).toContain("docs/assets/hero.gif");
    expect(readme).toContain("https://fishygeek91.github.io/sorta-fast/");
  });

  it("ships docs/assets/hero.gif on disk", () => {
    expect(existsSync(HERO_GIF_PATH)).toBe(true);
  });

  it("mentions the work-clock headline and paper arXiv IDs", () => {
    expect(readme).toContain("Dijkstra wins the work clock");
    expect(readme).toContain("2504.17033");
    expect(readme).toContain("2602.07868");
  });

  it("points readers at the wall-clock bench page", () => {
    expect(readme).toContain("bench");
  });

  it("lists the primary fuzz and crosscheck test entry points", () => {
    expect(readme).toContain("test/dijkstra-fuzz.test.ts");
    expect(readme).toContain("test/bmssp-fuzz.test.ts");
    expect(readme).toContain("test/bmssp-crosscheck.test.ts");
    expect(readme).toContain("test/dmsy-fuzz.test.ts");
  });

  it("advertises the default 3-way race URL", () => {
    expect(readme).toContain("race=dijkstra,bmssp,dmsy");
  });

  it("claims first public DMSY implementation with blog companion", () => {
    expect(includesIgnoreCase(readme, "first public implementation")).toBe(true);
    expect(readme).toContain("docs/blog/implementing-dmsy.md");
  });

  it("does not advertise the site as under construction", () => {
    expect(includesIgnoreCase(readme, "under construction")).toBe(false);
  });

  it("does not defer DMSY to a future release", () => {
    expect(includesIgnoreCase(readme, "planned for v2.0")).toBe(false);
  });
});
