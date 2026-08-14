import { describe, expect, it } from "vitest";

import { bmsspParams, paperBmsspParams } from "../src/core/bmssp/params.ts";
import { findPivotsKFromEcho, resolveBmsspRunParams } from "../src/harness/bmsspRunParams.ts";

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

describe("findPivotsKFromEcho", () => {
  it("returns echoed k as-is even when graphN would resolve differently", () => {
    const echoedK = 7;
    const graphN = 25000;
    const decoyUrlN = 1;

    expect(findPivotsKFromEcho(graphN, echoedK)).toBe(echoedK);
    expect(findPivotsKFromEcho(graphN, echoedK)).not.toBe(resolveBmsspRunParams(graphN).k);
    expect(findPivotsKFromEcho(decoyUrlN, echoedK)).toBe(echoedK);
    expect(findPivotsKFromEcho(decoyUrlN, echoedK)).not.toBe(resolveBmsspRunParams(decoyUrlN).k);
  });

  it("falls back to resolveBmsspRunParams(graphN) when echo is missing", () => {
    const graphN = 1;
    const decoyUrlN = 25000;

    expect(findPivotsKFromEcho(graphN, undefined)).toBe(resolveBmsspRunParams(graphN).k);
    expect(findPivotsKFromEcho(graphN, undefined, "paper")).toBe(
      resolveBmsspRunParams(graphN, "paper").k,
    );
    expect(findPivotsKFromEcho(graphN, undefined, "paper")).not.toBe(
      resolveBmsspRunParams(decoyUrlN, "paper").k,
    );
  });

  it("forwards mode and k/t overrides into the fallback path", () => {
    const graphN = 25000;

    expect(findPivotsKFromEcho(graphN, undefined, "paper", 8, null)).toBe(
      resolveBmsspRunParams(graphN, "paper", 8, null).k,
    );
  });
});
