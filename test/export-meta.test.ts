import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_PAGES_ORIGIN,
  CANONICAL_PAGES_PATHNAME,
  canExportPhotoFinish,
  exportCaption,
  exportFilename,
  shareUrlForExport,
  shareUrlFromLocation,
} from "../src/ui/exportMeta.ts";
import { DEFAULT_RACE_URL, serializeRaceUrl } from "../src/ui/raceUrl.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(TEST_DIR, "../index.html");

describe("issue #18 export meta", () => {
  describe("canonical Pages constants", () => {
    it("match index.html og:url", () => {
      const html = readFileSync(INDEX_HTML, "utf8");
      const ogUrl = "https://fishygeek91.github.io/sorta-fast/";
      expect(html).toContain(ogUrl);
      expect(CANONICAL_PAGES_ORIGIN + CANONICAL_PAGES_PATHNAME).toBe(ogUrl);
    });
  });

  describe("shareUrlForExport", () => {
    it("uses canonical Pages origin and omits localhost", () => {
      const url = shareUrlForExport(DEFAULT_RACE_URL);
      expect(url.startsWith("https://fishygeek91.github.io/sorta-fast/")).toBe(true);
      expect(url).not.toContain("127.0.0.1");
      expect(url).not.toContain("localhost");
    });

    it("omits t even when state has mid-race scrub position", () => {
      const url = shareUrlForExport({ ...DEFAULT_RACE_URL, t: 999 });
      expect(url).not.toContain("t=");
      expect(url).toContain(serializeRaceUrl({ ...DEFAULT_RACE_URL, t: 0 }));
    });
  });

  describe("shareUrlFromLocation", () => {
    it("concatenates origin, pathname, and serialized query", () => {
      const location = {
        origin: "https://fishygeek91.github.io",
        pathname: "/sorta-fast/",
      };
      const url = shareUrlFromLocation(DEFAULT_RACE_URL, location);
      expect(url).toBe(location.origin + location.pathname + serializeRaceUrl(DEFAULT_RACE_URL));
      expect(url).toContain("g=sparse");
      expect(url).toContain("n=25000");
      expect(url).toContain("seed=4");
      expect(url).toContain("mode=race");
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      expect(params.get("race")).toBe("dijkstra,bmssp");
    });

    it("includes t when t > 0", () => {
      const location = {
        origin: "https://example.com",
        pathname: "/app/",
      };
      const state = { ...DEFAULT_RACE_URL, t: 500 };
      const url = shareUrlFromLocation(state, location);
      expect(url).toBe(location.origin + location.pathname + serializeRaceUrl(state));
      expect(url).toContain("t=500");
    });
  });

  describe("exportFilename", () => {
    const fields = { g: "maze" as const, n: 5000, seed: 1729 };

    it("formats png filename", () => {
      expect(exportFilename(fields, "png")).toBe("sorta-fast-maze-5000-seed-1729.png");
    });

    it("formats webm filename", () => {
      expect(exportFilename(fields, "webm")).toBe("sorta-fast-maze-5000-seed-1729.webm");
    });

    it("formats mp4 filename", () => {
      expect(exportFilename(fields, "mp4")).toBe("sorta-fast-maze-5000-seed-1729.mp4");
    });

    it("throws on bad n", () => {
      expect(() => exportFilename({ g: "maze", n: 0, seed: 1 }, "png")).toThrow(/n must be/);
      expect(() => exportFilename({ g: "maze", n: 1.5, seed: 1 }, "png")).toThrow(/n must be/);
      expect(() => exportFilename({ g: "maze", n: Number.NaN, seed: 1 }, "png")).toThrow(
        /n must be/,
      );
    });

    it("throws on bad seed", () => {
      expect(() => exportFilename({ g: "maze", n: 1, seed: Number.NaN }, "png")).toThrow(
        /seed must be/,
      );
      expect(() => exportFilename({ g: "maze", n: 1, seed: 1.5 }, "png")).toThrow(/seed must be/);
    });
  });

  describe("exportCaption", () => {
    it("returns seed line and url line", () => {
      const shareUrl =
        "https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp";
      const caption = exportCaption(DEFAULT_RACE_URL, shareUrl);
      expect(caption.seedLine).toBe("seed=4");
      expect(caption.urlLine).toBe(shareUrl);
    });
  });

  describe("canExportPhotoFinish", () => {
    it("returns true when all photo frozen", () => {
      expect(canExportPhotoFinish(true)).toBe(true);
    });

    it("returns false when not all photo frozen", () => {
      expect(canExportPhotoFinish(false)).toBe(false);
    });
  });
});
