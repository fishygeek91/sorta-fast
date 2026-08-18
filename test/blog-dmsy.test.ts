import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BLOG_PATH = join(TEST_DIR, "../docs/blog/implementing-dmsy.md");

/**
 * Return true when `haystack` contains `needle`.
 */
function includes(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}

describe("issue #28 DMSY companion blog", () => {
  const blogExists = existsSync(BLOG_PATH);
  const blog = blogExists ? readFileSync(BLOG_PATH, "utf8") : "";

  it("ships docs/blog/implementing-dmsy.md on disk", () => {
    expect(blogExists).toBe(true);
  });

  it("links paper-notes, the arXiv id, dmsy-fuzz, and DMSY ambiguity ids", () => {
    expect(includes(blog, "paper-notes")).toBe(true);
    expect(includes(blog, "2602.07868")).toBe(true);
    expect(includes(blog, "dmsy-fuzz")).toBe(true);
    expect(includes(blog, "DMSY-P")).toBe(true);
  });
});
