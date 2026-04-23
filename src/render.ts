import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { AgentboxEvent, FileSummary, RunMetadata } from "./types.js";
import { readEvents, resolveExistingRunPath, type RunPaths } from "./artifact.js";

const require = createRequire(import.meta.url);

interface ReplayData {
  run: RunMetadata;
  files: FileSummary;
  events: AgentboxEvent[];
}

export function renderRun(input: string, cwd = process.cwd()): string {
  const paths = resolveExistingRunPath(input, cwd);
  const html = renderRunHtml(paths);
  fs.writeFileSync(paths.html, html);
  return paths.html;
}

export function renderRunHtml(paths: RunPaths): string {
  const run = JSON.parse(fs.readFileSync(paths.runJson, "utf8")) as RunMetadata;
  const files = fs.existsSync(paths.diffsJson)
    ? (JSON.parse(fs.readFileSync(paths.diffsJson, "utf8")) as FileSummary)
    : run.files;
  const events = readEvents(paths.eventsJsonl);
  const cast = fs.existsSync(paths.terminalCast)
    ? fs.readFileSync(paths.terminalCast, "utf8")
    : '{"version":2,"width":80,"height":24}\n';
  const assets = loadAsciinemaAssets();
  const data: ReplayData = { run, files, events };
  const castDataUrl = `data:text/plain;base64,${Buffer.from(cast, "utf8").toString("base64")}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agentbox Replay ${escapeHtml(run.id)}</title>
<style>${assets.css}</style>
<style>${pageCss()}</style>
</head>
<body>
<header class="topbar">
  <div>
    <p class="eyebrow">Agent Black Box</p>
    <h1>${escapeHtml(run.command.join(" "))}</h1>
    <p class="subtle">${escapeHtml(run.cwd)}</p>
  </div>
  <div class="status">
    <span class="pill ${run.exitCode === 0 ? "ok" : "warn"}">exit ${escapeHtml(String(run.exitCode ?? "unknown"))}</span>
    <span class="pill">${escapeHtml(String(run.files.changed))} files</span>
    <span class="pill ${run.risks.length > 0 ? "danger" : ""}">${escapeHtml(String(run.risks.length))} risks</span>
  </div>
</header>
<main>
  <section class="terminal-band">
    <div id="terminal"></div>
  </section>
  <nav class="tabs" aria-label="Replay sections">
    <button class="tab active" data-tab="files">Files</button>
    <button class="tab" data-tab="mcp">MCP</button>
    <button class="tab" data-tab="risks">Risks</button>
    <button class="tab" data-tab="metadata">Metadata</button>
  </nav>
  <section id="panel-files" class="panel active"></section>
  <section id="panel-mcp" class="panel"></section>
  <section id="panel-risks" class="panel"></section>
  <section id="panel-metadata" class="panel"></section>
</main>
<script>${assets.js}</script>
<script>
window.__AGENTBOX_DATA__ = ${jsonForHtml(data)};
window.__AGENTBOX_CAST_URL__ = ${JSON.stringify(castDataUrl)};
</script>
<script>${pageJs()}</script>
</body>
</html>
`;
}

function loadAsciinemaAssets(): { js: string; css: string } {
  return {
    js: readPackageAsset([
      "asciinema-player/dist/bundle/asciinema-player.min.js",
      "asciinema-player/dist/bundle/asciinema-player.js",
    ]),
    css: readPackageAsset([
      "asciinema-player/dist/bundle/asciinema-player.css",
      "asciinema-player/dist/bundle/asciinema-player.min.css",
    ]),
  };
}

function readPackageAsset(candidates: string[]): string {
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(require.resolve(candidate), "utf8");
    } catch {
      // try next candidate
    }
  }
  try {
    const packageEntry = require.resolve("asciinema-player");
    const packageDir = findPackageDir(packageEntry, "asciinema-player");
    for (const candidate of candidates) {
      const assetPath = path.join(packageDir, candidate.replace("asciinema-player/", ""));
      if (fs.existsSync(assetPath)) return fs.readFileSync(assetPath, "utf8");
    }
  } catch {
    // fall through
  }
  return "window.AsciinemaPlayer={create:function(src,el){el.textContent='Unable to load asciinema-player assets.';}};";
}

