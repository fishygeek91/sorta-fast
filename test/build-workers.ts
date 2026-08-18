/**
 * Post-build smoke check for Vite worker chunks (issue #48).
 * Invoked by `npm run test:build` after `npm run build`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/** PNG file signature per RFC 2083. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Regression ceiling from issue #51 (815,118 → 225,213 bytes after pngquant+oxipng). */
const MAX_OG_CARD_BYTES = 400_000;

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

  const dmsyChunk = findWorkerChunk(files, "dmsyTrace");
  if (dmsyChunk === undefined) {
    fail('no dist/assets/*.js chunk containing "dmsyTrace"');
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

  const ogCardPath = join(distDir, "og-card.png");
  if (!existsSync(ogCardPath)) {
    fail("dist/og-card.png missing");
    return;
  }

  const ogCardSize = statSync(ogCardPath).size;
  if (ogCardSize >= MAX_OG_CARD_BYTES) {
    fail(`dist/og-card.png is ${ogCardSize} bytes (max ${MAX_OG_CARD_BYTES})`);
    return;
  }

  let ogCardBytes: Buffer;
  try {
    ogCardBytes = readFileSync(ogCardPath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(`failed to read dist/og-card.png: ${detail}`);
    return;
  }

  if (!ogCardBytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("dist/og-card.png does not have a valid PNG signature");
    return;
  }

  // IHDR width/height at byte offsets 16 and 20 (must match og:image:width/height in index.html).
  const ogCardWidth = ogCardBytes.readUInt32BE(16);
  const ogCardHeight = ogCardBytes.readUInt32BE(20);
  if (ogCardWidth !== 1200 || ogCardHeight !== 630) {
    fail(`dist/og-card.png IHDR is ${ogCardWidth}×${ogCardHeight}, expected 1200×630`);
    return;
  }

  if (!indexHtml.includes("og:image")) {
    fail("dist/index.html does not include og:image meta tag");
    return;
  }

  if (!indexHtml.includes("og-card.png")) {
    fail("dist/index.html does not reference og-card.png");
    return;
  }

  const benchIndexPath = join(distDir, "bench/index.html");
  if (!existsSync(benchIndexPath)) {
    fail("dist/bench/index.html missing — run npm run build first");
    return;
  }

  console.log(`build-workers ok: ${dijkstraChunk}, ${bmsspChunk}, ${dmsyChunk}`);
}

main();
