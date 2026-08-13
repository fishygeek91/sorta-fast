/**
 * Static site copy for disclosure panels (issue #16).
 *
 * No DOM, no trace imports, no algorithm code — prose and constants only.
 */

/**
 * Per-op billed costs mirrored for UI disclosure.
 *
 * Must stay in sync with {@link OP_COST} in `src/core/trace.ts`, enforced by
 * `test/site-copy.test.ts`. UI must not import `trace.ts`.
 */
export const FAIRNESS_COSTS = {
  comparison: 1,
  relax: 1,
  settle: 1,
  pivot: 0,
  batch: 0,
  recurse: 0,
  forest: 0,
} as const;

/**
 * Canonical GitHub URL for the trace op-cost table (no line anchor).
 */
export const COST_TABLE_SOURCE_URL =
  "https://github.com/fishygeek91/sorta-fast/blob/main/src/core/trace.ts";

/**
 * Human-readable label for {@link COST_TABLE_SOURCE_URL}.
 */
export const COST_TABLE_LINK_LABEL = "src/core/trace.ts cost table";

/**
 * Structured fairness prose for the disclosure mounter (paragraphs and lists).
 */
export type FairnessCopy = {
  /** Opening paragraph on the shared work clock. */
  intro: string;
  /** Billed operations and their per-event costs. */
  billed: readonly string[];
  /** Zero-cost visualization and control events. */
  unbilled: readonly string[];
  /** Headline race metric explanation. */
  headline: string;
  /** Secondary counters (kind counts, not extra fees). */
  secondary: string;
  /** Wall-clock honesty caveat. */
  honesty: string;
  /** BMSSP k/t honesty: paper formula vs browser-scale demo defaults. */
  params: string;
  /** Lead-in before linking {@link COST_TABLE_SOURCE_URL}. */
  sourceLead: string;
};

/**
 * Fairness panel copy; numeric costs are interpolated from {@link FAIRNESS_COSTS}.
 */
export const FAIRNESS_COPY: FairnessCopy = {
  intro:
    "The race clock is a work clock, not wall-clock time. Every lane advances on identical accounting rules: each trace event bills a fixed op cost, and each lane advances until its cumulative billed cost reaches the shared clock's current tick.",
  billed: [
    `comparison = ${String(FAIRNESS_COSTS.comparison)} (each distance or key comparison)`,
    `heap op = cmps × comparison (${String(FAIRNESS_COSTS.comparison)} per comparison inside the heap)`,
    `D-structure op = cmps × comparison (${String(FAIRNESS_COSTS.comparison)} per comparison inside the partial-sort structure)`,
    `relax = ${String(FAIRNESS_COSTS.relax)}`,
    `settle = ${String(FAIRNESS_COSTS.settle)}`,
  ],
  unbilled: [
    `pivot = ${String(FAIRNESS_COSTS.pivot)} — pivot selection markers for visualization`,
    `batch = ${String(FAIRNESS_COSTS.batch)} — FindPivots / batch phase boundaries`,
    `recurse = ${String(FAIRNESS_COSTS.recurse)} — recursion enter/exit markers`,
    `forest = ${String(FAIRNESS_COSTS.forest)} — spanning-forest grow/cut (DMSY)`,
    "Billing these would penalize BMSSP and DMSY for structure that Dijkstra never emits.",
  ],
  headline:
    'Headline metric: total comparisons — the sum of all billed costs above. Race mode labels this counter "Comparisons."',
  secondary:
    "Secondary counters are kind counts, not extra fees: heap ops, D-structure ops, relaxations, and vertices settled out of order (always 0 for Dijkstra — that invariant is the whole point of the classic rule).",
  honesty:
    "At browser scale (thousands to tens of thousands of nodes), Dijkstra with a binary heap often wins wall-clock time — asymptotics need enormous n and constants are real. We show you where Dijkstra still wins; the work clock is what makes the race fair and legible.",
  params:
    "BMSSP's paper parameters (arXiv 2504.17033 §3.1) are k = ⌊(log₂ n)^{1/3}⌋ and t = ⌊(log₂ n)^{2/3}⌋. At browser scale (S=500 through XL=100k), that formula always yields k = 2; k = 3 does not appear until n ≈ 2²⁷. With k = 2, FindPivots (Lemma 3.2) often aborts when |W| > k|S| on typical gallery degrees, so BMSSP pays Dijkstra-like relaxations plus D-structure overhead and loses the work-clock race. This demo defaults to swept parameters — k = max(4, paper k) with paper t — because asymptotic k is degenerate below n ≈ 10⁸; on sparse n = 25,000 seed = 4, that choice beats Dijkstra on total comparisons while paper k = 2 does not (see bench/bmssp-kt-sweep.md). Select bmssp=paper in the URL to race with the paper formula.",
  sourceLead: "The authoritative cost table lives in the core trace module:",
};

/**
 * One algorithm lane persona for the explainer drawer.
 */
