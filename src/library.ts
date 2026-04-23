import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { listRuns, type RunListEntry, type RunStatusFilter } from "./artifact.js";

export interface RenderLibraryOptions {
  cwd?: string;
  outPath?: string;
}

export interface RenderLibraryResult {
  htmlPath: string;
  runs: RunListEntry[];
  totals: LibraryTotals;
}

export interface LibraryTotals {
  total: number;
  passed: number;
  failed: number;
  risky: number;
  invalid: number;
}

export interface FormatRunListOptions {
  cwd?: string;
  limit?: number;
  status?: RunStatusFilter;
}

export function renderLibrary(options: RenderLibraryOptions = {}): RenderLibraryResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const htmlPath = path.resolve(cwd, options.outPath ?? path.join(".agentbox", "index.html"));
  const runs = listRuns(cwd).runs;
  const totals = summarizeRuns(runs);
  const html = renderLibraryHtml({ cwd, htmlPath, runs, totals });
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  return { htmlPath, runs, totals };
}

export function formatRunListHuman(options: FormatRunListOptions = {}): string {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const result = listRuns(cwd, { limit: options.limit, status: options.status });
  if (result.runs.length === 0) return `No Agentbox runs found in ${result.runsDir}\n`;

  const rows = result.runs.map((run) => [
    run.id,
    run.status,
    String(run.exitCode ?? "unknown"),
    `${run.durationMs ?? 0}ms`,
    String(run.filesChanged),
    String(run.riskCount),
    run.command.join(" ") || "(invalid)",
  ]);
  const widths = ["Run", "Status", "Exit", "Duration", "Files", "Risks", "Command"].map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length))
  );
  const formatRow = (row: string[]) => row.map((value, index) => value.padEnd(widths[index]!)).join("  ");
  return [
    formatRow(["Run", "Status", "Exit", "Duration", "Files", "Risks", "Command"]),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...rows.map(formatRow),
  ].join("\n") + "\n";
}

