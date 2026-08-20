/**
 * Node bench: BMSSP k/t parameter sweep vs Dijkstra work clock (issue #52).
 *
 * Headless — seeded graphs only, no DOM, no Math.random() / Date.now() on the
 * measurement path. Drains each lane through TraceWriter + scanCosts (no TraceEvent[]).
 *
 * Run: npm run bench:bmssp-kt
 * Smoke: npm run bench:bmssp-kt -- --quick
 * XL confirm: npm run bench:bmssp-kt -- --xl
 */

import { run as runBmssp } from "../src/core/bmssp/bmssp.ts";
import { paperBmsspParams } from "../src/core/bmssp/params.ts";
import { run as runDijkstra } from "../src/core/dijkstra.ts";
import {
  generateGraph,
  GRAPH_KINDS,
  SIZE_PRESETS,
  type Graph,
  type GraphKind,
} from "../src/core/graph.ts";
import { scanCosts, TraceWriter, type TraceEvent } from "../src/core/trace.ts";

const SOURCE = 0;

const DEFAULT_K_VALUES = [2, 4, 8, 12, 16, 24, 32] as const;

const DEFAULT_T_VARIANTS = ["paper", "k2", "twoK"] as const;

/** How `t` is chosen for a sweep cell (issue #52). */
export type KtTVariant = "paper" | "k2" | "twoK";

/** One row of the k/t sweep grid. */
export type KtSweepCell = {
  kind: GraphKind;
  n: number;
  seed: number;
  k: number;
  t: number;
  tVariant: KtTVariant;
  L: number;
  dijkstraWork: number;
  bmsspWork: number;
  ratio: number;
};

/** Full sweep grid dimensions. */
export type KtSweepConfig = {
  kinds: readonly GraphKind[];
  sizes: readonly number[];
  seeds: readonly number[];
  kValues: readonly number[];
  tVariants: readonly KtTVariant[];
};

/**
 * True when a (kind, n) pair is excluded from the sweep (issue #52 / #32).
 *
 * Skips XL entirely (unless `allowXl`) and city at L (Bowyer–Watson Delaunay is O(n²)).
 */
export function shouldSkipKtSweepCell(kind: GraphKind, n: number, allowXl = false): boolean {
  if (n === SIZE_PRESETS.XL && !allowXl) {
    return true;
  }
  if (kind === "city" && n === SIZE_PRESETS.L) {
    return true;
  }
  return false;
}

/**
 * Resolve block parameter `t` from sweep variant (issue #52).
 *
 * - `paper` — arXiv 2504.17033 §3.1 formula via {@link paperBmsspParams}
 * - `k2` — `k * k`
 * - `twoK` — `2 * k`
 */
