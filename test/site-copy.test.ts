import { describe, expect, it } from "vitest";

import { OP_COST } from "../src/core/trace.ts";
import {
  COST_TABLE_SOURCE_URL,
  DISCLOSURE_LABELS,
  EXPLAINER_COPY,
  explainerMeaning,
  FAIRNESS_COPY,
  FAIRNESS_COSTS,
  PAPER_LINKS,
  personaTitle,
  RACE_CHROME_COPY,
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
    FAIRNESS_COPY.params,
    FAIRNESS_COPY.sourceLead,
  ].join("\n");
}

/**
 * Return true when `haystack` contains `needle`, case-insensitive.
 */
function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Look up the canonical vocabulary meaning from {@link EXPLAINER_COPY}.
 */
function vocabularyMeaning(term: string): string {
  const entry = EXPLAINER_COPY.vocabulary.find((v) => v.term === term);
  if (entry === undefined) {
    throw new Error(`vocabularyMeaning: missing fixture term "${term}"`);
  }
  return entry.meaning;
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

    it("params paragraph discloses paper formula, demo k, and asymptotic k threshold", () => {
      const prose = joinFairnessCopy();

      expect(includesIgnoreCase(prose, "paper")).toBe(true);
      expect(
        includesIgnoreCase(prose, "demo") ||
          includesIgnoreCase(prose, "browser scale") ||
          includesIgnoreCase(prose, "browser-scale"),
      ).toBe(true);
      expect(
        prose.includes("2²⁷") ||
          prose.includes("2^27") ||
          prose.includes("134") ||
          includesIgnoreCase(prose, "asymptotic"),
      ).toBe(true);
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
        "Unreached",
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

  describe("RACE_CHROME_COPY", () => {
    it('legendFrontier is "Frontier"', () => {
      expect(RACE_CHROME_COPY.legendFrontier).toBe("Frontier");
    });

    it("outOfOrder counter title cites BMSSP shortcut, zero for Dijkstra, and Dijkstra", () => {
      const { outOfOrder } = RACE_CHROME_COPY.counterTitles;

      expect(includesIgnoreCase(outOfOrder, "BMSSP")).toBe(true);
      expect(outOfOrder).toContain("0");
      expect(includesIgnoreCase(outOfOrder, "Dijkstra")).toBe(true);
    });

    it('diceTitle is "Roll a new random seed"', () => {
      expect(RACE_CHROME_COPY.diceTitle).toBe("Roll a new random seed");
    });

    it('settledLabel is "settled"', () => {
      expect(RACE_CHROME_COPY.settledLabel).toBe("settled");
    });

    it('stubPersonaTitle is "Duplicate Dijkstra lane"', () => {
      expect(RACE_CHROME_COPY.stubPersonaTitle).toBe("Duplicate Dijkstra lane");
    });

    it("bmsspSelectTitle mentions Demo, Paper, and Fairness", () => {
      const { bmsspSelectTitle } = RACE_CHROME_COPY;

      expect(includesIgnoreCase(bmsspSelectTitle, "Demo")).toBe(true);
      expect(includesIgnoreCase(bmsspSelectTitle, "Paper")).toBe(true);
      expect(includesIgnoreCase(bmsspSelectTitle, "Fairness")).toBe(true);
    });

    it('stepEventTitle is "advance one trace event"', () => {
      expect(RACE_CHROME_COPY.stepEventTitle).toBe("advance one trace event");
    });

    it('stepOpTitle is "advance one billed op"', () => {
      expect(RACE_CHROME_COPY.stepOpTitle).toBe("advance one billed op");
    });

    it('exportDisabledTitle is "Available after photo-finish."', () => {
      expect(RACE_CHROME_COPY.exportDisabledTitle).toBe("Available after photo-finish.");
    });
  });

  describe("explainerMeaning / personaTitle", () => {
    it('explainerMeaning("Frontier") matches EXPLAINER_COPY vocabulary', () => {
      expect(explainerMeaning("Frontier")).toBe(vocabularyMeaning("Frontier"));
    });

    it('explainerMeaning("Unreached") matches EXPLAINER_COPY vocabulary', () => {
      expect(explainerMeaning("Unreached")).toBe(vocabularyMeaning("Unreached"));
    });

    it('explainerMeaning("settle-order gradient") matches EXPLAINER_COPY vocabulary', () => {
      expect(explainerMeaning("settle-order gradient")).toBe(
        vocabularyMeaning("settle-order gradient"),
      );
    });

    it('explainerMeaning("photo-finish gold path") matches EXPLAINER_COPY vocabulary', () => {
      expect(explainerMeaning("photo-finish gold path")).toBe(
        vocabularyMeaning("photo-finish gold path"),
      );
    });

    it('explainerMeaning("not-a-term") throws for unknown vocabulary', () => {
      expect(() => explainerMeaning("not-a-term")).toThrowError(/unknown vocabulary term/);
    });

    it('personaTitle("marble") is "The Perfectionist (marble)"', () => {
      expect(personaTitle("marble")).toBe("The Perfectionist (marble)");
    });

    it('personaTitle("ember") is "The Batcher (ember)"', () => {
      expect(personaTitle("ember")).toBe("The Batcher (ember)");
    });

    it('personaTitle("moss") is "The Forester (moss)"', () => {
      expect(personaTitle("moss")).toBe("The Forester (moss)");
    });

    it('personaTitle("stub") throws for unknown accent', () => {
      expect(() => personaTitle("stub")).toThrowError(/unknown accent/);
    });
  });
});
