import { describe, expect, it } from "vitest";

import { lanesFromSearch } from "../src/ui/raceLanes.ts";
import {
  DEFAULT_RACE_URL,
  parseRaceUrl,
  serializeRaceUrl,
  type RaceUrlState,
} from "../src/ui/raceUrl.ts";
import { DEFAULT_LENS_URL, serializeLensUrl } from "../src/ui/urlState.ts";

describe("parseRaceUrl", () => {
  it("returns defaults on empty input", () => {
    expect(parseRaceUrl("")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl(new URLSearchParams())).toEqual(DEFAULT_RACE_URL);
  });

  it("round-trips city / 500 / 42 with lens mode, target, and lane3", () => {
    const state: RaceUrlState = {
      g: "city",
      n: 500,
      seed: 42,
      mode: "lens",
      target: 10,
      lane3: "dijkstra",
    };
    const query = serializeRaceUrl(state);
    expect(parseRaceUrl(query)).toEqual(state);
  });

  it("round-trips race defaults without optional fields", () => {
    const state: RaceUrlState = {
      g: "sparse",
      n: 1000,
      seed: 7,
      mode: "race",
      target: null,
      lane3: null,
    };
    expect(parseRaceUrl(serializeRaceUrl(state))).toEqual(state);
  });

  it("defaults mode to race when missing or invalid", () => {
    expect(parseRaceUrl("?g=city&n=100&seed=1")).toEqual({
      g: "city",
      n: 100,
      seed: 1,
      mode: "race",
      target: null,
      lane3: null,
    });
    expect(parseRaceUrl("?mode=race")).toEqual({
      ...DEFAULT_RACE_URL,
      mode: "race",
    });
    expect(parseRaceUrl("?mode=invalid")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?mode=")).toEqual(DEFAULT_RACE_URL);
  });

  it("parses lens mode only when exactly lens", () => {
    expect(parseRaceUrl("?mode=lens")).toEqual({
      ...DEFAULT_RACE_URL,
      mode: "lens",
    });
  });

  it("parses lane3=dijkstra and ignores lane3=1 and other values", () => {
    expect(parseRaceUrl("?lane3=dijkstra")).toEqual({
      ...DEFAULT_RACE_URL,
      lane3: "dijkstra",
    });
    expect(parseRaceUrl("?lane3=1")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?lane3=bmssp")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?lane3=")).toEqual(DEFAULT_RACE_URL);
  });

  it("parses non-negative target and nulls invalid target", () => {
    expect(parseRaceUrl("?target=0")).toEqual({
      ...DEFAULT_RACE_URL,
      target: 0,
    });
    expect(parseRaceUrl("?target=4999")).toEqual({
      ...DEFAULT_RACE_URL,
      target: 4999,
    });
    expect(parseRaceUrl("?target=-1")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?target=3.5")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?target=abc")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?target=")).toEqual(DEFAULT_RACE_URL);
  });

  it("falls back to default g on invalid graph kind", () => {
    expect(parseRaceUrl("?g=grid")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?g=")).toEqual(DEFAULT_RACE_URL);
  });

  it("falls back to default n and seed on invalid values", () => {
    expect(parseRaceUrl("?n=0")).toEqual({ ...DEFAULT_RACE_URL, n: DEFAULT_RACE_URL.n });
    expect(parseRaceUrl("?seed=NaN")).toEqual({
      ...DEFAULT_RACE_URL,
      seed: DEFAULT_RACE_URL.seed,
    });
  });

  it("ignores extra query keys", () => {
    const parsed = parseRaceUrl("?g=sparse&n=1000&seed=7&algo=bmssp&speed=4&scrub=100");
    expect(parsed).toEqual({
      g: "sparse",
      n: 1000,
      seed: 7,
      mode: "race",
      target: null,
      lane3: null,
    });
  });
});

describe("serializeRaceUrl", () => {
  it("starts with ? and always includes g, n, seed, and mode", () => {
    const query = serializeRaceUrl({
      g: "clusters",
      n: 25000,
      seed: 99,
      mode: "race",
      target: null,
      lane3: null,
    });
    expect(query.startsWith("?")).toBe(true);
    expect(query).toContain("g=clusters");
    expect(query).toContain("n=25000");
    expect(query).toContain("seed=99");
    expect(query).toContain("mode=race");
    expect(query).not.toContain("target=");
    expect(query).not.toContain("lane3=");
  });

  it("includes target and lane3 only when set", () => {
    const withOptional = serializeRaceUrl({
      g: "maze",
      n: 5000,
      seed: 1729,
      mode: "lens",
      target: 42,
      lane3: "dijkstra",
    });
    expect(withOptional).toContain("target=42");
    expect(withOptional).toContain("lane3=dijkstra");
    expect(withOptional).toContain("mode=lens");
  });

  it("throws on invalid state", () => {
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 0,
        seed: 1,
        mode: "race",
        target: null,
        lane3: null,
      }),
    ).toThrow(/n must be an integer/);
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 1,
        seed: Number.NaN,
        mode: "race",
        target: null,
        lane3: null,
      }),
    ).toThrow(/seed must be a finite integer/);
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 1,
        seed: 1,
        mode: "race",
        target: -1,
        lane3: null,
      }),
    ).toThrow(/target must be a non-negative integer/);
  });
});

describe("lens URL mode contract", () => {
  it("parses mode=lens when appended to serializeLensUrl output", () => {
    const query = `${serializeLensUrl(DEFAULT_LENS_URL)}&mode=lens`;
    expect(parseRaceUrl(query).mode).toBe("lens");
  });

  it("defaults to mode=race for serializeLensUrl-only query", () => {
    expect(parseRaceUrl(serializeLensUrl(DEFAULT_LENS_URL)).mode).toBe("race");
  });
});

describe("lanesFromSearch", () => {
  it("returns two default lanes when lane3 is absent or invalid", () => {
    expect(lanesFromSearch("")).toHaveLength(2);
    expect(lanesFromSearch("?")).toHaveLength(2);
    expect(lanesFromSearch("?lane3=1")).toHaveLength(2);
    expect(lanesFromSearch("?lane3=bmssp")).toHaveLength(2);
    expect(lanesFromSearch(new URLSearchParams())).toHaveLength(2);
  });

  it("returns three lanes when lane3=dijkstra", () => {
    const lanes = lanesFromSearch("?lane3=dijkstra");
    expect(lanes).toHaveLength(3);
    expect(lanes[0]).toEqual({
      algo: "dijkstra",
      id: "dijkstra",
      label: "Dijkstra",
      persona: "marble",
    });
    expect(lanes[1]).toEqual({
      algo: "bmssp",
      id: "bmssp",
      label: "BMSSP '25",
      persona: "ember",
    });
    expect(lanes[2]).toEqual({
      algo: "dijkstra",
      id: "dijkstra-b",
      label: "Dijkstra B",
      persona: "stub",
    });
  });
});
