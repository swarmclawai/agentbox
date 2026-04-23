import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AgentboxEvent, RunMetadata } from "./types.js";

export interface RunPaths {
  runDir: string;
  runJson: string;
  terminalCast: string;
  eventsJsonl: string;
  diffsJson: string;
  html: string;
}

export type RunStatus = "passed" | "failed" | "risky" | "invalid";
export type RunStatusFilter = RunStatus | "all";

export interface RunListEntry {
  id: string;
  runDir: string;
  runJson: string;
  terminalCast: string;
  eventsJsonl: string;
  diffsJson: string;
  html: string;
  valid: boolean;
  status: RunStatus;
  command: string[];
  cwd?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  filesChanged: number;
  riskCount: number;
  mcpCalls: number;
  toolEvents: number;
  redactionCount: number;
  updatedAt: string;
  error?: string;
}

export interface ListRunsOptions {
  limit?: number;
  status?: RunStatusFilter;
}

export interface ListRunsResult {
  runs: RunListEntry[];
  count: number;
  invalidCount: number;
  runsDir: string;
}

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${stamp}-${suffix}`;
}

export function resolveRunPaths(cwd: string, runId: string): RunPaths {
  const runDir = path.resolve(cwd, ".agentbox", "runs", runId);
  return runPathsForDir(runDir);
}

export function runPathsForDir(runDir: string): RunPaths {
  return {
    runDir: path.resolve(runDir),
    runJson: path.join(runDir, "run.json"),
    terminalCast: path.join(runDir, "terminal.cast"),
    eventsJsonl: path.join(runDir, "events.jsonl"),
    diffsJson: path.join(runDir, "diffs.json"),
    html: path.join(runDir, "agentbox-run.html"),
  };
}

export function ensureRunDir(paths: RunPaths): void {
  fs.mkdirSync(paths.runDir, { recursive: true });
}

export function writeRunMetadata(paths: RunPaths, metadata: RunMetadata): void {
  fs.writeFileSync(paths.runJson, JSON.stringify(metadata, null, 2) + "\n");
}

export function appendEvent(paths: Pick<RunPaths, "eventsJsonl">, event: AgentboxEvent): void {
  fs.appendFileSync(paths.eventsJsonl, JSON.stringify(event) + "\n");
}

export function readEvents(eventsPath: string): AgentboxEvent[] {
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentboxEvent);
}

export function listRuns(cwd = process.cwd(), options: ListRunsOptions = {}): ListRunsResult {
  const runsDir = path.resolve(cwd, ".agentbox", "runs");
  if (!fs.existsSync(runsDir)) return { runs: [], count: 0, invalidCount: 0, runsDir };

  const limit = options.limit == null ? undefined : Math.max(0, Math.floor(options.limit));
  const status = options.status ?? "all";
  const allRuns = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readRunListEntry(path.join(runsDir, entry.name)))
    .sort(compareRunEntries);
  const filteredRuns = status === "all" ? allRuns : allRuns.filter((run) => run.status === status);
  const runs = limit == null ? filteredRuns : filteredRuns.slice(0, limit);
  return {
    runs,
    count: runs.length,
    invalidCount: allRuns.filter((run) => !run.valid).length,
    runsDir,
  };
}

export function resolveExistingRunPath(input: string, cwd = process.cwd()): RunPaths {
  const runDir = resolveExistingRunDir(input, cwd);
  return runPathsForDir(runDir);
}

export function resolveExistingRunDir(input: string, cwd = process.cwd()): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("missing agentbox run target");
  if (trimmed === "latest") return resolveLatestRunDir(cwd);

  const maybePath = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
  if (fs.existsSync(maybePath)) {
    const stat = fs.statSync(maybePath);
    const runDir = stat.isDirectory() ? maybePath : path.dirname(maybePath);
    if (!fs.existsSync(path.join(runDir, "run.json"))) {
      throw new Error(`no agentbox run found at ${maybePath}`);
    }
    return runDir;
  }

  const candidates = listRuns(cwd).runs.filter((run) => run.id === trimmed || path.basename(run.runDir) === trimmed);
  if (candidates.length === 1) return candidates[0]!.runDir;

  const prefixCandidates = listRuns(cwd).runs.filter(
    (run) => run.id.startsWith(trimmed) || path.basename(run.runDir).startsWith(trimmed)
  );
  if (prefixCandidates.length === 1) return prefixCandidates[0]!.runDir;
  if (prefixCandidates.length > 1) {
    throw new Error(
      `ambiguous agentbox run prefix ${trimmed}; matched ${prefixCandidates.map((run) => run.id).join(", ")}`
    );
  }
  throw new Error(`no agentbox run found for ${trimmed}`);
}

function resolveLatestRunDir(cwd: string): string {
  const latest = listRuns(cwd).runs.find((run) => run.valid);
  if (!latest) {
    const runsDir = path.resolve(cwd, ".agentbox", "runs");
    throw new Error(`no agentbox runs found in ${runsDir}`);
  }
  return latest.runDir;
}

function readRunListEntry(runDir: string): RunListEntry {
  const paths = runPathsForDir(runDir);
  const updatedAt = statTime(paths.runJson) ?? statTime(runDir) ?? new Date(0).toISOString();
  try {
    if (!fs.existsSync(paths.runJson)) throw new Error("missing run.json");
    const run = JSON.parse(fs.readFileSync(paths.runJson, "utf8")) as RunMetadata;
    const events = readEventsSafe(paths.eventsJsonl);
    const toolEvents = events.filter((event) => event.type === "tool").length;
    const riskCount = run.risks.length;
    const status: RunStatus = riskCount > 0 ? "risky" : run.exitCode === 0 ? "passed" : "failed";
    return {
      ...paths,
      id: run.id || path.basename(runDir),
      valid: true,
      status,
      command: run.command,
      cwd: run.cwd,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      durationMs: run.durationMs,
      exitCode: run.exitCode,
      filesChanged: run.files.changed,
      riskCount,
      mcpCalls: run.mcp.calls,
      toolEvents,
      redactionCount: run.redactions.total,
      updatedAt: run.startedAt || updatedAt,
    };
  } catch (err) {
    return {
      ...paths,
      id: path.basename(runDir),
      valid: false,
      status: "invalid",
      command: [],
      filesChanged: 0,
      riskCount: 0,
      mcpCalls: 0,
      toolEvents: 0,
      redactionCount: 0,
      updatedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function readEventsSafe(eventsPath: string): AgentboxEvent[] {
  try {
    return readEvents(eventsPath);
  } catch {
    return [];
  }
}

function statTime(input: string): string | undefined {
  if (!fs.existsSync(input)) return undefined;
  return fs.statSync(input).mtime.toISOString();
}

function compareRunEntries(a: RunListEntry, b: RunListEntry): number {
  if (a.valid !== b.valid) return a.valid ? -1 : 1;
  const aTime = Date.parse(a.updatedAt);
  const bTime = Date.parse(b.updatedAt);
  return bTime - aTime || b.id.localeCompare(a.id);
}
