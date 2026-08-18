import { describe, expect, it } from "vitest";

import { dmsyParams, paperDmsyParams } from "../src/core/dmsy/dmsy.ts";
import { resolveDmsyRunParams } from "../src/harness/dmsyRunParams.ts";

describe("resolveDmsyRunParams", () => {
  it("matches demo dmsyParams when mode and overrides are omitted", () => {
    expect(resolveDmsyRunParams(25000)).toEqual(dmsyParams(25000));
  });

  it("treats null k/t as omitted URL overrides", () => {
    expect(resolveDmsyRunParams(25000, "demo", null, null)).toEqual(dmsyParams(25000));
  });

  it("selects paper Lemma 3.9 params", () => {
    expect(resolveDmsyRunParams(25000, "paper")).toEqual(paperDmsyParams(25000));
  });

  it("applies integer k/t overrides on top of the selected mode", () => {
    expect(resolveDmsyRunParams(25000, "paper", 8, null)).toEqual({
      k: 8,
      t: paperDmsyParams(25000).t,
    });
  });

  it("forwards delta into dmsyParams", () => {
    const delta = 5;
    expect(resolveDmsyRunParams(25000, "demo", null, null, delta)).toEqual(
      dmsyParams(25000, { delta }),
    );
  });
});
