import { describe, expect, it } from "vitest";

import { isBmsspUrlMode, parseBmsspMode, parseOptionalBlockParam } from "../src/ui/bmsspUrl.ts";

describe("parseBmsspMode", () => {
  it("treats missing, empty, demo, and invalid values as demo", () => {
    expect(parseBmsspMode(null)).toBe("demo");
    expect(parseBmsspMode("")).toBe("demo");
    expect(parseBmsspMode("demo")).toBe("demo");
    expect(parseBmsspMode("invalid")).toBe("demo");
  });

  it("returns paper only for the exact paper token", () => {
    expect(parseBmsspMode("paper")).toBe("paper");
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

  it("returns positive integers", () => {
    expect(parseOptionalBlockParam("1")).toBe(1);
    expect(parseOptionalBlockParam("8")).toBe(8);
  });
});

describe("isBmsspUrlMode", () => {
  it("accepts demo and paper only", () => {
    expect(isBmsspUrlMode("demo")).toBe(true);
    expect(isBmsspUrlMode("paper")).toBe(true);
    expect(isBmsspUrlMode("")).toBe(false);
    expect(isBmsspUrlMode("Paper")).toBe(false);
  });
});