export type RacerPersona = {
  /** Lane label, e.g. \"Dijkstra (1959)\". */
  lane: string;
  /** Character name from design.md §1. */
  persona: string;
  /** Lane accent color token (marble, ember, moss). */
  accent: string;
  /** Short behavioral and visual blurb. */
  blurb: string;
};

/**
 * \"What am I looking at?\" explainer copy for the disclosure drawer.
 */
export type ExplainerCopy = {
  /** Historical barrier and recent breakthroughs. */
  barrier: string;
  /** Core visual argument in one sentence. */
  argument: string;
  /** The three racers with persona and accent. */
  personas: readonly RacerPersona[];
  /** Lens overlay and race vocabulary. */
  vocabulary: readonly { term: string; meaning: string }[];
};

/**
 * Explainer drawer prose: barrier history, personas, and overlay vocabulary.
 */
export const EXPLAINER_COPY: ExplainerCopy = {
  barrier:
    "For 66 years, shortest-path algorithms bowed to the same rule: process vertices in sorted distance order, and sorting costs n log n. Dijkstra's algorithm is that rule made flesh. In 2025, Duan, Mao, Mao, Shu and Yin broke the barrier with O(m log^{2/3} n) (STOC 2025 Best Paper). In February 2026 four of them set a new record of O(m√(log n·log log n)) on sparse graphs (arXiv 2602.07868).",
  argument: "Dijkstra pays for perfect order; the barrier-breakers pay only for enough order.",
  personas: [
    {
      lane: "Dijkstra (1959)",
      persona: "The Perfectionist",
      accent: "marble",
      blurb:
        "Won't touch vertex k+1 until certain about vertex k. A smooth expanding wavefront; the settle-order gradient is a perfect rainbow.",
    },
    {
      lane: "BMSSP (STOC 2025)",
      persona: "The Batcher",
      accent: "ember",
      blurb:
        "Refuses to fully sort. Picks pivots, recurses on bounded slices, and settles vertices in chunky out-of-order blooms.",
    },
    {
      lane: "DMSY (Feb 2026)",
      persona: "The Forester",
      accent: "moss",
      blurb:
        "Grows spanning forests from the frontier, chops them into Θ(k)-size subtrees, and only sorts one representative per subtree. Lane forthcoming (#27); the forest overlays preview the idea.",
    },
  ],
  vocabulary: [
    {
      term: "settle-order gradient",
      meaning:
        "Per-vertex fill color by settle index — a shared perceptually uniform ramp. Dijkstra's panel becomes a smooth radial rainbow; BMSSP's is streaky and batchy; DMSY's is patchwork by subtree.",
    },
    {
      term: "Frontier",
      meaning: "Vertices improved but not yet settled — the active wavefront ring on each lane.",
    },
    {
      term: "Relaxed edges (ghost trails)",
      meaning:
        'Recently relaxed edges drawn as faint ghost strokes behind the static graph; the Lens toggle is labeled "Relaxed edges."',
    },
    {
      term: "Recursion tint",
      meaning:
        "Nested background tint by BMSSP recursion depth — deeper levels read as warmer ember layers.",
    },
    {
      term: "Pivot flares",
      meaning:
        "Bright rings on vertices identified as pivots — the few that must enter sorted order.",
    },
    {
      term: "Batch blooms",
      meaning: "Pulsing halos when a FindPivots or batch phase settles many vertices at once.",
    },
    {
      term: "D-structure strip",
      meaning:
        "Live schematic of partial-sort blocks pulled from the D-structure under the BMSSP lane.",
    },
    {
      term: "photo-finish gold path",
      meaning:
        "When a lane's source-to-target path is fully settled, that lane freezes and draws the shortest path in gold while its comparison counter locks.",
    },
    {
      term: "forest grow/cut (DMSY, forthcoming)",
      meaning:
        "Spanning-forest edges sprout from the frontier and partition into Θ(k)-size subtrees; only pivot representatives enter the sorted lane. Overlay ships with the DMSY lane (#27).",
    },
  ],
};

/**
 * External reference for the papers disclosure panel.
 */
export type PaperLink = {
  /** Link text shown in the UI. */
  label: string;
  /** Absolute HTTPS URL. */
  href: string;
};

/**
 * Primary paper and press links, in display order.
 */
export const PAPER_LINKS: readonly PaperLink[] = [
  {
    label: "STOC 2025",
    href: "https://dl.acm.org/doi/10.1145/3717823.3718179",
  },
  {
    label: "arXiv 2504.17033",
    href: "https://arxiv.org/pdf/2504.17033",
  },
  {
    label: "arXiv 2602.07868",
    href: "https://arxiv.org/abs/2602.07868",
  },
  {
    label: "Quanta, Aug 2025",
    href: "https://www.quantamagazine.org/new-method-is-the-fastest-way-to-find-the-best-routes-20250806/",
  },
];

/**
 * Footer disclosure trigger labels (design.md §3.1).
 */
export const DISCLOSURE_LABELS = {
  explainer: "What am I looking at?",
  fairness: "Fairness rules",
  papers: "The papers",
} as const;
