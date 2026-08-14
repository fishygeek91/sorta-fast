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

  it("defines BMSSP demo/paper select styling", () => {
    expect(css).toContain("#race-bmssp-select");
    expect(css).toContain("#lens-bmssp-select");
  });

  it("uses pointer cursor on dice roll buttons", () => {
    expect(css).toMatch(/#race-dice-button,\s*\n#lens-dice-button\s*\{[\s\S]*?cursor:\s*pointer/);
  });
});

describe("site disclosures CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  /**
   * Slice of the stylesheet from the first 720px media query onward.
   *
   * Avoids brace-matching that depends on indented inner `}` closings.
   *
   * @param stylesheet - Full `style.css` source.
   * @returns Text from `@media (max-width: 720px)` to the end of the file.
   */
  function cssFromMedia720(stylesheet: string): string {
    const marker = "@media (max-width: 720px)";
    const index = stylesheet.indexOf(marker);
    expect(index).toBeGreaterThanOrEqual(0);
    return stylesheet.slice(index);
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
    const afterMedia = cssFromMedia720(css);
    expect(afterMedia).toContain(".site-disclosures");
    expect(afterMedia).toMatch(/\.site-disclosures\s*\{[\s\S]*?flex-direction:\s*column/);
  });
});

describe("issue #18 export controls CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  it("defines PNG and WebM export button selectors", () => {
    expect(css).toContain("#race-export-png");
    expect(css).toContain("#race-export-webm");
  });

  it("styles disabled export buttons", () => {
    expect(css).toContain("#race-export-png:disabled");
    expect(css).toContain("#race-export-webm:disabled");
  });

  it("highlights WebM export while recording", () => {
    expect(css).toContain('#race-export-webm[data-recording="true"]');
  });
});

describe("issue #17 visual tokens", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  it("defines light-theme overrides and design-token hooks", () => {
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain("--paper:");
    expect(css).toContain("--text-title:");
  });

  it("uses tabular numerals via font-feature-settings", () => {
    const hasTnum =
      css.includes('font-feature-settings: "tnum" 1') ||
      css.includes('font-feature-settings: "tnum" 1;');
    expect(hasTnum).toBe(true);
  });

  it("styles persona lanes, theme toggle, and marble accent hooks", () => {
    expect(css).toContain('.race-lane[data-persona="stub"]');
    expect(css).toContain(".theme-toggle");
    expect(css).toMatch(/data-accent="marble"/);
    expect(css).toContain('.lens-canvas[data-persona="marble"]');
  });
});

describe("story mode CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  it("defines story root and caption classes", () => {
    expect(css).toContain(".story-root");
    expect(css).toContain(".story-caption");
  });

  it("defines story skip and nav classes", () => {
    expect(css).toContain(".story-skip");
    expect(css).toContain(".story-nav");
  });

  it("sets 44px min-height on story skip control", () => {
    expect(css).toMatch(/\.story-skip\s*\{[\s\S]*?min-height:\s*44px/);
  });

  it("sets 44px min-height on story nav buttons", () => {
    expect(css).toMatch(/\.story-nav button\s*\{[\s\S]*?min-height:\s*44px/);
  });

  it("defines comparisons callout hook", () => {
    expect(css).toContain('[data-callout="comparisons"]');
  });

  it("stacks story lanes vertically below 720px", () => {
    const mobileBlock = css.match(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)\n\}/);
    expect(mobileBlock).not.toBeNull();
    const block = mobileBlock?.[1] ?? "";
    expect(block).toContain(".story-lanes");
  });

  it("hides race lanes that have the hidden attribute", () => {
    expect(css).toMatch(/\.race-lane\[hidden\]\s*\{[\s\S]*?display:\s*none/);
  });
});