export function resolveT(n: number, k: number, variant: KtTVariant): number {
  switch (variant) {
    case "paper":
      return paperBmsspParams(n).t;
    case "k2":
      return k * k;
    case "twoK":
      return 2 * k;
    default: {
      const _exhaustive: never = variant;
      throw new Error(`unknown t variant: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Default full sweep grid (issue #52).
 *
 * Sizes: S, M, and L (not XL). City at L is omitted at sweep time (Delaunay O(n²)).
 * Seeds: 0..9 inclusive.
 */
export function defaultKtSweepConfig(): KtSweepConfig {
  return {
    kinds: GRAPH_KINDS,
    sizes: [SIZE_PRESETS.S, SIZE_PRESETS.M, SIZE_PRESETS.L],
    seeds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    kValues: [...DEFAULT_K_VALUES],
    tVariants: [...DEFAULT_T_VARIANTS],
  };
}

/**
 * XL confirm grid for `--xl` (issue #103): sparse 100k, seeds 0–4, demo k/t only.
 *
 * Demo k = max(4, paper k) → 4; demo t = paper t (6 at n=100k).
 */
export function xlKtSweepConfig(): KtSweepConfig {
  return {
    kinds: ["sparse"],
    sizes: [SIZE_PRESETS.XL],
    seeds: [0, 1, 2, 3, 4],
    kValues: [4],
    tVariants: ["paper"],
  };
}

/**
 * Drain a trace generator into TraceWriter chunks and return billed work.
 */
function drainLaneWork(gen: Generator<TraceEvent, unknown, undefined>): number {
  const writer = new TraceWriter();
  for (;;) {
    const step = gen.next();
    if (step.done) {
      break;
    }
    writer.append(step.value);
  }

  const chunks = writer.takeChunks();
  let work = 0;
  for (const chunk of chunks) {
    work += scanCosts(chunk).work;
  }
  return work;
}

/**
 * Run Dijkstra and BMSSP on one seeded graph; return a sweep row.
 */
export function sweepCell(
  kind: GraphKind,
  n: number,
  seed: number,
  k: number,
  tVariant: KtTVariant,
): KtSweepCell {
  const t = resolveT(n, k, tVariant);
  const L = Math.max(1, Math.ceil(Math.log2(Math.max(2, n)) / t));

  const graph: Graph = generateGraph(kind, n, seed);

  const dijkstraWork = drainLaneWork(runDijkstra(graph, SOURCE));
  const bmsspWork = drainLaneWork(runBmssp(graph, SOURCE, { k, t }));

  const ratio = dijkstraWork > 0 ? bmsspWork / dijkstraWork : Number.NaN;

  return {
    kind,
    n,
    seed,
    k,
    t,
    tVariant,
    L,
    dijkstraWork,
    bmsspWork,
    ratio,
  };
}

/**
 * Run the full cross-product sweep; optional per-cell callback for streaming output.
 *
 * Dijkstra billed work is independent of k/t, so each (kind, n, seed) graph is
 * generated and drained once, then BMSSP is run for every k/t pair.
 */
export function runKtSweep(
  config: KtSweepConfig,
  onCell?: (cell: KtSweepCell) => void,
  allowXl = false,
): KtSweepCell[] {
  const cells: KtSweepCell[] = [];

  for (const kind of config.kinds) {
    for (const n of config.sizes) {
      if (shouldSkipKtSweepCell(kind, n, allowXl)) {
        continue;
      }
      for (const seed of config.seeds) {
        const graph: Graph = generateGraph(kind, n, seed);
        const dijkstraWork = drainLaneWork(runDijkstra(graph, SOURCE));

        for (const k of config.kValues) {
          for (const tVariant of config.tVariants) {
            const t = resolveT(n, k, tVariant);
            const L = Math.max(1, Math.ceil(Math.log2(Math.max(2, n)) / t));
            const bmsspWork = drainLaneWork(runBmssp(graph, SOURCE, { k, t }));
            const ratio = dijkstraWork > 0 ? bmsspWork / dijkstraWork : Number.NaN;
            const cell: KtSweepCell = {
              kind,
              n,
              seed,
              k,
              t,
              tVariant,
              L,
              dijkstraWork,
              bmsspWork,
              ratio,
            };
            cells.push(cell);
            if (onCell !== undefined) {
              onCell(cell);
            }
          }
        }
      }
    }
  }

  return cells;
}

/** Format ratio for tables; NaN → `n/a`. */
function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return "n/a";
  }
  return ratio.toFixed(4);
}

/**
 * Markdown blurb for sweep grid size skips: XL omitted by default, included when `--xl` cells are present.
 */
function formatKtSweepGridHeader(cells: readonly { n: number }[]): string[] {
  const includesXl = cells.some((cell) => cell.n === SIZE_PRESETS.XL);
  if (includesXl) {
    return [
      "**Grid:** XL (100k) included via `--xl`; **city at L (25k)** is still skipped because",
      "Bowyer–Watson Delaunay generation is O(n²) (issue #32).",
    ];
  }
  return [
    "**Grid skips:** XL (100k) is omitted; **city at L (25k)** is skipped because",
    "Bowyer–Watson Delaunay generation is O(n²) (issue #32).",
  ];
}

/**
 * Markdown table of sweep results plus header noting grid skips (issue #52).
 */
export function formatKtSweepMarkdown(cells: readonly KtSweepCell[]): string {
  const lines: string[] = [
    "# BMSSP k/t sweep (issue #52)",
    "",
    "Work = comparison-addition billed work from `scanCosts` on drained traces.",
    "Ratio = BMSSP work / Dijkstra work on the same seeded graph (source vertex 0).",
    "",
    ...formatKtSweepGridHeader(cells),
    "",
    "| kind | n | seed | k | t | tVariant | L | dijkstraWork | bmsspWork | ratio |",
    "| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
  ];

  for (const cell of cells) {
    lines.push(
      `| ${cell.kind} | ${String(cell.n)} | ${String(cell.seed)} | ${String(cell.k)} | ${String(cell.t)} | ${cell.tVariant} | ${String(cell.L)} | ${String(cell.dijkstraWork)} | ${String(cell.bmsspWork)} | ${formatRatio(cell.ratio)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Tab-separated sweep results (header row + one row per cell).
 */
export function formatKtSweepTsv(cells: readonly KtSweepCell[]): string {
  const lines: string[] = ["kind\tn\tseed\tk\tt\ttVariant\tL\tdijkstraWork\tbmsspWork\tratio"];

  for (const cell of cells) {
    lines.push(
      [
        cell.kind,
        String(cell.n),
        String(cell.seed),
        String(cell.k),
        String(cell.t),
        cell.tVariant,
        String(cell.L),
        String(cell.dijkstraWork),
        String(cell.bmsspWork),
        formatRatio(cell.ratio),
      ].join("\t"),
    );
  }

  return lines.join("\n");
}

/** Quick grid for smoke tests / CI (`--quick`). */
function quickKtSweepConfig(): KtSweepConfig {
  return {
    kinds: ["maze"],
    sizes: [40],
    seeds: [0],
    kValues: [2, 8],
    tVariants: ["paper"],
  };
}

type CliOptions = {
  quick: boolean;
  xl: boolean;
  outPath: string | undefined;
  kinds: readonly GraphKind[] | undefined;
  sizes: readonly number[] | undefined;
  seeds: readonly number[] | undefined;
  kValues: readonly number[] | undefined;
  tVariants: readonly KtTVariant[] | undefined;
};

/**
 * Parse a comma-separated integer list; throw if any token is not an integer >= 0.
 */
function parseIntegerList(raw: string, flag: string): number[] {
  const values: number[] = [];
  for (const token of raw.split(",")) {
    const parsed = Number(token);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${flag} tokens must be integers >= 0, got ${token}`);
    }
    values.push(parsed);
  }
  if (values.length === 0) {
    throw new Error(`${flag} must list at least one integer`);
  }
  return values;
}

/**
 * Parse a comma-separated graph-kind list against {@link GRAPH_KINDS}.
 */
function parseKindList(raw: string): GraphKind[] {
  const kinds: GraphKind[] = [];
  for (const token of raw.split(",")) {
    let matched: GraphKind | undefined;
    for (const kind of GRAPH_KINDS) {
      if (kind === token) {
        matched = kind;
        break;
      }
    }
    if (matched === undefined) {
      throw new Error(`unknown graph kind in --kinds: ${token}`);
    }
    kinds.push(matched);
  }
  if (kinds.length === 0) {
    throw new Error("--kinds must list at least one kind");
  }
  return kinds;
}

/**
 * Parse a comma-separated t-variant list.
 */
function parseTVariantList(raw: string): KtTVariant[] {
  const variants: KtTVariant[] = [];
  for (const token of raw.split(",")) {
    if (token !== "paper" && token !== "k2" && token !== "twoK") {
      throw new Error(`unknown t variant in --t: ${token}`);
    }
    variants.push(token);
  }
  if (variants.length === 0) {
    throw new Error("--t must list at least one variant");
  }
  return variants;
}

function parseCli(argv: readonly string[]): CliOptions {
  let quick = false;
  let xl = false;
  let outPath: string | undefined;
  let kinds: readonly GraphKind[] | undefined;
  let sizes: readonly number[] | undefined;
  let seeds: readonly number[] | undefined;
  let kValues: readonly number[] | undefined;
  let tVariants: readonly KtTVariant[] | undefined;

  for (const arg of argv) {
    if (arg === "--quick") {
      quick = true;
    } else if (arg === "--xl") {
      xl = true;
    } else if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--kinds=")) {
      kinds = parseKindList(arg.slice("--kinds=".length));
    } else if (arg.startsWith("--sizes=")) {
      sizes = parseIntegerList(arg.slice("--sizes=".length), "--sizes");
    } else if (arg.startsWith("--seeds=")) {
      seeds = parseIntegerList(arg.slice("--seeds=".length), "--seeds");
    } else if (arg.startsWith("--k=")) {
      kValues = parseIntegerList(arg.slice("--k=".length), "--k");
      for (const k of kValues) {
        if (k < 1) {
          throw new Error(`--k tokens must be integers >= 1, got ${String(k)}`);
        }
      }
    } else if (arg.startsWith("--t=")) {
      tVariants = parseTVariantList(arg.slice("--t=".length));
    }
  }

  return { quick, xl, outPath, kinds, sizes, seeds, kValues, tVariants };
}

/**
 * Apply CLI grid overlays onto a base config (quick or default).
 */
function applyCliOverlays(base: KtSweepConfig, options: CliOptions): KtSweepConfig {
  return {
    kinds: options.kinds ?? base.kinds,
    sizes: options.sizes ?? base.sizes,
    seeds: options.seeds ?? base.seeds,
    kValues: options.kValues ?? base.kValues,
    tVariants: options.tVariants ?? base.tVariants,
  };
}

function formatCellSummary(cell: KtSweepCell): string {
  return (
    `kt-sweep: kind=${cell.kind} n=${String(cell.n)} seed=${String(cell.seed)} ` +
    `k=${String(cell.k)} t=${String(cell.t)} variant=${cell.tVariant} L=${String(cell.L)} ` +
    `dijkstra=${String(cell.dijkstraWork)} bmssp=${String(cell.bmsspWork)} ` +
    `ratio=${formatRatio(cell.ratio)}`
  );
}

if (process.argv[1]?.includes("bmssp-kt-sweep")) {
  const options = parseCli(process.argv.slice(2));
  const base = options.xl
    ? xlKtSweepConfig()
    : options.quick
      ? quickKtSweepConfig()
      : defaultKtSweepConfig();
  const config = applyCliOverlays(base, options);

  const wallT0 = performance.now();
  const cells = runKtSweep(
    config,
    (cell) => {
      console.log(formatCellSummary(cell));
    },
    options.xl,
  );
  const wallMs = performance.now() - wallT0;

  if (options.outPath !== undefined) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(options.outPath, formatKtSweepMarkdown(cells), "utf8");
    const tsvPath = options.outPath.endsWith(".md")
      ? `${options.outPath.slice(0, -3)}.tsv`
      : `${options.outPath}.tsv`;
    writeFileSync(tsvPath, formatKtSweepTsv(cells), "utf8");
    console.log(`wrote ${String(cells.length)} rows to ${options.outPath} and ${tsvPath}`);
  }

  const modeSuffix = options.xl ? " (xl)" : options.quick ? " (quick)" : "";
  console.log(
    `kt-sweep done: cells=${String(cells.length)} wallMs=${wallMs.toFixed(2)}${modeSuffix}`,
  );
}
