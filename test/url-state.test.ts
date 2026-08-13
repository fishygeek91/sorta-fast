import { describe, expect, it } from "vitest";

import {
  DEFAULT_LENS_URL,
  parseLensUrl,
  serializeLensUrl,
  type LensUrlState,
} from "../src/ui/urlState.ts";

describe("parseLensUrl", () => {
  it("returns defaults on empty input", () => {
    expect(parseLensUrl("")).toEqual(DEFAULT_LENS_URL);
    expect(parseLensUrl("?")).toEqual(DEFAULT_LENS_URL);
    expect(parseLensUrl(new URLSearchParams())).toEqual(DEFAULT_LENS_URL);
  });

  it("round-trips city / 500 / 42 with default bmssp algo", () => {
    const state: LensUrlState = { g: "city", n: 500, seed: 42, algo: "bmssp" };
    const query = serializeLensUrl(state);
    expect(parseLensUrl(query)).toEqual(state);
  });

  it("round-trips dijkstra and bmssp algo values", () => {
    const dijkstra: LensUrlState = { g: "maze", n: 100, seed: 1, algo: "dijkstra" };
    const bmssp: LensUrlState = { g: "maze", n: 100, seed: 1, algo: "bmssp" };
    expect(parseLensUrl(serializeLensUrl(dijkstra))).toEqual(dijkstra);
    expect(parseLensUrl(serializeLensUrl(bmssp))).toEqual(bmssp);
  });

  it("defaults algo to bmssp when missing or invalid", () => {
    expect(parseLensUrl("?g=city&n=100&seed=1")).toEqual({
      g: "city",
      n: 100,
      seed: 1,
      algo: "bmssp",
    });
    expect(parseLensUrl("?algo=dmsy")).toEqual(DEFAULT_LENS_URL);
    expect(parseLensUrl("?algo=")).toEqual(DEFAULT_LENS_URL);
  });

  it("falls back to default g on invalid graph kind", () => {
    expect(parseLensUrl("?g=grid")).toEqual({
      ...DEFAULT_LENS_URL,
      n: DEFAULT_LENS_URL.n,
      seed: DEFAULT_LENS_URL.seed,
    });
    expect(parseLensUrl("?g=")).toEqual(DEFAULT_LENS_URL);
  });

  it("falls back to default n on invalid node count", () => {
    expect(parseLensUrl("?n=0")).toEqual({ ...DEFAULT_LENS_URL, n: DEFAULT_LENS_URL.n });
    expect(parseLensUrl("?n=-5")).toEqual({ ...DEFAULT_LENS_URL, n: DEFAULT_LENS_URL.n });
    expect(parseLensUrl("?n=3.5")).toEqual({ ...DEFAULT_LENS_URL, n: DEFAULT_LENS_URL.n });
    expect(parseLensUrl("?n=abc")).toEqual({ ...DEFAULT_LENS_URL, n: DEFAULT_LENS_URL.n });
  });

  it("falls back to default seed on invalid seed", () => {
    expect(parseLensUrl("?seed=1.5")).toEqual({
      ...DEFAULT_LENS_URL,
      seed: DEFAULT_LENS_URL.seed,
    });
    expect(parseLensUrl("?seed=NaN")).toEqual({
      ...DEFAULT_LENS_URL,
      seed: DEFAULT_LENS_URL.seed,
    });
    expect(parseLensUrl("?seed=")).toEqual({
      ...DEFAULT_LENS_URL,
      seed: DEFAULT_LENS_URL.seed,
    });
  });

  it("ignores extra query keys", () => {
    const parsed = parseLensUrl("?g=sparse&n=1000&seed=7&race=dijkstra&speed=4");
    expect(parsed).toEqual({ g: "sparse", n: 1000, seed: 7, algo: "bmssp" });
  });
});

describe("serializeLensUrl", () => {
  it("starts with ? and contains g, n, seed, and algo", () => {
    const query = serializeLensUrl({ g: "clusters", n: 25000, seed: 99, algo: "bmssp" });
    expect(query.startsWith("?")).toBe(true);
    expect(query).toContain("g=clusters");
    expect(query).toContain("n=25000");
    expect(query).toContain("seed=99");
    expect(query).toContain("algo=bmssp");
  });

  it("throws on invalid state", () => {
    expect(() => serializeLensUrl({ g: "maze", n: 0, seed: 1, algo: "bmssp" })).toThrow(
      /n must be an integer/,
    );
    expect(() => serializeLensUrl({ g: "maze", n: 1.5, seed: 1, algo: "bmssp" })).toThrow(
      /n must be an integer/,
    );
    expect(() => serializeLensUrl({ g: "maze", n: 1, seed: Number.NaN, algo: "bmssp" })).toThrow(
      /seed must be a finite integer/,
    );
    expect(() => serializeLensUrl({ g: "maze", n: 1, seed: 1, algo: "dmsy" as "bmssp" })).toThrow(
      /Invalid lens algo/,
    );
  });
});
