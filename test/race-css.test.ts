import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = join(TEST_DIR, "../src/style.css");

describe("race mode CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  it("defines 2- and 3-lane grid templates on .race-lanes", () => {
    expect(css).toContain('.race-lanes[data-lanes="2"]');
    expect(css).toContain('.race-lanes[data-lanes="3"]');
    expect(css).toMatch(/\.race-lanes\[data-lanes="2"\][\s\S]*?grid-template-columns:\s*1fr\s+1fr/);
    expect(css).toMatch(
      /\.race-lanes\[data-lanes="3"\][\s\S]*?grid-template-columns:\s*1fr\s+1fr\s+1fr/,
    );
  });

  it("stacks lanes vertically below 720px", () => {
    const mobileBlock = css.match(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)\n\}/);
    expect(mobileBlock).not.toBeNull();
    const block = mobileBlock?.[1] ?? "";
    expect(block).toContain(".race-lanes");
    expect(block).toMatch(/grid-template-columns:\s*1fr/);
  });

  it("uses tabular numerals on race counters", () => {
    expect(css).toMatch(/\.race-counters[\s\S]*?font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/\.race-counter-value[\s\S]*?font-variant-numeric:\s*tabular-nums/);
  });

  it("defines shared .race-transport below lanes", () => {
    expect(css).toContain(".race-transport");
  });

  it("does not define a per-lane scrubber class", () => {
    expect(css).not.toContain(".race-lane-scrubber");
  });
});