function findPackageDir(start: string, name: string): string {
  let current = path.dirname(start);
  while (current !== path.dirname(current)) {
    if (path.basename(current) === name && fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.dirname(start);
}

function pageCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f7f7f4;
  --ink: #171717;
  --muted: #666b70;
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
  gap: 1.5rem;
  align-items: flex-start;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
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
  max-width: 72rem;
  font-size: 1.15rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.subtle {
  margin: .3rem 0 0;
  color: var(--muted);
  font-size: .86rem;
  overflow-wrap: anywhere;
}
.status {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: .5rem;
}
.pill {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: .2rem .55rem;
  font-size: .78rem;
  white-space: nowrap;
  background: var(--soft);
}
.pill.ok { color: var(--green); border-color: #9fcab5; background: #eef8f2; }
.pill.warn { color: var(--amber); border-color: #d8b56d; background: #fff8e9; }
.pill.danger { color: var(--red); border-color: #daa09b; background: #fff0ee; }
main { padding: 1rem 1.5rem 2rem; }
.terminal-band {
  overflow: hidden;
  border: 1px solid #1f2429;
  border-radius: 8px;
  background: #111417;
}
#terminal { min-height: 18rem; }
.tabs {
  display: flex;
  gap: .25rem;
  margin-top: 1rem;
  border-bottom: 1px solid var(--line);
}
.tab {
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  padding: .7rem .85rem;
  cursor: pointer;
  color: var(--muted);
  font: inherit;
}
.tab.active {
  color: var(--ink);
  border-bottom-color: var(--blue);
}
.panel { display: none; padding-top: 1rem; }
.panel.active { display: block; }
.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.table th, .table td {
  padding: .65rem .75rem;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
  font-size: .9rem;
}
.table th { color: var(--muted); font-weight: 600; background: #fafaf8; }
pre {
  margin: .75rem 0 1rem;
  padding: .8rem;
  overflow: auto;
  border-radius: 8px;
  background: #111417;
  color: #f2f4f5;
  font-size: .82rem;
}
.empty {
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--muted);
}
@media (max-width: 760px) {
  .topbar { flex-direction: column; }
  .status { justify-content: flex-start; }
  main { padding: .75rem; }
  .tabs { overflow-x: auto; }
}
`;
}

function pageJs(): string {
  return `
const data = window.__AGENTBOX_DATA__;
AsciinemaPlayer.create(window.__AGENTBOX_CAST_URL__, document.getElementById('terminal'), {
  preload: true,
  cols: data.run.terminal.cols,
  rows: data.run.terminal.rows,
  fit: false
});

for (const button of document.querySelectorAll('.tab')) {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.getElementById('panel-' + button.dataset.tab).classList.add('active');
  });
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);

function renderFiles() {
  const panel = document.getElementById('panel-files');
  if (!data.files.files.length) {
    panel.innerHTML = '<div class="empty">No file changes captured.</div>';
    return;
  }
  panel.innerHTML = '<table class="table"><thead><tr><th>Status</th><th>Path</th><th>Details</th></tr></thead><tbody>' +
    data.files.files.map((file) =>
      '<tr><td>' + esc(file.status) + '</td><td>' + esc(file.path) + '</td><td>' +
      (file.binary ? 'binary ' : '') + (file.oversized ? 'oversized' : '') + '</td></tr>' +
      (file.diff ? '<tr><td colspan="3"><pre>' + esc(file.diff) + '</pre></td></tr>' : '')
    ).join('') + '</tbody></table>';
}

function renderMcp() {
  const panel = document.getElementById('panel-mcp');
  const mcp = data.events.filter((event) => event.type === 'mcp').map((event) => event.data);
  if (!mcp.length) {
    panel.innerHTML = '<div class="empty">No MCP events captured. Use agentbox mcp-proxy inside a recorded run.</div>';
    return;
  }
  panel.innerHTML = '<table class="table"><thead><tr><th>Server</th><th>Method</th><th>Tool</th><th>Duration</th><th>Risks</th></tr></thead><tbody>' +
    mcp.map((event) => '<tr><td>' + esc(event.server) + '</td><td>' + esc(event.method) + '</td><td>' +
      esc(event.toolName || '') + '</td><td>' + esc(event.durationMs || 0) + 'ms</td><td>' +
      esc((event.risks || []).map((risk) => risk.code).join(', ')) + '</td></tr>').join('') +
    '</tbody></table>';
}

function renderRisks() {
  const panel = document.getElementById('panel-risks');
  const risks = data.run.risks || [];
  if (!risks.length) {
    panel.innerHTML = '<div class="empty">No risk flags detected.</div>';
    return;
  }
  panel.innerHTML = '<table class="table"><thead><tr><th>Severity</th><th>Code</th><th>Source</th><th>Message</th></tr></thead><tbody>' +
    risks.map((risk) => '<tr><td>' + esc(risk.severity) + '</td><td>' + esc(risk.code) + '</td><td>' +
      esc(risk.source) + '</td><td>' + esc(risk.message) + '</td></tr>').join('') +
    '</tbody></table>';
}

function renderMetadata() {
  document.getElementById('panel-metadata').innerHTML = '<pre>' + esc(JSON.stringify(data.run, null, 2)) + '</pre>';
}

renderFiles();
renderMcp();
renderRisks();
renderMetadata();
`;
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
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
