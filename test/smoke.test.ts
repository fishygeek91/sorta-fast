import { describe, expect, it } from "vitest";

/**
 * Scaffold smoke test — proves vitest + CI wiring (issue #1).
 * Real science tests land with graph/trace/algorithm issues.
 */
describe("scaffold smoke", () => {
  it("runs a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
