import { describe, expect, it } from "vitest";

import { generateGraph } from "../src/core/graph.ts";
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

  it("round-trips adversarial graph kind", () => {
    const state: RaceUrlState = {
      g: "adversarial",
      n: 500,
      seed: 7,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp"],
      t: 0,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    };
    const query = serializeRaceUrl(state);
    expect(query).toContain("g=adversarial");
    expect(parseRaceUrl(query)).toEqual(state);
  });

  it("parses g=city&n=100000 even though generation would throw (issue #32)", () => {
    expect(parseRaceUrl("?g=city&n=100000&seed=1")).toEqual({
      g: "city",
      n: 100000,
      seed: 1,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp", "dmsy"],
      t: 0,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    });
  });

  it("round-trips city / 5000 / 1729 with t scrub position", () => {
    const state: RaceUrlState = {
      g: "city",
      n: 5000,
      seed: 1729,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp"],
      t: 48210,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    };
    const query = serializeRaceUrl(state);
    expect(parseRaceUrl(query)).toEqual(state);
  });

  it("round-trips bmssp paper mode with bk and bt block params", () => {
    const state: RaceUrlState = {
      g: "sparse",
      n: 25000,
      seed: 4,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp"],
      t: 0,
      bmssp: "paper",
      bk: 8,
      bt: 3,
      view: "lanes",
    };
    const query = serializeRaceUrl(state);
    expect(query).toContain("bmssp=paper");
    expect(query).toContain("bk=8");
    expect(query).toContain("bt=3");
    expect(parseRaceUrl(query)).toEqual(state);
  });

  it("omits bmssp when demo and omits bk/bt when null", () => {
    const state: RaceUrlState = {
      g: "sparse",
      n: 25000,
      seed: 4,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp"],
      t: 0,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    };
    const query = serializeRaceUrl(state);
    expect(query).not.toContain("bmssp=");
    expect(query).not.toContain("bk=");
    expect(query).not.toContain("bt=");
    expect(parseRaceUrl(query)).toEqual(state);
  });

  it("parses t as work-clock scrub, not BMSSP block t", () => {
    expect(parseRaceUrl("?t=48210")).toEqual({ ...DEFAULT_RACE_URL, t: 48210 });
    expect(parseRaceUrl("?bk=8&bt=3&t=100")).toEqual({
      ...DEFAULT_RACE_URL,
      bk: 8,
      bt: 3,
      t: 100,
    });
  });

  it("nulls invalid bk and bt block params", () => {
    expect(parseRaceUrl("?bk=0")).toEqual({ ...DEFAULT_RACE_URL, bk: null });
    expect(parseRaceUrl("?bt=0")).toEqual({ ...DEFAULT_RACE_URL, bt: null });
    expect(parseRaceUrl("?bk=1.5")).toEqual({ ...DEFAULT_RACE_URL, bk: null });
    expect(parseRaceUrl("?bt=abc")).toEqual({ ...DEFAULT_RACE_URL, bt: null });
  });

  it("defaults bmssp to demo when missing, empty, or invalid", () => {
    expect(parseRaceUrl("?bmssp=demo")).toEqual({ ...DEFAULT_RACE_URL, bmssp: "demo" });
    expect(parseRaceUrl("?bmssp=")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?bmssp=invalid")).toEqual(DEFAULT_RACE_URL);
  });

  it("parses bmssp=paper", () => {
    expect(parseRaceUrl("?bmssp=paper")).toEqual({ ...DEFAULT_RACE_URL, bmssp: "paper" });
  });

  it("omits t from serialize when zero and parses missing t as zero", () => {
    const state: RaceUrlState = {
      g: "maze",
      n: 5000,
      seed: 1729,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp"],
      t: 0,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    };
    const query = serializeRaceUrl(state);
    expect(query).not.toContain("t=");
    expect(parseRaceUrl(query)).toEqual(state);
    expect(parseRaceUrl("?g=maze&n=5000&seed=1729&mode=race&race=dijkstra,bmssp")).toEqual(state);
  });

  it("falls back field-by-field on invalid g, n, seed, and t", () => {
    expect(parseRaceUrl("?g=grid")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?n=0")).toEqual({ ...DEFAULT_RACE_URL, n: DEFAULT_RACE_URL.n });
    expect(parseRaceUrl("?n=-5")).toEqual({ ...DEFAULT_RACE_URL, n: DEFAULT_RACE_URL.n });
    expect(parseRaceUrl("?seed=1.5")).toEqual({
      ...DEFAULT_RACE_URL,
      seed: DEFAULT_RACE_URL.seed,
    });
    expect(parseRaceUrl("?t=-1")).toEqual({ ...DEFAULT_RACE_URL, t: 0 });
    expect(parseRaceUrl("?t=abc")).toEqual({ ...DEFAULT_RACE_URL, t: 0 });
  });

  it("defaults mode to race when missing or invalid", () => {
    expect(parseRaceUrl("?g=city&n=100&seed=1")).toEqual({
      g: "city",
      n: 100,
      seed: 1,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp", "dmsy"],
      t: 0,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
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

  it("defaults view to lanes on empty query", () => {
    expect(parseRaceUrl("")).toEqual({ ...DEFAULT_RACE_URL, view: "lanes" });
    expect(parseRaceUrl("?")).toEqual({ ...DEFAULT_RACE_URL, view: "lanes" });
  });

  it("parses view=diff only when exactly diff", () => {
    expect(parseRaceUrl("?view=diff")).toEqual({
      ...DEFAULT_RACE_URL,
      view: "diff",
    });
  });

  it("defaults view to lanes for lanes, empty, and invalid values", () => {
    expect(parseRaceUrl("?view=lanes")).toEqual({ ...DEFAULT_RACE_URL, view: "lanes" });
    expect(parseRaceUrl("?view=")).toEqual({ ...DEFAULT_RACE_URL, view: "lanes" });
    expect(parseRaceUrl("?view=invalid")).toEqual({ ...DEFAULT_RACE_URL, view: "lanes" });
  });

  it("omits view from serialize when lanes and includes view=diff when diff", () => {
    const defaultQuery = serializeRaceUrl(DEFAULT_RACE_URL);
    expect(defaultQuery).not.toContain("view=");

    const diffState = { ...DEFAULT_RACE_URL, view: "diff" as const };
    const diffQuery = serializeRaceUrl(diffState);
    expect(diffQuery).toContain("view=diff");
    expect(parseRaceUrl(diffQuery)).toEqual(diffState);
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
      race: ["dijkstra", "bmssp", "dmsy"],
      t: 0,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    });
  });

  it("keeps dmsy in race list for explicit DMSY triple", () => {
    expect(parseRaceUrl("?race=dijkstra,bmssp,dmsy")).toEqual(DEFAULT_RACE_URL);
  });

  it("falls back to default three-lane DMSY when race has only dmsy or a single valid token", () => {
    expect(parseRaceUrl("?race=dmsy")).toEqual(DEFAULT_RACE_URL);
    expect(parseRaceUrl("?race=dijkstra")).toEqual(DEFAULT_RACE_URL);
  });

  it("expands legacy lane3=dijkstra to three lanes without race param", () => {
    const parsed = parseRaceUrl("?lane3=dijkstra");
    expect(parsed.race).toEqual(["dijkstra", "bmssp", "dijkstra"]);
    const query = serializeRaceUrl(parsed);
    const params = new URLSearchParams(query.slice(1));
    expect(params.get("race")).toBe("dijkstra,bmssp,dijkstra");
    expect(query).not.toContain("lane3=");
  });

  it("prefers race= over lane3= and preserves bmssp,dijkstra order", () => {
    expect(parseRaceUrl("?race=bmssp,dijkstra&lane3=dijkstra")).toEqual({
      ...DEFAULT_RACE_URL,
      race: ["bmssp", "dijkstra"],
    });
  });

  it("round-trips lens mode", () => {
    const state: RaceUrlState = {
      g: "sparse",
      n: 500,
      seed: 42,
      mode: "lens",
      target: null,
      race: ["dijkstra", "bmssp"],
      t: 0,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    };
    expect(parseRaceUrl(serializeRaceUrl(state))).toEqual(state);
  });

  it("includes target when set and round-trips", () => {
    const state: RaceUrlState = {
      g: "clusters",
      n: 1000,
      seed: 7,
      mode: "race",
      target: 42,
      race: ["dijkstra", "bmssp"],
      t: 100,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    };
    const query = serializeRaceUrl(state);
    expect(query).toContain("target=42");
    expect(parseRaceUrl(query)).toEqual(state);
  });
});

describe("serializeRaceUrl", () => {
  it("starts with ? and contains g, n, seed, mode, and race", () => {
    const query = serializeRaceUrl({
      g: "sparse",
      n: 25000,
      seed: 99,
      mode: "race",
      target: null,
      race: ["dijkstra", "bmssp"],
      t: 0,
      bmssp: "demo",
      bk: null,
      bt: null,
      view: "lanes",
    });
    expect(query.startsWith("?")).toBe(true);
    expect(query).toContain("g=sparse");
    expect(query).toContain("n=25000");
    expect(query).toContain("seed=99");
    expect(query).toContain("mode=race");
    const params = new URLSearchParams(query.slice(1));
    expect(params.get("race")).toBe("dijkstra,bmssp");
  });

  it("throws on invalid state", () => {
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 0,
        seed: 1,
        mode: "race",
        target: null,
        race: ["dijkstra", "bmssp"],
        t: 0,
        bmssp: "demo",
        bk: null,
        bt: null,
        view: "lanes",
      }),
    ).toThrow(/n must be an integer/);
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 1,
        seed: Number.NaN,
        mode: "race",
        target: null,
        race: ["dijkstra", "bmssp"],
        t: 0,
        bmssp: "demo",
        bk: null,
        bt: null,
        view: "lanes",
      }),
    ).toThrow(/seed must be a finite integer/);
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 1,
        seed: 1,
        mode: "race",
        target: -1,
        race: ["dijkstra", "bmssp"],
        t: 0,
        bmssp: "demo",
        bk: null,
        bt: null,
        view: "lanes",
      }),
    ).toThrow(/target must be a non-negative integer/);
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 1,
        seed: 1,
        mode: "race",
        target: null,
        race: ["dijkstra", "bmssp"],
        t: -1,
        bmssp: "demo",
        bk: null,
        bt: null,
        view: "lanes",
      }),
    ).toThrow(/t must be a non-negative integer/);
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 1,
        seed: 1,
        mode: "race",
        target: null,
        race: ["dijkstra"],
        t: 0,
        bmssp: "demo",
        bk: null,
        bt: null,
        view: "lanes",
      }),
    ).toThrow(/race must have length 2 or 3/);
    expect(() =>
      serializeRaceUrl({
        g: "maze",
        n: 1,
        seed: 1,
        mode: "race",
        target: null,
        race: ["dijkstra", "bmssp"],
        t: 0,
        bmssp: "demo",
        bk: null,
        bt: null,
        view: "invalid" as "lanes",
      }),
    ).toThrow(/Invalid race view/);
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
  it("returns three default lane ids on empty search", () => {
    const lanes = lanesFromSearch("");
    expect(lanes.length).toBe(3);
    expect(lanes.map((lane) => lane.id)).toEqual(["dijkstra", "bmssp", "dmsy"]);
  });

  it("adds dijkstra-b as third lane when lane3=dijkstra", () => {
    const lanes = lanesFromSearch("?lane3=dijkstra");
    expect(lanes.length).toBe(3);
    expect(lanes.map((lane) => lane.id)).toEqual(["dijkstra", "bmssp", "dijkstra-b"]);
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

  it("maps three dijkstra,bmssp,dijkstra race tokens to the same lane ids", () => {
    const lanes = lanesFromSearch("?race=dijkstra,bmssp,dijkstra");
    expect(lanes.length).toBe(3);
    expect(lanes.map((lane) => lane.id)).toEqual(["dijkstra", "bmssp", "dijkstra-b"]);
  });

  it("ignores lane3 when value is not dijkstra or 1", () => {
    const lanes = lanesFromSearch("?lane3=bmssp");
    expect(lanes.length).toBe(3);
    expect(lanes.map((lane) => lane.id)).toEqual(["dijkstra", "bmssp", "dmsy"]);
  });

  it("adds DMSY as third lane when lane3=1", () => {
    const lanes = lanesFromSearch("?lane3=1");
    expect(lanes.length).toBe(3);
    expect(lanes.map((lane) => lane.id)).toEqual(["dijkstra", "bmssp", "dmsy"]);
    expect(lanes[2]).toEqual({
      algo: "dmsy",
      id: "dmsy",
      label: "DMSY '26",
      persona: "moss",
    });
  });

  it("round-trips lane3=1 via serialize as canonical race param", () => {
    const parsed = parseRaceUrl("?lane3=1");
    expect(parsed.race).toEqual(["dijkstra", "bmssp", "dmsy"]);
    const query = serializeRaceUrl(parsed);
    const params = new URLSearchParams(query.slice(1));
    expect(params.get("race")).toBe("dijkstra,bmssp,dmsy");
    expect(query).not.toContain("lane3=");
    expect(parseRaceUrl(serializeRaceUrl(parseRaceUrl("?lane3=1"))).race).toEqual([
      "dijkstra",
      "bmssp",
      "dmsy",
    ]);
  });

  it("serializes three-lane parse without lane3 param", () => {
    const parsed = parseRaceUrl("?lane3=dijkstra");
    const query = serializeRaceUrl(parsed);
    const params = new URLSearchParams(query.slice(1));
    expect(params.get("race")).toBe("dijkstra,bmssp,dijkstra");
    expect(query).not.toContain("lane3=");
  });
});

describe("race URL graph reproducibility", () => {
  it("generates identical CSR and layout from parsed URL params", () => {
    const state = parseRaceUrl("?g=maze&n=40&seed=42&race=dijkstra,bmssp");
    const first = generateGraph(state.g, state.n, state.seed);
    const second = generateGraph(state.g, state.n, state.seed);
    expect(first.offsets).toEqual(second.offsets);
    expect(first.targets).toEqual(second.targets);
    expect(first.weights).toEqual(second.weights);
    expect(first.x).toEqual(second.x);
    expect(first.y).toEqual(second.y);
  });
});
