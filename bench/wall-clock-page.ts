/**
 * Standalone wall-clock benchmark page (issue #21); no algorithm imports.
 */

import results from "./wall-clock-results.json";

/** One row of wall-clock and work-clock timings for a graph preset. */
type WallClockCell = {
  kind: string;
  n: number;
  seed: number;
  dijkstraWallMs: number;
  bmsspWallMs: number;
  dmsyWallMs: number;
  dijkstraWork: number;
  bmsspWork: number;
  dmsyWork: number;
};

/** Imported benchmark artifact written by `npm run bench:wall-clock`. */
type WallClockResults = {
  generatedAt: string;
  node: string;
  platform: string;
  arch: string;
  cells: WallClockCell[];
};

const LIVE_RACE_URL =
  "https://fishygeek91.github.io/sorta-fast/?g=sparse&n=25000&seed=4&mode=race&race=dijkstra,bmssp,dmsy";
const COST_TABLE_URL = "https://github.com/fishygeek91/sorta-fast/blob/main/src/core/trace.ts";
const WORK_CLOCK_SWEEP_URL =
  "https://github.com/fishygeek91/sorta-fast/blob/main/bench/bmssp-kt-sweep.md";
const LIVE_APP_URL = "https://fishygeek91.github.io/sorta-fast/";

/**
 * True when `value` is a non-null object suitable for field lookup.
 */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read a finite number field from a validated object.
 */
function readNumber(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`wall-clock results: expected ${path} to be a finite number`);
  }
  return value;
}

/**
 * Validate and construct {@link WallClockResults} from imported JSON.
 */
function parseWallClockResults(value: unknown): WallClockResults {
  if (!isNonNullObject(value)) {
    throw new Error("wall-clock results: expected a non-null object");
  }

  const generatedAt = value["generatedAt"];
  if (typeof generatedAt !== "string") {
    throw new Error("wall-clock results: expected generatedAt to be a string");
  }

  const node = value["node"];
  if (typeof node !== "string") {
    throw new Error("wall-clock results: expected node to be a string");
  }

  const platform = value["platform"];
  if (typeof platform !== "string") {
    throw new Error("wall-clock results: expected platform to be a string");
  }

  const arch = value["arch"];
  if (typeof arch !== "string") {
    throw new Error("wall-clock results: expected arch to be a string");
  }

  const cellsRaw = value["cells"];
  if (!Array.isArray(cellsRaw)) {
    throw new Error("wall-clock results: expected cells to be an array");
  }

  const cells: WallClockCell[] = [];
  for (let i = 0; i < cellsRaw.length; i++) {
    const item = cellsRaw[i];
    const path = `cells[${i}]`;
    if (!isNonNullObject(item)) {
      throw new Error(`wall-clock results: expected ${path} to be a non-null object`);
    }

    const kind = item["kind"];
    if (typeof kind !== "string") {
      throw new Error(`wall-clock results: expected ${path}.kind to be a string`);
    }

    cells.push({
      kind,
      n: readNumber(item, "n", `${path}.n`),
      seed: readNumber(item, "seed", `${path}.seed`),
      dijkstraWallMs: readNumber(item, "dijkstraWallMs", `${path}.dijkstraWallMs`),
      bmsspWallMs: readNumber(item, "bmsspWallMs", `${path}.bmsspWallMs`),
      dmsyWallMs: readNumber(item, "dmsyWallMs", `${path}.dmsyWallMs`),
      dijkstraWork: readNumber(item, "dijkstraWork", `${path}.dijkstraWork`),
      bmsspWork: readNumber(item, "bmsspWork", `${path}.bmsspWork`),
      dmsyWork: readNumber(item, "dmsyWork", `${path}.dmsyWork`),
    });
  }

  return {
    generatedAt,
    node,
    platform,
    arch,
    cells,
  };
}

const parsedResults = parseWallClockResults(results);

/**
 * Escape text for safe insertion into HTML markup.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Format a numeric table cell; non-finite values render as an em dash.
 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("en-US");
}

/**
 * Build the introductory copy explaining work clock vs wall-clock honesty.
 */
