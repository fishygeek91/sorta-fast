import { describe, expect, it } from "vitest";

import { isDmsyUrlMode, parseDmsyMode, parseOptionalBlockParam } from "../src/ui/dmsyUrl.ts";

describe("parseDmsyMode", () => {
  it("treats missing, empty, demo, and invalid values as demo", () => {
    expect(parseDmsyMode(null)).toBe("demo");
    expect(parseDmsyMode("")).toBe("demo");
    expect(parseDmsyMode("demo")).toBe("demo");
    expect(parseDmsyMode("invalid")).toBe("demo");
  });

  it("returns paper only for the exact paper token", () => {
    expect(parseDmsyMode("paper")).toBe("paper");
  });
});

describe("parseOptionalBlockParam", () => {
  it("returns null for missing, empty, non-positive, or non-integer input", () => {
    expect(parseOptionalBlockParam(null)).toBeNull();
    expect(parseOptionalBlockParam("")).toBeNull();
    expect(parseOptionalBlockParam("0")).toBeNull();
    expect(parseOptionalBlockParam("-1")).toBeNull();
    expect(parseOptionalBlockParam("1.5")).toBeNull();
    expect(parseOptionalBlockParam("abc")).toBeNull();
  });

  it("returns positive integers for dk/dt-like values", () => {
    expect(parseOptionalBlockParam("1")).toBe(1);
    expect(parseOptionalBlockParam("8")).toBe(8);
  });
});

describe("isDmsyUrlMode", () => {
  it("accepts demo and paper only", () => {
    expect(isDmsyUrlMode("demo")).toBe(true);
    expect(isDmsyUrlMode("paper")).toBe(true);
    expect(isDmsyUrlMode("")).toBe(false);
    expect(isDmsyUrlMode("Paper")).toBe(false);
    expect(isDmsyUrlMode("bmssp")).toBe(false);
  });
});
