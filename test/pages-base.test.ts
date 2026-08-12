import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

/**
 * GitHub Pages deploy contract tests (issue #4).
 * Locks the Vite `base` path for project Pages hosting at /sorta-fast/
 * and asserts the deploy workflow gates on CI and uses actions/deploy-pages.
 *
 * Does not call `vite.build()` here: a full production build in this suite
 * contends with the 1M-event write/replay budget test on shared CI CPUs.
 * Asset URLs follow `config.base`; the Deploy workflow runs `npm run build`.
 */
describe("GitHub Pages base and deploy workflow", () => {
  it("resolveConfig build mode has base /sorta-fast/", async () => {
    const config = await resolveConfig({}, "build");
    expect(config.base).toBe("/sorta-fast/");
  });

  it("deploy workflow reuses CI and deploy-pages action", async () => {
    const deployPath = join(process.cwd(), ".github", "workflows", "deploy.yml");
    const workflow = await readFile(deployPath, "utf8");
    expect(workflow).toContain("./.github/workflows/ci.yml");
    expect(workflow).toContain("needs: check");
    expect(workflow).toContain("actions/deploy-pages");
  });
});
