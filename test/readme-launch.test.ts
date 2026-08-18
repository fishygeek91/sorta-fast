import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { run as runBmssp } from "../src/core/bmssp/bmssp.ts";
import { run as runDmsy } from "../src/core/dmsy/dmsy.ts";
import { run as runDijkstra } from "../src/core/dijkstra.ts";
import { generateGraph, pickFinishVertex } from "../src/core/graph.ts";
import { costOf, type TraceEvent } from "../src/core/trace.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(TEST_DIR, "../README.md");
const HERO_GIF_PATH = join(TEST_DIR, "../docs/assets/hero.gif");

/** Story-city hero seed recorded for the Round-2 GIF and OG card. */
const HERO_KIND = "city";
const HERO_N = 500;
const HERO_SEED = 1729;
const HERO_SOURCE = 0;

/**
 * Return true when `haystack` contains `needle`, case-insensitive.
 */
function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Format a billed-work total the way README captions do (en-US grouping).
 */
function formatWorkCount(work: number): string {
  return work.toLocaleString("en-US");
}

/**
 * Drain an instrumented lane and snapshot billed work at the target's first
 * settle (photo-finish) plus the settle-all total.
 */
function drainPhotoFinishWork(
  gen: Generator<TraceEvent, unknown, undefined>,
  target: number,
): { photoFinish: number; settleAll: number } {
  let work = 0;
  let photoFinish = Number.NaN;
  for (;;) {
    const step = gen.next();
    if (step.done) {
      break;
    }
    const event = step.value;
    work += costOf(event);
    if (event.k === "settle" && event.v === target && Number.isNaN(photoFinish)) {
      photoFinish = work;
    }
  }
  if (Number.isNaN(photoFinish)) {
    throw new Error(`drainPhotoFinishWork: target ${String(target)} never settled`);
  }
  return { photoFinish, settleAll: work };
}

describe("issue #21 / #28 README launch copy", () => {
  const readme = readFileSync(README_PATH, "utf8");

  it("links the hero GIF and live GitHub Pages URL", () => {
    expect(readme).toContain("docs/assets/hero.gif");
    expect(readme).toContain("https://fishygeek91.github.io/sorta-fast/");
  });

  it("ships docs/assets/hero.gif on disk", () => {
    expect(existsSync(HERO_GIF_PATH)).toBe(true);
  });

  it("mentions the work-clock headline and paper arXiv IDs", () => {
    expect(readme).toContain("Dijkstra wins the work clock");
    expect(readme).toContain("2504.17033");
    expect(readme).toContain("2602.07868");
  });

  it("points readers at the wall-clock bench page", () => {
    expect(readme).toContain("bench");
  });

  it("lists the primary fuzz and crosscheck test entry points", () => {
    expect(readme).toContain("test/dijkstra-fuzz.test.ts");
    expect(readme).toContain("test/bmssp-fuzz.test.ts");
    expect(readme).toContain("test/bmssp-crosscheck.test.ts");
    expect(readme).toContain("test/dmsy-fuzz.test.ts");
  });

  it("advertises the default 3-way race URL", () => {
    expect(readme).toContain("race=dijkstra,bmssp,dmsy");
  });

  it("claims first public DMSY implementation with blog companion", () => {
    expect(includesIgnoreCase(readme, "first public implementation")).toBe(true);
    expect(readme).toContain("docs/blog/implementing-dmsy.md");
  });

  it("does not advertise the site as under construction", () => {
    expect(includesIgnoreCase(readme, "under construction")).toBe(false);
  });

  it("does not defer DMSY to a future release", () => {
    expect(includesIgnoreCase(readme, "planned for v2.0")).toBe(false);
  });

  it("names the city-seed hero as a photo-finish, not the settle-all work clock", () => {
    expect(includesIgnoreCase(readme, "wins the photo-finish")).toBe(true);
    expect(readme).toContain("settle-all work clock");
  });

  it("pins hero caption photo-finish and settle-all totals to drained traces", () => {
    const graph = generateGraph(HERO_KIND, HERO_N, HERO_SEED);
    const target = pickFinishVertex(graph, HERO_SOURCE);
    expect(target).toBe(401);

    const dijkstra = drainPhotoFinishWork(runDijkstra(graph, HERO_SOURCE), target);
    const bmssp = drainPhotoFinishWork(runBmssp(graph, HERO_SOURCE), target);
    const dmsy = drainPhotoFinishWork(runDmsy(graph, HERO_SOURCE), target);

    expect(readme).toContain(formatWorkCount(dijkstra.photoFinish));
    expect(readme).toContain(formatWorkCount(bmssp.photoFinish));
    expect(readme).toContain(formatWorkCount(dmsy.photoFinish));
    expect(readme).toContain(formatWorkCount(dijkstra.settleAll));
    expect(readme).toContain(formatWorkCount(bmssp.settleAll));
    expect(readme).toContain(formatWorkCount(dmsy.settleAll));
  }, 30_000);
});
