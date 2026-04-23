import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import * as pty from "node-pty";
import { appendEvent, createRunId, ensureRunDir, readEvents, resolveRunPaths, writeRunMetadata } from "./artifact.js";
import { asciicastEvent, asciicastHeader } from "./asciicast.js";
import { diffSnapshots, snapshotWorkspace } from "./git-diff.js";
import { renderRun } from "./render.js";
import { buildRedactionRules, mergeRedactionReports, redactText, type RedactionRule } from "./redaction.js";
import { detectRisks } from "./risk.js";
import {
  SCHEMA_VERSION,
  type ChangedFile,
  type FileSummary,
  type McpLogEvent,
  type RedactionReport,
  type RiskFlag,
  type RunMetadata,
} from "./types.js";

const require = createRequire(import.meta.url);

export interface RecordRunOptions {
  cwd: string;
  command: string[];
  captureInput?: boolean;
  redactPatterns?: string[];
  quiet?: boolean;
  jsonMode?: boolean;
  title?: string;
}

export async function recordRun(options: RecordRunOptions): Promise<RunMetadata> {
  if (options.command.length === 0) {
    throw new Error("missing command to record");
  }

  const cwd = path.resolve(options.cwd);
  const runId = createRunId();
  const paths = resolveRunPaths(cwd, runId);
  const started = new Date();
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const env = terminalEnv();
  const commandDisplay = options.command.join(" ");
  const redactionRules = buildRedactionRules(options.redactPatterns);

  ensureRunDir(paths);
  fs.writeFileSync(
    paths.terminalCast,
    asciicastHeader({
      cols,
      rows,
      timestamp: Math.floor(started.getTime() / 1000),
      command: commandDisplay,
      env,
    })
  );
  fs.writeFileSync(paths.eventsJsonl, "");

  const before = snapshotWorkspace(cwd);
  const risks: RiskFlag[] = [];
  let redactions: RedactionReport = { total: 0, matches: [] };

  let metadata: RunMetadata = {
    schemaVersion: SCHEMA_VERSION,
    id: runId,
    command: options.command,
    cwd,
    startedAt: started.toISOString(),
    terminal: {
      cols,
      rows,
      captureInput: options.captureInput ?? false,
      env,
    },
    files: { mode: before.mode, root: before.root, changed: 0, files: [] },
    redactions,
    mcp: { calls: 0, servers: [], tools: [] },
    risks,
  };
  writeRunMetadata(paths, metadata);
  appendEvent(paths, {
    type: "run",
    time: started.toISOString(),
    data: { phase: "start", command: options.command, cwd },
  });

  const childEnv = processEnvForPty({
    AGENTBOX_RUN_ID: runId,
    AGENTBOX_RUN_DIR: paths.runDir,
  });
  const shell = options.command[0]!;
  const args = options.command.slice(1);
  const startMs = Date.now();

  const exit = await new Promise<{ exitCode: number; signal?: number }>((resolve) => {
    ensureNodePtyHelperExecutable();
    const child = pty.spawn(shell, args, {
      name: process.env.TERM || "xterm-256color",
      cols,
      rows,
      cwd,
      env: childEnv,
    });

    const writeCast = (code: "o" | "i" | "r", data: string) => {
      fs.appendFileSync(paths.terminalCast, asciicastEvent((Date.now() - startMs) / 1000, code, data));
    };

    child.onData((data) => {
      const redacted = redactText(data, redactionRules);
      redactions = mergeRedactionReports(redactions, redacted.report);
      risks.push(...detectRisks(redacted.text, "terminal"));
      writeCast("o", redacted.text);
      mirrorTerminal(data, options);
    });

    const stdinHandler = (chunk: Buffer) => {
      child.write(chunk.toString("binary"));
      if (options.captureInput) {
        const redacted = redactText(chunk.toString("utf8"), redactionRules);
        redactions = mergeRedactionReports(redactions, redacted.report);
        writeCast("i", redacted.text);
      }
    };
    const resizeHandler = () => {
      const nextCols = process.stdout.columns || cols;
      const nextRows = process.stdout.rows || rows;
      child.resize(nextCols, nextRows);
      writeCast("r", `${nextCols}x${nextRows}`);
    };

    const rawModeWasEnabled = Boolean(process.stdin.isTTY && process.stdin.isRaw);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on("data", stdinHandler);
    }
    process.stdout.on("resize", resizeHandler);

    child.onExit((event) => {
      process.stdout.off("resize", resizeHandler);
      if (process.stdin.isTTY) {
        process.stdin.off("data", stdinHandler);
        process.stdin.setRawMode?.(rawModeWasEnabled);
        if (!rawModeWasEnabled) process.stdin.pause();
      }
      resolve({ exitCode: event.exitCode, signal: event.signal });
    });
  });

  const after = snapshotWorkspace(cwd);
  const ended = new Date();
  const diffSummary = redactFileSummary(diffSnapshots(before, after), redactionRules);
  redactions = mergeRedactionReports(redactions, diffSummary.redactions);
  fs.writeFileSync(paths.diffsJson, JSON.stringify(diffSummary.files, null, 2) + "\n");

  const events = readEvents(paths.eventsJsonl);
  const mcpEvents = events
    .filter((event) => event.type === "mcp")
    .map((event) => event.data as McpLogEvent);
  const mcpRisks = mcpEvents.flatMap((event) => event.risks);
  risks.push(...mcpRisks);

  metadata = {
    ...metadata,
    endedAt: ended.toISOString(),
    durationMs: ended.getTime() - started.getTime(),
    exitCode: exit.exitCode,
    signal: exit.signal == null ? null : String(exit.signal),
    files: diffSummary.files,
    redactions,
    mcp: {
      calls: mcpEvents.length,
      servers: unique(mcpEvents.map((event) => event.server)),
      tools: unique(mcpEvents.map((event) => event.toolName).filter(Boolean) as string[]),
    },
    risks: dedupeRisks(risks),
  };
  writeRunMetadata(paths, metadata);
  appendEvent(paths, {
    type: "run",
    time: ended.toISOString(),
    data: { phase: "end", exitCode: exit.exitCode, signal: exit.signal },
  });
  renderRun(paths.runDir);
  return metadata;
}

