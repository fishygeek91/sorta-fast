import { describe, expect, it } from "vitest";

import { OP_COST } from "../src/core/trace.ts";
import {
  COST_TABLE_SOURCE_URL,
  DISCLOSURE_LABELS,
  EXPLAINER_COPY,
  FAIRNESS_COPY,
  FAIRNESS_COSTS,
  PAPER_LINKS,
} from "../src/ui/siteCopy.ts";

/**
 * Concatenate all fairness panel prose into one searchable blob.
 */
function joinFairnessCopy(): string {
  return [
    FAIRNESS_COPY.intro,
    ...FAIRNESS_COPY.billed,
    ...FAIRNESS_COPY.unbilled,
    FAIRNESS_COPY.headline,
    FAIRNESS_COPY.secondary,
    FAIRNESS_COPY.honesty,
    FAIRNESS_COPY.sourceLead,
  ].join("\n");
}

/**
 * Return true when `haystack` contains `needle`, case-insensitive.
 */
function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

describe("siteCopy", () => {
  describe("FAIRNESS_COSTS", () => {
    it("deep-equals OP_COST from trace.ts", () => {
      expect(FAIRNESS_COSTS).toEqual(OP_COST);
    });
  });

  describe("COST_TABLE_SOURCE_URL", () => {
    it("points at the trace cost table without a line anchor", () => {
      expect(COST_TABLE_SOURCE_URL).toBe(
        "https://github.com/fishygeek91/sorta-fast/blob/main/src/core/trace.ts",
      );
    });
  });

  describe("FAIRNESS_COPY", () => {
    it("mentions work clock, comparisons, heap/D-structure, relaxations, out-of-order, and Dijkstra zero", () => {
      const prose = joinFairnessCopy();

      expect(includesIgnoreCase(prose, "work clock")).toBe(true);
      expect(includesIgnoreCase(prose, "total comparisons")).toBe(true);
      expect(includesIgnoreCase(prose, "heap")).toBe(true);
      expect(includesIgnoreCase(prose, "D-structure")).toBe(true);
      expect(includesIgnoreCase(prose, "relaxations") || includesIgnoreCase(prose, "relax")).toBe(
        true,
      );
      expect(includesIgnoreCase(prose, "out of order")).toBe(true);
      expect(includesIgnoreCase(prose, "Dijkstra")).toBe(true);
      expect(prose.includes("0") || includesIgnoreCase(prose, "zero")).toBe(true);
    });
  });

  describe("EXPLAINER_COPY", () => {
    it("barrier cites 66 years, STOC 2025, and arXiv 2602.07868", () => {
      const { barrier } = EXPLAINER_COPY;

      expect(barrier).toContain("66");
      expect(includesIgnoreCase(barrier, "STOC 2025")).toBe(true);
      expect(barrier).toContain("2602.07868");
      expect(includesIgnoreCase(barrier, "four of them")).toBe(true);
    });

    it("argument contrasts perfect order with enough order", () => {
      const { argument } = EXPLAINER_COPY;

      expect(argument).toBe(
        "Dijkstra pays for perfect order; the barrier-breakers pay only for enough order.",
      );
    });

    it("personas include The Perfectionist, The Batcher, and The Forester", () => {
      const personaNames = EXPLAINER_COPY.personas.map((p) => p.persona);

      expect(personaNames).toContain("The Perfectionist");
      expect(personaNames).toContain("The Batcher");
      expect(personaNames).toContain("The Forester");
    });

    it("vocabulary covers overlay terms and a forest-related entry", () => {
      const terms = EXPLAINER_COPY.vocabulary.map((v) => v.term);

      const requiredTerms = [
        "settle-order gradient",
        "Frontier",
        "Relaxed edges (ghost trails)",
        "Recursion tint",
        "Pivot flares",
        "Batch blooms",
        "D-structure strip",
        "photo-finish gold path",
      ];

      for (const term of requiredTerms) {
        expect(terms).toContain(term);
      }

      const hasForestTerm = terms.some((term) => includesIgnoreCase(term, "forest"));
      expect(hasForestTerm).toBe(true);
    });
  });

  describe("PAPER_LINKS", () => {
    it("lists four paper and press links in display order with expected labels", () => {
      const hrefs = PAPER_LINKS.map((link) => link.href);
      const labels = PAPER_LINKS.map((link) => link.label);

      expect(hrefs).toEqual([
        "https://dl.acm.org/doi/10.1145/3717823.3718179",
        "https://arxiv.org/pdf/2504.17033",
        "https://arxiv.org/abs/2602.07868",
        "https://www.quantamagazine.org/new-method-is-the-fastest-way-to-find-the-best-routes-20250806/",
      ]);

      expect(labels).toEqual([
        "STOC 2025",
        "arXiv 2504.17033",
        "arXiv 2602.07868",
        "Quanta, Aug 2025",
      ]);
    });
  });

  describe("DISCLOSURE_LABELS", () => {
    it("matches footer disclosure trigger labels from design.md", () => {
      expect(DISCLOSURE_LABELS).toEqual({
        explainer: "What am I looking at?",
        fairness: "Fairness rules",
        papers: "The papers",
      });
    });
  });
});
