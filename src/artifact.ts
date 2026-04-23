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

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${stamp}-${suffix}`;
}

export function resolveRunPaths(cwd: string, runId: string): RunPaths {
  const runDir = path.resolve(cwd, ".agentbox", "runs", runId);
  return {
    runDir,
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

export function resolveExistingRunPath(input: string, cwd = process.cwd()): RunPaths {
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input);
  const stat = fs.existsSync(absolute) ? fs.statSync(absolute) : undefined;
  const runDir = stat?.isDirectory() ? absolute : path.dirname(absolute);
  return {
    runDir,
    runJson: path.join(runDir, "run.json"),
    terminalCast: path.join(runDir, "terminal.cast"),
    eventsJsonl: path.join(runDir, "events.jsonl"),
    diffsJson: path.join(runDir, "diffs.json"),
    html: path.join(runDir, "agentbox-run.html"),
  };
}
