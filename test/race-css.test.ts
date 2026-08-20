import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PHOTO_FINISH_GOLD } from "../src/render/theme";

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
    expect(css).toContain("#race-featured-button");
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
    expect(css).toMatch(
      /#race-dice-button,\s*\n#race-featured-button,\s*\n#lens-dice-button\s*\{[\s\S]*?cursor:\s*pointer/,
    );
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

describe("issue #63 race standing CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  it("anchors race mode content to the top of the viewport", () => {
    expect(css).toMatch(/#app\[data-mode="race"\]\s*\{[\s\S]*?justify-content:\s*flex-start/);
  });

  it("defines standing badge classes on lane headings", () => {
    expect(css).toContain(".race-lane-heading");
    expect(css).toContain(".race-lane-winner");
    expect(css).toContain(".race-lane-lead");
  });

  it("highlights the best comparison counter", () => {
    expect(css).toContain('.race-counters .lens-counter[data-best="true"]');
  });

  it("defines visually-hidden text for best-in-class notes", () => {
    expect(css).toMatch(/\.visually-hidden\s*\{[\s\S]*?position:\s*absolute/);
  });

  it("pins the race banner while scrolling", () => {
    expect(css).toMatch(/\.race-banner\s*\{[\s\S]*?position:\s*sticky/);
    expect(css).toMatch(/\.race-banner\s*\{[\s\S]*?top:\s*0/);
  });

  it("hides lanes with the hidden attribute via display: none", () => {
    expect(css).toMatch(/\.race-lane\[hidden\]\s*\{[\s\S]*?display:\s*none/);
  });

  it("uses flex layout for visible lanes by default", () => {
    expect(css).toMatch(/\.race-lane\s*\{[\s\S]*?display:\s*flex/);
  });
});

describe("issue #64 mode nav", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  it("defines lens header chrome class", () => {
    expect(css).toContain(".lens-header-chrome");
  });

  it("defines mode nav button class", () => {
    expect(css).toContain(".mode-nav-btn");
  });

  it("defines current mode nav button with aria-current page", () => {
    expect(css).toContain(".mode-nav-btn-current");
    expect(css).toContain('[aria-current="page"]');
  });

  it("defines lens header separator class", () => {
    expect(css).toContain(".lens-header-sep");
  });

  it("does not define removed lens subtitle class", () => {
    expect(css).not.toContain(".lens-subtitle");
  });
});

describe("issue #65 race chrome CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  /**
   * Slice of the stylesheet from the first 720px media query onward.
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

  it("defines --frontier design token", () => {
    expect(css).toContain("--frontier:");
  });

  it("sets dark-theme frontier color on :root", () => {
    expect(css).toMatch(/:root\s*\{[\s\S]*?--frontier:\s*rgb\(236,\s*230,\s*220\)/);
  });

  it("overrides frontier color in light theme", () => {
    expect(css).toMatch(/\[data-theme="light"\]\s*\{[\s\S]*?--frontier:\s*rgb\(40,\s*40,\s*40\)/);
  });

  it("defines race legend with flex-wrap layout", () => {
    expect(css).toContain(".race-legend");
    expect(css).toMatch(/\.race-legend\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });

  it("defines race legend item and swatch classes", () => {
    expect(css).toContain(".race-legend-item");
    expect(css).toContain(".race-legend-swatch");
  });

  it("defines legend swatch data hooks", () => {
    expect(css).toContain('[data-swatch="frontier"]');
    expect(css).toContain('[data-swatch="settled"]');
    expect(css).toContain('[data-swatch="unreached"]');
    expect(css).toContain('[data-swatch="gold"]');
  });

  it("styles settled swatch with canvas palette ramp", () => {
    expect(css).toMatch(
      /\.race-legend-swatch\[data-swatch="settled"\]\s*\{[\s\S]*?linear-gradient/,
    );
    expect(css).toContain("rgb(103, 170, 237)");
    expect(css).toContain("rgb(78, 188, 145)");
    expect(css).toContain("rgb(204, 156, 66)");
  });

  it("styles gold swatch with canvas PHOTO_FINISH_GOLD, not theme --gold", () => {
    const goldBlock = css.match(/\.race-legend-swatch\[data-swatch="gold"\]\s*\{[\s\S]*?\}/);
    expect(goldBlock).not.toBeNull();
    const block = goldBlock?.[0] ?? "";
    expect(block).toContain(PHOTO_FINISH_GOLD);
    expect(block).not.toContain("var(--gold)");
  });

  it("defines lane label pseudo-element hook", () => {
    expect(css).toContain(".race-lane-label::before");
  });

  it("defines persona lane label pseudo-element hooks", () => {
    expect(css).toContain('.race-lane[data-persona="marble"] .race-lane-label::before');
    expect(css).toContain('.race-lane[data-persona="ember"] .race-lane-label::before');
    expect(css).toContain('.race-lane[data-persona="moss"] .race-lane-label::before');
    expect(css).toContain('.race-lane[data-persona="stub"] .race-lane-label::before');
  });

  it("defines settled bar wrapper and label classes", () => {
    expect(css).toContain(".race-settled-wrap");
    expect(css).toContain(".race-settled-label");
  });

  it("includes race legend in 720px mobile region", () => {
    const afterMedia = cssFromMedia720(css);
    expect(afterMedia).toContain(".race-legend");
  });
});

describe("issue #66 transport groups CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  /**
   * Slice of the stylesheet from the first 720px media query onward.
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

  it("defines transport playback, export, and play group classes", () => {
    expect(css).toContain(".transport-playback");
    expect(css).toContain(".transport-export");
    expect(css).toContain(".transport-play");
  });

  it("sets margin-left auto on transport-export in desktop rules", () => {
    const marker = "@media (max-width: 720px)";
    const index = css.indexOf(marker);
    expect(index).toBeGreaterThanOrEqual(0);
    const desktopCss = css.slice(0, index);
    expect(desktopCss).toMatch(/\.transport-export\s*\{[\s\S]*?margin-left:\s*auto/);
  });

  it("reorders transport groups below 720px", () => {
    const afterMedia = cssFromMedia720(css);
    expect(afterMedia).toMatch(/\.transport-export\s*\{[\s\S]*?flex-basis:\s*100%/);
    expect(afterMedia).toMatch(/\.transport-export\s*\{[\s\S]*?margin-left:\s*0/);
    expect(afterMedia).toMatch(/\.transport-play\s*\{[\s\S]*?order:\s*-1/);
  });
});

describe("issue #67 race wide layout CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  /**
   * Desktop rules only (before the first 720px breakpoint).
   *
   * @param stylesheet - Full style.css source.
   * @returns Text before `@media (max-width: 720px)`.
   */
  function desktopCss(stylesheet: string): string {
    const marker = "@media (max-width: 720px)";
    const index = stylesheet.indexOf(marker);
    expect(index).toBeGreaterThanOrEqual(0);
    return stylesheet.slice(0, index);
  }

  /**
   * Slice from the first 720px media query to EOF.
   *
   * @param stylesheet - Full style.css source.
   * @returns Text from `@media (max-width: 720px)` onward.
   */
  function cssFromMedia720(stylesheet: string): string {
    const marker = "@media (max-width: 720px)";
    const index = stylesheet.indexOf(marker);
    expect(index).toBeGreaterThanOrEqual(0);
    return stylesheet.slice(index);
  }

  it("defines a shared 1200px content-max token on race mode", () => {
    expect(css).toMatch(/#app\[data-mode="race"\]\s*\{[\s\S]*?--race-content-max:\s*1200px/);
  });

  it("aligns race header and race-root on the same centered axis", () => {
    expect(css).toContain('#app[data-mode="race"] > .lens-header');
    expect(css).toContain('#app[data-mode="race"] > .race-root');
    expect(css).toMatch(
      /#app\[data-mode="race"\]\s*>\s*\.lens-header,\s*\n#app\[data-mode="race"\]\s*>\s*\.race-root\s*\{[\s\S]*?width:\s*min\(\s*var\(--race-content-max\),\s*100%\s*\)/,
    );
    expect(css).toMatch(
      /#app\[data-mode="race"\]\s*>\s*\.lens-header,\s*\n#app\[data-mode="race"\]\s*>\s*\.race-root\s*\{[\s\S]*?align-self:\s*center/,
    );
  });

  it("does not left-anchor .race-root with align-self stretch", () => {
    const desktop = desktopCss(css);
    const rootBlock = desktop.match(/\.race-root\s*\{[^}]*\}/);
    expect(rootBlock).not.toBeNull();
    expect(rootBlock?.[0] ?? "").not.toMatch(/align-self:\s*stretch/);
  });

  it("keeps 2- and 3-lane grid templates", () => {
    expect(css).toMatch(/\.race-lanes\[data-lanes="2"\][\s\S]*?grid-template-columns:\s*1fr\s+1fr/);
    expect(css).toMatch(
      /\.race-lanes\[data-lanes="3"\][\s\S]*?grid-template-columns:\s*1fr\s+1fr\s+1fr/,
    );
  });

  it("still stacks lanes vertically below 720px", () => {
    const afterMedia = cssFromMedia720(css);
    expect(afterMedia).toMatch(/\.race-lanes\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  });

  it("does not upscale race canvases with 100vw", () => {
    const canvasBlock = css.match(/\.race-canvas\s*\{[^}]*\}/);
    expect(canvasBlock).not.toBeNull();
    const block = canvasBlock?.[0] ?? "";
    expect(block).toMatch(/width:\s*100%/);
    expect(block).not.toContain("100vw");
  });

  it("leaves story-root left-stretch unchanged", () => {
    expect(css).toMatch(/\.story-root\s*\{[\s\S]*?align-self:\s*stretch/);
  });
});

describe("issue #68 diff view CSS", () => {
  const css = readFileSync(STYLE_CSS, "utf8");

  it("defines dark-theme diff color tokens on :root", () => {
    expect(css).toMatch(/:root\s*\{[\s\S]*?--diff-marble:\s*rgb\(180,\s*176,\s*168\)/);
    expect(css).toMatch(/:root\s*\{[\s\S]*?--diff-ember:\s*rgb\(180,\s*70,\s*40\)/);
    expect(css).toMatch(/:root\s*\{[\s\S]*?--diff-both:\s*rgb\(160,\s*153,\s*140\)/);
  });

  it("overrides diff color tokens in light theme", () => {
    expect(css).toMatch(
      /\[data-theme="light"\]\s*\{[\s\S]*?--diff-marble:\s*rgb\(90,\s*86,\s*80\)/,
    );
    expect(css).toMatch(
      /\[data-theme="light"\]\s*\{[\s\S]*?--diff-ember:\s*rgb\(180,\s*70,\s*40\)/,
    );
    expect(css).toMatch(
      /\[data-theme="light"\]\s*\{[\s\S]*?--diff-both:\s*rgb\(120,\s*112,\s*100\)/,
    );
  });

  it("defines diff view layout hooks", () => {
    expect(css).toContain(".race-diff-wrap");
    expect(css).toContain('.race-root[data-view="diff"]');
    expect(css).toContain(".race-diff");
  });

  it("defines diff legend swatch data hooks", () => {
    expect(css).toContain('[data-swatch="diff-left"]');
    expect(css).toContain('[data-swatch="diff-right"]');
    expect(css).toContain('[data-swatch="diff-both"]');
    expect(css).toContain('[data-swatch="diff-ooo"]');
  });
});
