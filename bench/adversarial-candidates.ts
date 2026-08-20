/**
 * Node bench: Dijkstra-hostile candidate graph families vs adversarial control (#104).
 *
 * Headless — seeded graphs only, no DOM, no Math.random() / Date.now() on the
 * measurement path. Drains each lane through TraceWriter + scanCosts (no TraceEvent[]).
 *
 * Run: npm run bench:adversarial-candidates
 * Scout: npm run bench:adversarial-candidates -- --scout
 * Quick: npm run bench:adversarial-candidates -- --quick
 */

import { writeFileSync } from "node:fs";

import { run as runBmssp } from "../src/core/bmssp/bmssp.ts";
import { paperBmsspParams } from "../src/core/bmssp/params.ts";
import { run as runDmsy } from "../src/core/dmsy/dmsy.ts";
import { run as runDijkstra } from "../src/core/dijkstra.ts";
import {
  generateGraph,
  packCsr,
  SIZE_PRESETS,
  type CsrEdge,
  type Graph,
} from "../src/core/graph.ts";
import { mulberry32, type Mulberry32 } from "../src/core/prng.ts";
import { scanCosts, TraceWriter, type TraceEvent } from "../src/core/trace.ts";

const SOURCE = 0;

/** Candidate graph families compared against the existing adversarial control. */
export type CandidateFamily = "control" | "cascade3" | "cascadeAll" | "cascadeHub" | "wideFrontier";

/** All families in bench iteration order. */
export const CANDIDATE_FAMILIES: readonly CandidateFamily[] = [
  "control",
  "cascade3",
  "cascadeAll",
  "cascadeHub",
  "wideFrontier",
] as const;

/** One row of the candidate family measurement grid. */
export type CandidateRow = {
  family: CandidateFamily;
  n: number;
  seed: number;
  m: number;
  dijkstraWork: number;
  bmsspWork: number;
  dmsyWork: number;
  ratioBmssp: number;
  ratioDmsy: number;
};

/** BMSSP k/t sweep row for `--kt` follow-up. */
export type CandidateKtRow = {
  family: CandidateFamily;
  n: number;
  seed: number;
  k: number;
  t: number;
  tVariant: "paper" | "twoK";
  dijkstraWork: number;
  bmsspWork: number;
  ratio: number;
};

/** Full candidate bench grid dimensions. */
export type CandidateBenchConfig = {
  families: readonly CandidateFamily[];
  sizes: readonly number[];
  seeds: readonly number[];
};

const CASCADE_WEIGHT_STEP = 3;
const TINY_N_THRESHOLD = 16;
const TARGET_ARC_FACTOR = 2;

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
 * Format ratio for tables; NaN → `n/a`.
 */
function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return "n/a";
  }
  return ratio.toFixed(4);
}

/**
 * Edge deduplication helper for local generators.
 */
