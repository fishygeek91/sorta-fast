import { describe, expect, it } from "vitest";

import { bmsspParams, paperBmsspParams } from "../src/core/bmssp/params.ts";
import { resolveBmsspRunParams } from "../src/harness/bmsspRunParams.ts";

describe("resolveBmsspRunParams", () => {
  it("matches demo bmsspParams when mode and overrides are omitted", () => {
    expect(resolveBmsspRunParams(25000)).toEqual(bmsspParams(25000));
  });

  it("treats null k/t as omitted URL overrides", () => {
    expect(resolveBmsspRunParams(25000, "demo", null, null)).toEqual(bmsspParams(25000));
  });

  it("selects paper §3.1 params", () => {
    expect(resolveBmsspRunParams(25000, "paper")).toEqual(paperBmsspParams(25000));
  });

  it("applies integer k/t overrides on top of the selected mode", () => {
    expect(resolveBmsspRunParams(25000, "paper", 8, null)).toEqual({
      k: 8,
      t: paperBmsspParams(25000).t,
    });
  });
});
