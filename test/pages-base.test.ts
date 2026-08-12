import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build, resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

/**
 * GitHub Pages deploy contract tests (issue #4).
 * Locks the Vite `base` path for project Pages hosting at /sorta-fast/,
 * verifies production HTML references assets under that base, and asserts
 * the deploy workflow gates on CI and uses actions/deploy-pages.
 */
describe("GitHub Pages base and deploy workflow", () => {
  it("resolveConfig build mode has base /sorta-fast/", async () => {
    const config = await resolveConfig({}, "build");
    expect(config.base).toBe("/sorta-fast/");
  });

  it("production build references assets under /sorta-fast/assets/", async () => {
    await build({ configFile: undefined, logLevel: "error" });

    const indexPath = join(process.cwd(), "dist", "index.html");
    const html = await readFile(indexPath, "utf8");
    expect(html).toContain("/sorta-fast/assets/");
    expect(html).not.toContain('src="/assets/');
  });

  it("deploy workflow reuses CI and deploy-pages action", async () => {
    const deployPath = join(process.cwd(), ".github", "workflows", "deploy.yml");
    const workflow = await readFile(deployPath, "utf8");
    expect(workflow).toContain("./.github/workflows/ci.yml");
    expect(workflow).toContain("needs: check");
    expect(workflow).toContain("actions/deploy-pages");
  });
});
