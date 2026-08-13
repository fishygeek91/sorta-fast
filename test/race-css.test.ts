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

  it("styles graph controls in the lens header", () => {
    const hasGraphControls = css.includes(".lens-header .lens-graph-controls");
    const hasRaceGallery = css.includes(".lens-header .race-gallery");
    expect(hasGraphControls || hasRaceGallery).toBe(true);
  });

  it("defines race seed input styling", () => {
    expect(css).toContain(".race-seed-input");
  });

  it("defines dice roll buttons for race and lens modes", () => {
    expect(css).toContain("#race-dice-button");
    expect(css).toContain("#lens-dice-button");
  });

  it("defines race kind select styling", () => {
    expect(css).toContain("#race-kind-select");
  });

  it("uses pointer cursor on dice roll buttons", () => {
    expect(css).toMatch(/#race-dice-button,\s*\n#lens-dice-button\s*\{[\s\S]*?cursor:\s*pointer/);
  });
});

describe("site disclosures CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  /**
   * Extract the first `@media (max-width: 720px)` block body from stylesheet text.
   *
   * @param stylesheet - Full `style.css` source.
   * @returns Inner rules of the mobile breakpoint block.
   */
  function extractMobile720Block(stylesheet: string): string {
    const mobileBlock = stylesheet.match(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)\n\}/);
    expect(mobileBlock).not.toBeNull();
    return mobileBlock?.[1] ?? "";
  }

  it("defines site disclosure container and panel classes", () => {
    expect(css).toContain(".site-disclosures");
    expect(css).toContain(".site-disclosure");
    expect(css).toContain(".site-disclosure-body");
  });

  it("matches lens control width when footer is direct child of #app", () => {
    expect(css).toContain("#app > .site-disclosures");
    expect(css).toMatch(
      /#app\s*>\s*\.site-disclosures\s*\{[\s\S]*?width:\s*min\(720px,\s*calc\(100vw\s*-\s*2rem\)\)/,
    );
  });

  it("stacks disclosures vertically below 720px", () => {
    const block = extractMobile720Block(css);
    expect(block).toContain(".site-disclosures");
    expect(block).toMatch(/\.site-disclosures\s*\{[\s\S]*?flex-direction:\s*column/);
  });
});
