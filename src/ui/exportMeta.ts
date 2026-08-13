/**
 * Export filename, share URL, and caption helpers (issue #18).
 *
 * Pure helpers for PNG/WebM export metadata — no DOM except an optional
 * location-like input for share URLs.
 */

import { serializeRaceUrl, type RaceUrlState } from "./raceUrl.ts";

/** Raster or video export format. */
export type ExportKind = "png" | "webm" | "mp4";

const EXPORT_EXTENSIONS: Record<ExportKind, string> = {
  png: ".png",
  webm: ".webm",
  mp4: ".mp4",
};

/**
 * @param n - Candidate node count.
 * @throws When `n` is not a finite integer >= 1.
 */
function assertValidNodeCount(n: number): void {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`n must be an integer >= 1, got ${String(n)}`);
  }
}

/**
 * @param seed - Candidate graph seed.
 * @throws When `seed` is not a finite integer.
 */
function assertValidSeed(seed: number): void {
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new Error(`seed must be a finite integer, got ${String(seed)}`);
  }
}

/**
 * Build a full share URL from race state and a location-like input.
 *
 * @param state - Race gallery state to serialize into the query string.
 * @param location - Page origin and pathname (e.g. GitHub Pages deploy URL).
 * @returns `location.origin + location.pathname + serializeRaceUrl(state)`.
 */
export function shareUrlFromLocation(
  state: RaceUrlState,
  location: { origin: string; pathname: string },
): string {
  return location.origin + location.pathname + serializeRaceUrl(state);
}

/**
 * Derive a deterministic export filename from graph fields and format.
 *
 * @param state - Graph kind, node count, and seed (other race fields ignored).
 * @param kind - Export format (`png`, `webm`, or `mp4`).
 * @returns `sorta-fast-{g}-{n}-seed-{seed}.{ext}`.
 * @throws When `n` or `seed` are invalid.
 */
export function exportFilename(
  state: Pick<RaceUrlState, "g" | "n" | "seed">,
  kind: ExportKind,
): string {
  assertValidNodeCount(state.n);
  assertValidSeed(state.seed);
  const ext = EXPORT_EXTENSIONS[kind];
  return `sorta-fast-${state.g}-${String(state.n)}-seed-${String(state.seed)}${ext}`;
}

/**
 * Caption lines for export overlays (seed attribution + share link).
 *
 * @param state - Race state supplying the seed for the caption.
 * @param shareUrl - Full share URL to embed unchanged.
 */
export function exportCaption(
  state: RaceUrlState,
  shareUrl: string,
): {
  seedLine: string;
  urlLine: string;
} {
  return {
    seedLine: `seed=${String(state.seed)}`,
    urlLine: shareUrl,
  };
}

/**
 * Whether photo-finish export is allowed (all lanes frozen at finish).
 *
 * @param allPhotoFrozen - True when every lane has completed photo-finish freeze.
 */
export function canExportPhotoFinish(allPhotoFrozen: boolean): boolean {
  return allPhotoFrozen;
}
