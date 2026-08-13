import { describe, expect, it } from "vitest";

import { rollSeed } from "../src/ui/rollSeed.ts";

describe("rollSeed", () => {
  it("returns the value written by an injected fill", () => {
    expect(
      rollSeed((out) => {
        out[0] = 1729;
      }),
    ).toBe(1729);
  });

  it("returns 0 when fill writes zero", () => {
    expect(
      rollSeed((out) => {
        out[0] = 0;
      }),
    ).toBe(0);
  });

  it("returns 4294967295 when fill writes 0xffffffff", () => {
    expect(
      rollSeed((out) => {
        out[0] = 0xffffffff;
      }),
    ).toBe(4294967295);
  });

  it("returns a finite uint32 integer on the default crypto path", () => {
    const value = rollSeed();
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });

  it("returns 0 when fill leaves the zero-filled buffer unchanged", () => {
    expect(rollSeed(() => {})).toBe(0);
  });
});