function createEdgeAccumulator(): {
  readonly edges: CsrEdge[];
  tryAdd: (from: number, to: number, weight: number) => boolean;
} {
  const edges: CsrEdge[] = [];
  const seen = new Set<string>();

  const tryAdd = (from: number, to: number, weight: number): boolean => {
    if (from === to) {
      return false;
    }
    if (!Number.isFinite(weight) || weight < 1) {
      throw new Error(`invalid edge weight ${String(weight)} for ${String(from)} -> ${String(to)}`);
    }
    const key = `${String(from)},${String(to)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    edges.push({ from, to, weight });
    return true;
  };

  return { edges, tryAdd };
}

/**
 * Pick a wave vertex index in `[1 .. waveCount*perWave]` for wave `waveIndex`.
 */
function pickWaveVertex(rng: Mulberry32, waveIndex: number, perWave: number): number {
  if (perWave < 1) {
    throw new Error(`pickWaveVertex: perWave must be >= 1, got ${String(perWave)}`);
  }
  const offset = Math.min(perWave - 1, Math.floor(rng.next() * perWave));
  return 1 + waveIndex * perWave + offset;
}

/**
 * Cascade target edge weight so path cost strictly decreases with wave index.
 *
 * pathCost(i) = (i + 1) + weight(i); consecutive waves differ by 2 when S = 3.
 */
function cascadeTargetWeight(waveIndex: number, waveCount: number): number {
  const B = 1 + (waveCount - 1) * CASCADE_WEIGHT_STEP;
  return B - waveIndex * CASCADE_WEIGHT_STEP;
}

/**
 * Tiny-n fallback: star from source with unit weights (still reachable, valid CSR).
 */
function generateTinyStar(n: number): Graph {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`generateTinyStar: n must be an integer >= 0, got ${String(n)}`);
  }
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  if (n >= 1) {
    x[0] = 0;
    y[0] = 0.5;
  }
  const acc = createEdgeAccumulator();
  for (let v = 1; v < n; v += 1) {
    x[v] = 1;
    y[v] = v / Math.max(1, n - 1);
    acc.tryAdd(0, v, 1);
  }
  return packCsr(n, acc.edges, x, y);
}

/**
 * Layout cascade graphs: source at (0, 0.5), waves in columns, targets at x = 1.
 */
function layoutCascade(
  n: number,
  waveCount: number,
  perWave: number,
  waveVertexEnd: number,
): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  x[0] = 0;
  y[0] = 0.5;

  for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
    const colX = (waveIndex + 1) / (waveCount + 1);
    for (let j = 0; j < perWave; j += 1) {
      const v = 1 + waveIndex * perWave + j;
      if (v >= n) {
        break;
      }
      x[v] = colX;
      y[v] = (j + 0.5) / perWave;
    }
  }

  const targetCount = Math.max(0, n - 1 - waveVertexEnd);
  for (let t = waveVertexEnd + 1; t < n; t += 1) {
    x[t] = 1;
    y[t] = targetCount > 0 ? (t - waveVertexEnd) / targetCount : 0.5;
  }

  return { x, y };
}

/**
 * Attach any unassigned vertices directly from the source (reachability safety net).
 */
function attachUnreachableFromSource(
  n: number,
  waveVertexEnd: number,
  acc: ReturnType<typeof createEdgeAccumulator>,
): void {
  for (let v = 1; v < n; v += 1) {
    if (v <= waveVertexEnd) {
      continue;
    }
    let hasIn = false;
    for (const edge of acc.edges) {
      if (edge.to === v) {
        hasIn = true;
        break;
      }
    }
    if (!hasIn) {
      acc.tryAdd(0, v, 1);
    }
  }
}

/**
 * Pad cascade graphs toward ~2n arcs with extra distinct target←wave edges.
 */
function padCascadeEdges(
  n: number,
  waveCount: number,
  perWave: number,
  waveVertexEnd: number,
  acc: ReturnType<typeof createEdgeAccumulator>,
  rng: Mulberry32,
): void {
  const target = TARGET_ARC_FACTOR * n;
  const maxAttempts = target * 8;
  let attempts = 0;

  while (acc.edges.length < target && attempts < maxAttempts) {
    attempts += 1;
    if (waveVertexEnd + 1 >= n) {
      break;
    }
    const waveIndex = Math.min(waveCount - 1, Math.floor(rng.next() * waveCount));
    const from = pickWaveVertex(rng, waveIndex, perWave);
    const to = waveVertexEnd + 1 + Math.floor(rng.next() * (n - 1 - waveVertexEnd));
    const weight = cascadeTargetWeight(waveIndex, waveCount);
    acc.tryAdd(from, to, weight);
  }
}

/**
 * Shared cascade generator; `connectAllWaves` selects cascade3 vs cascadeAll wiring.
 */
function generateCascade(n: number, seed: number, connectAllWaves: boolean): Graph {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`generateCascade: n must be an integer >= 0, got ${String(n)}`);
  }
  if (n < TINY_N_THRESHOLD) {
    return generateTinyStar(n);
  }

  const waveCount = Math.max(4, Math.min(12, Math.floor(Math.sqrt(n) / 2)));
  let perWave = Math.max(2, Math.floor(n / (2 * waveCount)));
  const minTargets = Math.max(4, Math.floor(n / 4));

  while (n - 1 - waveCount * perWave < minTargets && perWave > 1) {
    perWave -= 1;
  }

  const waveVertexEnd = waveCount * perWave;
  if (waveVertexEnd >= n) {
    throw new Error(
      `generateCascade: wave vertices consume n=${String(n)} (waveCount=${String(waveCount)} perWave=${String(perWave)})`,
    );
  }

  const rng = mulberry32(seed);
  const acc = createEdgeAccumulator();

  for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
    const waveWeight = waveIndex + 1;
    for (let j = 0; j < perWave; j += 1) {
      const w = 1 + waveIndex * perWave + j;
      acc.tryAdd(0, w, waveWeight);
    }
  }

  const wavesForTarget = connectAllWaves
    ? Array.from({ length: waveCount }, (_unused, waveIndex) => waveIndex)
    : [0, Math.floor(waveCount / 2), waveCount - 1];

  for (let t = waveVertexEnd + 1; t < n; t += 1) {
    for (const waveIndex of wavesForTarget) {
      const from = pickWaveVertex(rng, waveIndex, perWave);
      const weight = cascadeTargetWeight(waveIndex, waveCount);
      acc.tryAdd(from, t, weight);
    }
  }

  padCascadeEdges(n, waveCount, perWave, waveVertexEnd, acc, rng);
  attachUnreachableFromSource(n, waveVertexEnd, acc);

  const { x, y } = layoutCascade(n, waveCount, perWave, waveVertexEnd);
  return packCsr(n, acc.edges, x, y);
}

/**
 * Decrease-key wave graph: each target connects from first, middle, and last waves (~2n arcs).
 */
export function generateCascade3(n: number, seed: number): Graph {
  return generateCascade(n, seed, false);
}

/**
 * Denser cascade: each target connects from every wave (more decrease-keys).
 */
export function generateCascadeAll(n: number, seed: number): Graph {
  return generateCascade(n, seed, true);
}

/**
 * Hub cascade: source out-degree = waveCount (not perWave × waveCount).
 *
 * Each wave is a hub chain — `0 → hub(i)` with weight `i + 1`, then
 * `hub(i) → hub(i)+j` with weight 1. Targets still connect from every wave
 * (cascadeAll-style decrease-key pressure) without blowing up FindPivots fan-out.
 */
export function generateCascadeHub(n: number, seed: number): Graph {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`generateCascadeHub: n must be an integer >= 0, got ${String(n)}`);
  }
  if (n < TINY_N_THRESHOLD) {
    return generateTinyStar(n);
  }

  const waveCount = Math.max(4, Math.min(12, Math.floor(Math.sqrt(n) / 2)));
  let perWave = Math.max(2, Math.floor(n / (2 * waveCount)));
  const minTargets = Math.max(4, Math.floor(n / 4));

  while (n - 1 - waveCount * perWave < minTargets && perWave > 1) {
    perWave -= 1;
  }

  const waveVertexEnd = waveCount * perWave;
  if (waveVertexEnd >= n) {
    throw new Error(
      `generateCascadeHub: wave vertices consume n=${String(n)} (waveCount=${String(waveCount)} perWave=${String(perWave)})`,
    );
  }

  const rng = mulberry32(seed);
  const acc = createEdgeAccumulator();

  for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
    const hub = 1 + waveIndex * perWave;
    acc.tryAdd(0, hub, waveIndex + 1);
    for (let j = 1; j < perWave; j += 1) {
      acc.tryAdd(hub, hub + j, 1);
    }
  }

  for (let t = waveVertexEnd + 1; t < n; t += 1) {
    for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
      const from = pickWaveVertex(rng, waveIndex, perWave);
      const weight = cascadeTargetWeight(waveIndex, waveCount);
      acc.tryAdd(from, t, weight);
    }
  }

  padCascadeEdges(n, waveCount, perWave, waveVertexEnd, acc, rng);
  attachUnreachableFromSource(n, waveVertexEnd, acc);

  const { x, y } = layoutCascade(n, waveCount, perWave, waveVertexEnd);
  return packCsr(n, acc.edges, x, y);
}

/**
 * Wide-frontier sparse-like graph: random spanning in-arborescence plus pad to m = 2n.
 *
 * Weights are tight (`1 + U(0,1)`) unlike gallery sparse's `1 + U(0,99)`.
 */
export function generateWideFrontier(n: number, seed: number): Graph {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`generateWideFrontier: n must be an integer >= 0, got ${String(n)}`);
  }

  if (n < 3) {
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const acc = createEdgeAccumulator();
    for (let v = 0; v < n; v += 1) {
      x[v] = n <= 1 ? 0 : v / (n - 1);
      y[v] = 0.5;
    }
    for (let v = 1; v < n; v += 1) {
      acc.tryAdd(v - 1, v, 1);
    }
    return packCsr(n, acc.edges, x, y);
  }

  const rng = mulberry32(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let v = 0; v < n; v += 1) {
    x[v] = rng.next();
    y[v] = rng.next();
  }

  const acc = createEdgeAccumulator();
  for (let v = 1; v < n; v += 1) {
    const parent = Math.floor(rng.next() * v);
    acc.tryAdd(parent, v, 1 + rng.next());
  }

  const want = TARGET_ARC_FACTOR * n;
  const maxAttempts = want * 16;
  let attempts = 0;
  while (acc.edges.length < want && attempts < maxAttempts) {
    attempts += 1;
    const from = Math.floor(rng.next() * n);
    const to = Math.floor(rng.next() * n);
    acc.tryAdd(from, to, 1 + rng.next());
  }

  if (acc.edges.length < want) {
    throw new Error(
      `generateWideFrontier: could not pad to m=${String(want)} on n=${String(n)} (got ${String(acc.edges.length)})`,
    );
  }

  return packCsr(n, acc.edges, x, y);
}

/**
 * Build one candidate graph for the given family.
 */
export function generateCandidateGraph(family: CandidateFamily, n: number, seed: number): Graph {
  switch (family) {
    case "control":
      return generateGraph("adversarial", n, seed);
    case "cascade3":
      return generateCascade3(n, seed);
    case "cascadeAll":
      return generateCascadeAll(n, seed);
    case "cascadeHub":
      return generateCascadeHub(n, seed);
    case "wideFrontier":
      return generateWideFrontier(n, seed);
    default: {
      const _exhaustive: never = family;
      throw new Error(`unknown candidate family: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Measure Dijkstra, BMSSP-demo, and DMSY-demo billed work on one seeded candidate graph.
 */
export function measureCandidate(family: CandidateFamily, n: number, seed: number): CandidateRow {
  const graph = generateCandidateGraph(family, n, seed);
  const dijkstraWork = drainLaneWork(runDijkstra(graph, SOURCE));
  const bmsspWork = drainLaneWork(runBmssp(graph, SOURCE));
  const dmsyWork = drainLaneWork(runDmsy(graph, SOURCE));

  const ratioBmssp = dijkstraWork > 0 ? bmsspWork / dijkstraWork : Number.NaN;
  const ratioDmsy = dijkstraWork > 0 ? dmsyWork / dijkstraWork : Number.NaN;

  return {
    family,
    n,
    seed,
    m: graph.m,
    dijkstraWork,
    bmsspWork,
    dmsyWork,
    ratioBmssp,
    ratioDmsy,
  };
}

/**
 * Default bench grid: M and L, seeds 0..4, all families.
 */
export function defaultCandidateBenchConfig(): CandidateBenchConfig {
  return {
    families: [...CANDIDATE_FAMILIES],
    sizes: [SIZE_PRESETS.M, SIZE_PRESETS.L],
    seeds: [0, 1, 2, 3, 4],
  };
}

/** Scout grid: S only, seeds 0..2. */
export function scoutCandidateBenchConfig(): CandidateBenchConfig {
  return {
    families: [...CANDIDATE_FAMILIES],
    sizes: [SIZE_PRESETS.S],
    seeds: [0, 1, 2],
  };
}

/** Quick grid: S and M, seeds 0..1. */
export function quickCandidateBenchConfig(): CandidateBenchConfig {
  return {
    families: [...CANDIDATE_FAMILIES],
    sizes: [SIZE_PRESETS.S, SIZE_PRESETS.M],
    seeds: [0, 1],
  };
}

/**
 * Run the full candidate cross-product; optional per-row callback for streaming logs.
 */
export function runCandidateBench(
  config: CandidateBenchConfig,
  onRow?: (row: CandidateRow) => void,
): CandidateRow[] {
  const rows: CandidateRow[] = [];

  for (const family of config.families) {
    for (const n of config.sizes) {
      for (const seed of config.seeds) {
        const row = measureCandidate(family, n, seed);
        rows.push(row);
        if (onRow !== undefined) {
          onRow(row);
        }
      }
    }
  }

  return rows;
}

const KT_K_VALUES = [2, 4, 8] as const;

/**
 * Small BMSSP k/t sweep on one family using explicit `{ k, t }` (Dijkstra vs BMSSP only).
 */
export function runCandidateKtSweep(
  family: CandidateFamily,
  sizes: readonly number[],
  seeds: readonly number[],
): CandidateKtRow[] {
  const sweepSizes = sizes.length > 0 ? sizes : [SIZE_PRESETS.S];
  const sweepSeeds = seeds.length > 0 ? seeds : [0];
  const rows: CandidateKtRow[] = [];

  for (const n of sweepSizes) {
    for (const seed of sweepSeeds) {
      const graph = generateCandidateGraph(family, n, seed);
      const dijkstraWork = drainLaneWork(runDijkstra(graph, SOURCE));

      for (const k of KT_K_VALUES) {
        const variants: readonly { tVariant: "paper" | "twoK"; t: number }[] = [
          { tVariant: "paper", t: paperBmsspParams(n).t },
          { tVariant: "twoK", t: 2 * k },
        ];
        for (const variant of variants) {
          const bmsspWork = drainLaneWork(runBmssp(graph, SOURCE, { k, t: variant.t }));
          const ratio = dijkstraWork > 0 ? bmsspWork / dijkstraWork : Number.NaN;
          rows.push({
            family,
            n,
            seed,
            k,
            t: variant.t,
            tVariant: variant.tVariant,
            dijkstraWork,
            bmsspWork,
            ratio,
          });
        }
      }
    }
  }

  return rows;
}

/** Gate verdict for one size preset. */
export type FamilyGateVerdict = {
  family: CandidateFamily;
  sizeLabel: "M" | "L";
  n: number;
  pass: boolean;
  failures: readonly { seed: number; ratio: number }[];
};

/**
 * Evaluate BMSSP-demo < Dijkstra gate at M (5000) and L (25000) for measured seeds.
 */
export function evaluateFamilyGate(
  rows: readonly CandidateRow[],
  seeds: readonly number[],
): FamilyGateVerdict[] {
  const verdicts: FamilyGateVerdict[] = [];
  const sizeChecks: { label: "M" | "L"; n: number }[] = [
    { label: "M", n: SIZE_PRESETS.M },
    { label: "L", n: SIZE_PRESETS.L },
  ];

  for (const family of CANDIDATE_FAMILIES) {
    for (const check of sizeChecks) {
      const relevant = rows.filter(
        (row) => row.family === family && row.n === check.n && seeds.includes(row.seed),
      );
      if (relevant.length === 0) {
        continue;
      }

      const failures: { seed: number; ratio: number }[] = [];
      for (const row of relevant) {
        if (!(row.bmsspWork < row.dijkstraWork)) {
          failures.push({ seed: row.seed, ratio: row.ratioBmssp });
        }
      }

      verdicts.push({
        family,
        sizeLabel: check.label,
        n: check.n,
        pass: failures.length === 0,
        failures,
      });
    }
  }

  return verdicts;
}

/**
 * Markdown table of candidate measurements.
 */
export function formatCandidateMarkdown(rows: readonly CandidateRow[]): string {
  const lines: string[] = [
    "# Adversarial candidate families (#104)",
    "",
    "Work = comparison-addition billed work from `scanCosts` on drained traces.",
    "Ratio = lane work / Dijkstra work on the same seeded graph (source vertex 0). Ratio < 1 means the barrier-breaker wins.",
    "",
    "| family | n | seed | m | dijkstraWork | bmsspWork | dmsyWork | ratioBmssp | ratioDmsy |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.family} | ${String(row.n)} | ${String(row.seed)} | ${String(row.m)} | ${String(row.dijkstraWork)} | ${String(row.bmsspWork)} | ${String(row.dmsyWork)} | ${formatRatio(row.ratioBmssp)} | ${formatRatio(row.ratioDmsy)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Tab-separated candidate results.
 */
export function formatCandidateTsv(rows: readonly CandidateRow[]): string {
  const lines: string[] = [
    "family\tn\tseed\tm\tdijkstraWork\tbmsspWork\tdmsyWork\tratioBmssp\tratioDmsy",
  ];

  for (const row of rows) {
    lines.push(
      [
        row.family,
        String(row.n),
        String(row.seed),
        String(row.m),
        String(row.dijkstraWork),
        String(row.bmsspWork),
        String(row.dmsyWork),
        formatRatio(row.ratioBmssp),
        formatRatio(row.ratioDmsy),
      ].join("\t"),
    );
  }

  return lines.join("\n");
}

/**
 * Markdown table for `--kt` BMSSP k/t follow-up.
 */
export function formatCandidateKtMarkdown(rows: readonly CandidateKtRow[]): string {
  const lines: string[] = [
    "## BMSSP k/t sweep (explicit k, t)",
    "",
    "| family | n | seed | k | t | tVariant | dijkstraWork | bmsspWork | ratio |",
    "| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.family} | ${String(row.n)} | ${String(row.seed)} | ${String(row.k)} | ${String(row.t)} | ${row.tVariant} | ${String(row.dijkstraWork)} | ${String(row.bmsspWork)} | ${formatRatio(row.ratio)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * GATE summary: BMSSP demo must beat Dijkstra on every measured seed at M and L.
 */
export function formatGateSummary(
  verdicts: readonly FamilyGateVerdict[],
  seeds: readonly number[],
): string {
  const lines: string[] = [
    "## GATE",
    "",
    "PASS when BMSSP demo work < Dijkstra work on every measured seed at M (5000) and L (25000).",
    "",
  ];

  if (verdicts.length === 0) {
    lines.push("_No rows at M or L — gate not evaluated._");
    lines.push("");
    return lines.join("\n");
  }

  let overallPass = true;

  for (const family of CANDIDATE_FAMILIES) {
    const familyVerdicts = verdicts.filter((verdict) => verdict.family === family);
    if (familyVerdicts.length === 0) {
      continue;
    }

    lines.push(`### ${family}`);

    for (const verdict of familyVerdicts) {
      if (!verdict.pass) {
        overallPass = false;
      }
      const status = verdict.pass ? "PASS" : "FAIL";
      if (verdict.pass) {
        lines.push(
          `- ${verdict.sizeLabel} (n=${String(verdict.n)}, seeds=${seeds.join(",")}): **${status}**`,
        );
      } else {
        const detail = verdict.failures
          .map((failure) => `seed ${String(failure.seed)} ratio=${formatRatio(failure.ratio)}`)
          .join("; ");
        lines.push(
          `- ${verdict.sizeLabel} (n=${String(verdict.n)}, seeds=${seeds.join(",")}): **${status}** — ${detail}`,
        );
      }
    }

    const mVerdict = familyVerdicts.find((verdict) => verdict.sizeLabel === "M");
    const lVerdict = familyVerdicts.find((verdict) => verdict.sizeLabel === "L");
    const familyPass =
      (mVerdict === undefined || mVerdict.pass) && (lVerdict === undefined || lVerdict.pass);
    if (!familyPass) {
      overallPass = false;
    }
    lines.push(`- OVERALL: **${familyPass ? "PASS" : "FAIL"}**`);
    lines.push("");
  }

  lines.push(`**ALL FAMILIES OVERALL: ${overallPass ? "PASS" : "FAIL"}**`);
  lines.push("");
  return lines.join("\n");
}

type CliOptions = {
  scout: boolean;
  quick: boolean;
  gate: boolean;
  outPath: string | undefined;
  families: readonly CandidateFamily[] | undefined;
  sizes: readonly number[] | undefined;
  seeds: readonly number[] | undefined;
  ktFamily: CandidateFamily | undefined;
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
 * Parse a comma-separated candidate-family list.
 */
function parseFamilyList(raw: string): CandidateFamily[] {
  const families: CandidateFamily[] = [];
  for (const token of raw.split(",")) {
    let matched: CandidateFamily | undefined;
    for (const family of CANDIDATE_FAMILIES) {
      if (family === token) {
        matched = family;
        break;
      }
    }
    if (matched === undefined) {
      throw new Error(`unknown family in --families: ${token}`);
    }
    families.push(matched);
  }
  if (families.length === 0) {
    throw new Error("--families must list at least one family");
  }
  return families;
}

function parseCli(argv: readonly string[]): CliOptions {
  let scout = false;
  let quick = false;
  let gate = false;
  let outPath: string | undefined;
  let families: readonly CandidateFamily[] | undefined;
  let sizes: readonly number[] | undefined;
  let seeds: readonly number[] | undefined;
  let ktFamily: CandidateFamily | undefined;

  for (const arg of argv) {
    if (arg === "--scout") {
      scout = true;
    } else if (arg === "--quick") {
      quick = true;
    } else if (arg === "--gate") {
      gate = true;
    } else if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--families=")) {
      families = parseFamilyList(arg.slice("--families=".length));
    } else if (arg.startsWith("--sizes=")) {
      sizes = parseIntegerList(arg.slice("--sizes=".length), "--sizes");
      for (const n of sizes) {
        if (n < 1) {
          throw new Error(`--sizes tokens must be integers >= 1, got ${String(n)}`);
        }
      }
    } else if (arg.startsWith("--seeds=")) {
      seeds = parseIntegerList(arg.slice("--seeds=".length), "--seeds");
    } else if (arg.startsWith("--kt=")) {
      const token = arg.slice("--kt=".length);
      let matched: CandidateFamily | undefined;
      for (const family of CANDIDATE_FAMILIES) {
        if (family === token) {
          matched = family;
          break;
        }
      }
      if (matched === undefined) {
        throw new Error(`unknown family in --kt: ${token}`);
      }
      ktFamily = matched;
    }
  }

  return { scout, quick, gate, outPath, families, sizes, seeds, ktFamily };
}

/**
 * Apply CLI grid overlays onto a base config.
 */
function applyCliOverlays(base: CandidateBenchConfig, options: CliOptions): CandidateBenchConfig {
  return {
    families: options.families ?? base.families,
    sizes: options.sizes ?? base.sizes,
    seeds: options.seeds ?? base.seeds,
  };
}

function formatRowSummary(row: CandidateRow): string {
  return (
    `adversarial-candidates: family=${row.family} n=${String(row.n)} seed=${String(row.seed)} ` +
    `m=${String(row.m)} dijkstra=${String(row.dijkstraWork)} bmssp=${String(row.bmsspWork)} ` +
    `dmsy=${String(row.dmsyWork)} ratioBmssp=${formatRatio(row.ratioBmssp)} ` +
    `ratioDmsy=${formatRatio(row.ratioDmsy)}`
  );
}

function main(): void {
  const options = parseCli(process.argv.slice(2));
  const base = options.scout
    ? scoutCandidateBenchConfig()
    : options.quick
      ? quickCandidateBenchConfig()
      : defaultCandidateBenchConfig();
  const config = applyCliOverlays(base, options);

  const wallT0 = performance.now();
  const rows = runCandidateBench(config, (row) => {
    console.log(formatRowSummary(row));
  });
  const wallMs = performance.now() - wallT0;

  const verdicts = evaluateFamilyGate(rows, config.seeds);

  let ktMarkdown = "";
  if (options.ktFamily !== undefined) {
    const ktRows = runCandidateKtSweep(options.ktFamily, config.sizes, config.seeds);
    ktMarkdown = formatCandidateKtMarkdown(ktRows);
    for (const row of ktRows) {
      console.log(
        `adversarial-kt: family=${row.family} n=${String(row.n)} seed=${String(row.seed)} ` +
          `k=${String(row.k)} t=${String(row.t)} variant=${row.tVariant} ` +
          `dijkstra=${String(row.dijkstraWork)} bmssp=${String(row.bmsspWork)} ` +
          `ratio=${formatRatio(row.ratio)}`,
      );
    }
  }

  const gateMarkdown = formatGateSummary(verdicts, config.seeds);
  const markdown = formatCandidateMarkdown(rows) + ktMarkdown + gateMarkdown;

  console.log(markdown);

  if (options.outPath !== undefined) {
    writeFileSync(options.outPath, markdown, "utf8");
    const tsvPath = options.outPath.endsWith(".md")
      ? `${options.outPath.slice(0, -3)}.tsv`
      : `${options.outPath}.tsv`;
    writeFileSync(tsvPath, formatCandidateTsv(rows), "utf8");
    console.log(`wrote ${String(rows.length)} rows to ${options.outPath} and ${tsvPath}`);
  }

  const modeSuffix = options.scout ? " (scout)" : options.quick ? " (quick)" : "";
  console.log(
    `adversarial-candidates done: rows=${String(rows.length)} wallMs=${wallMs.toFixed(2)}${modeSuffix}`,
  );
}

if (process.argv[1]?.includes("adversarial-candidates")) {
  main();
}