function renderLibraryHtml(input: {
  cwd: string;
  htmlPath: string;
  runs: RunListEntry[];
  totals: LibraryTotals;
}): string {
  const data = input.runs.map((run) => ({
    id: run.id,
    status: run.status,
    command: run.command.join(" "),
    cwd: run.cwd,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    filesChanged: run.filesChanged,
    riskCount: run.riskCount,
    mcpCalls: run.mcpCalls,
    toolEvents: run.toolEvents,
    redactionCount: run.redactionCount,
    valid: run.valid,
    error: run.error,
    replayHref: relativeHref(path.dirname(input.htmlPath), run.html),
    reportHref: relativeHref(path.dirname(input.htmlPath), path.join(run.runDir, "agentbox-report.md")),
    exportHref: relativeHref(path.dirname(input.htmlPath), path.join(run.runDir, `agentbox-${run.id}.zip`)),
  }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agentbox Library</title>
<style>${libraryCss()}</style>
</head>
<body>
<header class="topbar">
  <div>
    <p class="eyebrow">Agentbox</p>
    <h1>Run Library</h1>
    <p class="subtle">${escapeHtml(input.cwd)}</p>
  </div>
  <div class="summary" aria-label="Run totals">
    <span>${input.totals.total} total</span>
    <span>${input.totals.passed} passed</span>
    <span>${input.totals.failed} failed</span>
    <span>${input.totals.risky} risky</span>
    <span>${input.totals.invalid} invalid</span>
  </div>
</header>
<main>
  <section class="toolbar" aria-label="Run filters">
    <label class="search-label" for="search">Search runs</label>
    <input id="search" data-run-search type="search" placeholder="Search command, id, path" />
    <select id="status" data-run-status aria-label="Filter by status">
      <option value="all">All statuses</option>
      <option value="passed">Passed</option>
      <option value="failed">Failed</option>
      <option value="risky">Risky</option>
      <option value="invalid">Invalid</option>
    </select>
  </section>
  <section id="runs" class="runs" aria-live="polite"></section>
</main>
<script>
window.__AGENTBOX_LIBRARY__ = ${jsonForHtml(data)};
</script>
<script>${libraryJs()}</script>
</body>
</html>
`;
}

function summarizeRuns(runs: RunListEntry[]): LibraryTotals {
  return {
    total: runs.length,
    passed: runs.filter((run) => run.status === "passed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    risky: runs.filter((run) => run.status === "risky").length,
    invalid: runs.filter((run) => run.status === "invalid").length,
  };
}

function relativeHref(fromDir: string, target: string): string {
  return path.relative(fromDir, target).split(path.sep).join("/");
}

function libraryCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f7f7f4;
  --ink: #171717;
  --muted: #62666b;
  --line: #d8d8d2;
  --surface: #ffffff;
  --soft: #ecebe5;
  --green: #216e4e;
  --red: #a33a32;
  --amber: #8a5b12;
  --blue: #255a8f;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
}
.topbar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  padding: 1.25rem 1.5rem;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.eyebrow {
  margin: 0 0 .25rem;
  color: var(--blue);
  font-size: .75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}
h1 {
  margin: 0;
  font-size: 1.35rem;
  line-height: 1.2;
}
.subtle {
  margin: .3rem 0 0;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: .5rem;
}
.summary span, .status {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: .2rem .55rem;
  background: var(--soft);
  font-size: .78rem;
  white-space: nowrap;
}
.status.passed { color: var(--green); border-color: #9fcab5; background: #eef8f2; }
.status.failed { color: var(--amber); border-color: #d8b56d; background: #fff8e9; }
.status.risky, .status.invalid { color: var(--red); border-color: #daa09b; background: #fff0ee; }
main { padding: 1rem 1.5rem 2rem; }
.toolbar {
  display: flex;
  gap: .75rem;
  align-items: center;
  margin-bottom: .9rem;
}
.search-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
input, select {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: .55rem .65rem;
  font: inherit;
  background: var(--surface);
  color: var(--ink);
}
input { width: min(34rem, 100%); }
.runs {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface);
}
.run {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .9rem;
  padding: .9rem 1rem;
  border-bottom: 1px solid var(--line);
}
.run:last-child { border-bottom: 0; }
.command {
  margin: .15rem 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.meta, .links {
  display: flex;
  flex-wrap: wrap;
  gap: .45rem .75rem;
  color: var(--muted);
  font-size: .86rem;
}
.links a { color: var(--blue); text-decoration: none; }
.links a:hover { text-decoration: underline; }
.empty {
  padding: 2rem;
  color: var(--muted);
  text-align: center;
}
@media (max-width: 720px) {
  .topbar, .run, .toolbar { display: block; }
  .summary, .links, .meta { margin-top: .75rem; }
  input, select { width: 100%; margin-bottom: .5rem; }
}
`;
}

function libraryJs(): string {
  return `
const runs = window.__AGENTBOX_LIBRARY__ || [];
const list = document.getElementById('runs');
const search = document.querySelector('[data-run-search]');
const status = document.querySelector('[data-run-status]');

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function render() {
  const query = search.value.trim().toLowerCase();
  const wanted = status.value;
  const filtered = runs.filter((run) => {
    const haystack = [run.id, run.command, run.cwd, run.error].filter(Boolean).join(' ').toLowerCase();
    return (wanted === 'all' || run.status === wanted) && (!query || haystack.includes(query));
  });
  if (!filtered.length) {
    list.innerHTML = '<div class="empty">No runs match the current filters.</div>';
    return;
  }
  list.innerHTML = filtered.map((run) => {
    const title = run.command || '(invalid run)';
    return '<article class="run">' +
      '<div><span class="status ' + esc(run.status) + '">' + esc(run.status) + '</span>' +
      '<p class="command">' + esc(title) + '</p>' +
      '<div class="meta"><span>' + esc(run.id) + '</span><span>exit ' + esc(run.exitCode ?? 'unknown') + '</span>' +
      '<span>' + esc(run.durationMs ?? 0) + 'ms</span><span>' + esc(run.filesChanged) + ' files</span>' +
      '<span>' + esc(run.riskCount) + ' risks</span><span>' + esc(run.mcpCalls) + ' MCP</span>' +
      '<span>' + esc(run.toolEvents) + ' tools</span><span>' + esc(run.redactionCount) + ' redactions</span></div></div>' +
      '<nav class="links" aria-label="Run links">' +
      (run.valid ? '<a href="' + esc(run.replayHref) + '">Replay</a><a href="' + esc(run.reportHref) + '">Report</a><a href="' + esc(run.exportHref) + '">Export</a>' : '<span>' + esc(run.error) + '</span>') +
      '</nav></article>';
  }).join('');
}

search.addEventListener('input', render);
status.addEventListener('change', render);
render();
`;
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