function ensureNodePtyHelperExecutable(): void {
  if (os.platform() !== "darwin") return;
  try {
    const entry = require.resolve("node-pty");
    const root = findPackageRoot(entry, "node-pty");
    const helper = path.join(root, "prebuilds", `darwin-${os.arch()}`, "spawn-helper");
    if (!fs.existsSync(helper)) return;
    const stat = fs.statSync(helper);
    if ((stat.mode & 0o111) === 0) {
      fs.chmodSync(helper, stat.mode | 0o755);
    }
  } catch {
    // If this best-effort repair fails, node-pty will surface the real spawn error.
  }
}

function findPackageRoot(start: string, packageName: string): string {
  let current = path.dirname(start);
  while (current !== path.dirname(current)) {
    if (path.basename(current) === packageName && fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.dirname(start);
}

function redactFileSummary(
  files: FileSummary,
  rules: RedactionRule[]
): { files: FileSummary; redactions: RedactionReport } {
  let report: RedactionReport = { total: 0, matches: [] };
  const changed = files.files.map((file): ChangedFile => {
    if (!file.diff) return file;
    const redacted = redactText(file.diff, rules);
    report = mergeRedactionReports(report, redacted.report);
    return { ...file, diff: redacted.text };
  });
  return {
    files: { ...files, files: changed },
    redactions: report,
  };
}

function terminalEnv(): Record<string, string> {
  return {
    SHELL: process.env.SHELL || defaultShell(),
    TERM: process.env.TERM || "xterm-256color",
  };
}

function processEnvForPty(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...extra };
}

function defaultShell(): string {
  return os.platform() === "win32" ? "powershell.exe" : "/bin/sh";
}

function mirrorTerminal(data: string, options: RecordRunOptions): void {
  if (options.quiet) return;
  if (options.jsonMode) {
    process.stderr.write(data);
  } else {
    process.stdout.write(data);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function dedupeRisks(risks: RiskFlag[]): RiskFlag[] {
  const seen = new Set<string>();
  const result: RiskFlag[] = [];
  for (const risk of risks) {
    const key = `${risk.code}:${risk.source}:${risk.sample ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(risk);
  }
  return result;
}
