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
    const state: LensUrlState = {
      g: "city",
      n: 500,
      seed: 42,
      algo: "bmssp",
      bmssp: "demo",
      bk: null,
      bt: null,
    };
    const query = serializeLensUrl(state);
    expect(parseLensUrl(query)).toEqual(state);
  });

  it("round-trips bmssp paper mode with bk and bt block params", () => {
    const state: LensUrlState = {
      g: "sparse",
      n: 25000,
      seed: 4,
      algo: "bmssp",
      bmssp: "paper",
      bk: 8,
      bt: 3,
    };
    const query = serializeLensUrl(state);
    expect(query).toContain("bmssp=paper");
    expect(query).toContain("bk=8");
    expect(query).toContain("bt=3");
    expect(parseLensUrl(query)).toEqual(state);
  });

  it("omits bmssp when demo and omits bk/bt when null", () => {
    const query = serializeLensUrl(DEFAULT_LENS_URL);
    expect(query).not.toContain("bmssp=");
    expect(query).not.toContain("bk=");
    expect(query).not.toContain("bt=");
    expect(parseLensUrl(query)).toEqual(DEFAULT_LENS_URL);
  });

  it("nulls invalid bk and bt block params", () => {
    expect(parseLensUrl("?bk=0")).toEqual({ ...DEFAULT_LENS_URL, bk: null });
    expect(parseLensUrl("?bt=0")).toEqual({ ...DEFAULT_LENS_URL, bt: null });
    expect(parseLensUrl("?bk=1.5")).toEqual({ ...DEFAULT_LENS_URL, bk: null });
    expect(parseLensUrl("?bt=abc")).toEqual({ ...DEFAULT_LENS_URL, bt: null });
  });

  it("defaults bmssp to demo when missing, empty, or invalid", () => {
    expect(parseLensUrl("?bmssp=demo")).toEqual({ ...DEFAULT_LENS_URL, bmssp: "demo" });
    expect(parseLensUrl("?bmssp=")).toEqual(DEFAULT_LENS_URL);
    expect(parseLensUrl("?bmssp=invalid")).toEqual(DEFAULT_LENS_URL);
  });

  it("parses bmssp=paper", () => {
    expect(parseLensUrl("?bmssp=paper")).toEqual({ ...DEFAULT_LENS_URL, bmssp: "paper" });
  });

  it("round-trips dijkstra and bmssp algo values", () => {
    const dijkstra: LensUrlState = {
      g: "maze",
      n: 100,
      seed: 1,
      algo: "dijkstra",
      bmssp: "demo",
      bk: null,
      bt: null,
    };
    const bmssp: LensUrlState = {
      g: "maze",
      n: 100,
      seed: 1,
      algo: "bmssp",
      bmssp: "demo",
      bk: null,
      bt: null,
    };
    expect(parseLensUrl(serializeLensUrl(dijkstra))).toEqual(dijkstra);
    expect(parseLensUrl(serializeLensUrl(bmssp))).toEqual(bmssp);
  });

  it("defaults algo to bmssp when missing or invalid", () => {
    expect(parseLensUrl("?g=city&n=100&seed=1")).toEqual({
      g: "city",
      n: 100,
      seed: 1,
      algo: "bmssp",
      bmssp: "demo",
      bk: null,
      bt: null,
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
    expect(parsed).toEqual({
      g: "sparse",
      n: 1000,
      seed: 7,
      algo: "bmssp",
      bmssp: "demo",
      bk: null,
      bt: null,
    });
  });
});

describe("serializeLensUrl", () => {
  it("starts with ? and contains g, n, seed, and algo", () => {
    const query = serializeLensUrl({
      g: "clusters",
      n: 25000,
      seed: 99,
      algo: "bmssp",
      bmssp: "demo",
      bk: null,
      bt: null,
    });
    expect(query.startsWith("?")).toBe(true);
    expect(query).toContain("g=clusters");
    expect(query).toContain("n=25000");
    expect(query).toContain("seed=99");
    expect(query).toContain("algo=bmssp");
  });

  it("throws on invalid state", () => {
    expect(() =>
      serializeLensUrl({
        g: "maze",
        n: 0,
        seed: 1,
        algo: "bmssp",
        bmssp: "demo",
        bk: null,
        bt: null,
      }),
    ).toThrow(/n must be an integer/);
    expect(() =>
      serializeLensUrl({
        g: "maze",
        n: 1.5,
        seed: 1,
        algo: "bmssp",
        bmssp: "demo",
        bk: null,
        bt: null,
      }),
    ).toThrow(/n must be an integer/);
    expect(() =>
      serializeLensUrl({
        g: "maze",
        n: 1,
        seed: Number.NaN,
        algo: "bmssp",
        bmssp: "demo",
        bk: null,
        bt: null,
      }),
    ).toThrow(/seed must be a finite integer/);
    expect(() =>
      serializeLensUrl({
        g: "maze",
        n: 1,
        seed: 1,
        algo: "dmsy" as "bmssp",
        bmssp: "demo",
        bk: null,
        bt: null,
      }),
    ).toThrow(/Invalid lens algo/);
  });
});
