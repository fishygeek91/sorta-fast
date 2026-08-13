import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..");

const INLINE_WORKER_PATTERN = "new Worker(new URL(";

/**
 * Read a repository file as UTF-8 text.
 *
 * @param relativePath - Path relative to repo root (e.g. `src/ui/lens.ts`).
 * @returns File contents for source-scan assertions.
 */
function readRepoSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

describe("Vite worker bundling (#48)", () => {
  it("lens.ts uses inline new Worker(new URL( pattern", () => {
    const source = readRepoSource("src/ui/lens.ts");
    expect(source).toContain(INLINE_WORKER_PATTERN);
  });

  it("racePool.ts uses inline new Worker(new URL( pattern", () => {
    const source = readRepoSource("src/harness/racePool.ts");
    expect(source).toContain(INLINE_WORKER_PATTERN);
  });

  it("lens.ts does not use new Worker(workerUrl", () => {
    const source = readRepoSource("src/ui/lens.ts");
    expect(source).not.toContain("new Worker(workerUrl");
  });

  it("racePool.ts does not use new Worker(workerUrl", () => {
    const source = readRepoSource("src/harness/racePool.ts");
    expect(source).not.toContain("new Worker(workerUrl");
  });

  it("ci.yml runs npm run test:build in an isolated job", () => {
    const source = readRepoSource(".github/workflows/ci.yml");
    expect(source).toContain("npm run test:build");
  });
});