function renderIntro(): string {
  return `
    <p>
      The live race uses a <strong>work clock</strong>, not wall-clock milliseconds.
      Every lane bills the same op costs from the shared trace cost table, so the
      headline comparison count is fair and legible. Racing raw milliseconds would be
      <strong>misleading</strong> at browser scale: constants and heap behavior dominate
      long before asymptotic crossover matters.
    </p>
    <p>
      At small graph sizes (S and M presets), Dijkstra with a binary heap often wins
      <strong>wall-clock</strong> time even when BMSSP and DMSY carry fancier structure.
      That is expected and honest — we publish those numbers here instead of hiding them.
    </p>
    <p>
      <strong>Crossover</strong> is subtler than a single n. On the work clock, BMSSP with
      this demo&apos;s swept parameters (k&nbsp;=&nbsp;4) beats Dijkstra on sparse
      n&nbsp;=&nbsp;25,000, seed&nbsp;=&nbsp;4, while paper k&nbsp;=&nbsp;2 does not.
      Asymptotic k from the BMSSP paper stays at 2 until n&nbsp;≈&nbsp;2<sup>27</sup>, so
      browser-scale races need the swept k to show where the algorithm actually wins.
    </p>
    <p>
      DMSY (Feb 2026) is the third lane. It runs the paper&apos;s k/t/δ (no demo sweep
      — see issue #54). BMSSP&apos;s column uses the swept k=4 above. The two
      barrier-breaker columns are not parameter-matched.
    </p>
  `;
}

/**
 * Build the machine-metadata block from the imported JSON artifact.
 */
function renderMachineMeta(data: WallClockResults): string {
  return `
    <section class="meta" aria-label="Benchmark host">
      <p class="muted">
        These numbers come from one host; the shape of the table is the claim, not a
        guarantee on your laptop. Regenerate with
        <code>npm run bench:wall-clock</code> to refresh.
      </p>
      <dl>
        <dt>Generated</dt>
        <dd>${escapeHtml(data.generatedAt)}</dd>
        <dt>Node</dt>
        <dd>${escapeHtml(data.node)}</dd>
        <dt>Platform</dt>
        <dd>${escapeHtml(data.platform)}</dd>
        <dt>Architecture</dt>
        <dd>${escapeHtml(data.arch)}</dd>
      </dl>
    </section>
  `;
}

/**
 * Build one table row for a benchmark cell.
 */
function renderCellRow(cell: WallClockCell): string {
  return `
    <tr>
      <td>${escapeHtml(cell.kind)}</td>
      <td class="num">${formatNumber(cell.n)}</td>
      <td class="num">${formatNumber(cell.seed)}</td>
      <td class="num">${formatNumber(cell.dijkstraWallMs)}</td>
      <td class="num">${formatNumber(cell.bmsspWallMs)}</td>
      <td class="num">${formatNumber(cell.dmsyWallMs)}</td>
      <td class="num">${formatNumber(cell.dijkstraWork)}</td>
      <td class="num">${formatNumber(cell.bmsspWork)}</td>
      <td class="num">${formatNumber(cell.dmsyWork)}</td>
    </tr>
  `;
}

/**
 * Build the results table or an empty-state note when cells are pending.
 */
function renderResultsTable(data: WallClockResults): string {
  if (data.cells.length === 0) {
    return `
      <p class="pending-note">
        Results are pending. Run <code>npm run bench:wall-clock</code> locally to
        populate <code>bench/wall-clock-results.json</code>, then rebuild.
      </p>
    `;
  }

  const rows = data.cells.map((cell) => renderCellRow(cell)).join("");

  return `
    <table>
      <thead>
        <tr>
          <th scope="col">Kind</th>
          <th scope="col">n</th>
          <th scope="col">Seed</th>
          <th scope="col">Dijkstra ms</th>
          <th scope="col">BMSSP ms</th>
          <th scope="col">DMSY ms</th>
          <th scope="col">Dijkstra work</th>
          <th scope="col">BMSSP work</th>
          <th scope="col">DMSY work</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

/**
 * Build footer navigation links back to the race, cost table, and sweep notes.
 */
function renderLinks(): string {
  return `
    <nav class="links" aria-label="Related links">
      <ul>
        <li><a href="${LIVE_RACE_URL}">Live race — sparse n=25000 seed=4</a></li>
        <li><a href="${COST_TABLE_URL}">Op cost table (trace.ts)</a></li>
        <li><a href="${WORK_CLOCK_SWEEP_URL}">Work-clock k/t sweep notes</a></li>
        <li><a href="${LIVE_APP_URL}">Back to the live app</a></li>
      </ul>
    </nav>
  `;
}

/**
 * Render the wall-clock benchmark page into the provided root element.
 */
export function renderWallClockPage(
  root: HTMLElement,
  data: WallClockResults = parsedResults,
): void {
  root.innerHTML = `
    <main class="page">
      <h1>Wall-clock benchmarks</h1>
      ${renderIntro()}
      ${renderMachineMeta(data)}
      ${renderResultsTable(data)}
      ${renderLinks()}
    </main>
  `;
}

/**
 * Mount the wall-clock benchmark page when executed as a module entry.
 */
function mountWallClockPage(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) {
    throw new Error("wall-clock page: missing #app root element");
  }
  renderWallClockPage(root);
}

mountWallClockPage();
