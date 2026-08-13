/**
 * Post-build smoke check for Vite worker chunks (issue #48).
 * Invoked by `npm run test:build` after `npm run build`.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Report a failure and mark the process for a non-zero exit.
 * @param message - Human-readable failure reason.
 */
function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

/**
 * Resolve the repository root from this module's location (`test/build-workers.ts`).
 * @returns Absolute path to the repo root directory.
 */
function resolveRepoRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return dirname(dirname(thisFile));
}

/**
 * Find the first built asset filename for a trace worker chunk.
 * @param files - Basenames in `dist/assets`.
 * @param token - Substring that must appear in the chunk name (e.g. `dijkstraTrace`).
 * @returns Matching `.js` filename, or `undefined` when none match.
 */
function findWorkerChunk(files: readonly string[], token: string): string | undefined {
  return files.find((name) => name.includes(token) && name.endsWith(".js"));
}

/**
 * Assert production worker chunks and copied static assets exist under `dist/`.
 */
function main(): void {
  const root = resolveRepoRoot();
  const distDir = join(root, "dist");
  const assetsDir = join(distDir, "assets");

  if (!existsSync(assetsDir)) {
    fail("dist/assets missing — run npm run build first");
    return;
  }

  let files: string[];
  try {
    files = readdirSync(assetsDir);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(`failed to read dist/assets: ${detail}`);
    return;
  }

  const dijkstraChunk = findWorkerChunk(files, "dijkstraTrace");
  if (dijkstraChunk === undefined) {
    fail('no dist/assets/*.js chunk containing "dijkstraTrace"');
    return;
  }

  const bmsspChunk = findWorkerChunk(files, "bmsspTrace");
  if (bmsspChunk === undefined) {
    fail('no dist/assets/*.js chunk containing "bmsspTrace"');
    return;
  }

  const faviconPath = join(distDir, "favicon.svg");
  if (!existsSync(faviconPath)) {
    fail("dist/favicon.svg missing");
    return;
  }

  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    fail("dist/index.html missing — run npm run build first");
    return;
  }

  let indexHtml: string;
  try {
    indexHtml = readFileSync(indexPath, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(`failed to read dist/index.html: ${detail}`);
    return;
  }

  if (!indexHtml.includes("favicon.svg")) {
    fail("dist/index.html does not reference favicon.svg");
    return;
  }

  console.log(`build-workers ok: ${dijkstraChunk}, ${bmsspChunk}`);
}

main();
