import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(TEST_DIR, "../index.html");

describe("issue #17 Open Graph meta", () => {
  const html = readFileSync(INDEX_HTML, "utf8");

  it("defines og:title, og:description, and og:image with og-card asset", () => {
    expect(html).toContain("og:title");
    expect(html).toContain("og:description");
    expect(html).toContain("og:image");
    expect(html).toContain("og-card.png");
  });

  it("defines og:image dimensions 1200×630", () => {
    expect(html).toContain("og:image:width");
    expect(html).toContain("1200");
    expect(html).toContain("og:image:height");
    expect(html).toContain("630");
  });

  it("defines Twitter summary_large_image card", () => {
    expect(html).toContain("twitter:card");
    expect(html).toContain("summary_large_image");
  });

  it("uses canonical GitHub Pages URL and dark-first html theme", () => {
    expect(html).toContain("https://fishygeek91.github.io/sorta-fast/");
    expect(html).toContain('data-theme="dark"');
  });

  it("mentions DMSY in og:description for the 3-way race", () => {
    expect(html).toContain("og:description");
    expect(html).toContain("DMSY");
  });
});
