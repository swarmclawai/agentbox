import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readEvents } from "./artifact.js";
import { inspectRun } from "./inspect.js";
import type { AgentboxEvent, ChangedFile, RiskFlag, Severity, ToolLogEvent } from "./types.js";

export const DEFAULT_REPORT_MAX_FILES = 12;
export const DEFAULT_REPORT_MAX_RISKS = 8;

export type RiskThreshold = "off" | Severity;

export interface ReportOptions {
  input: string;
  cwd?: string;
  outPath?: string;
  artifactUrl?: string;
  zipPath?: string;
  title?: string;
  maxFiles?: number;
  maxRisks?: number;
}

export interface ReportFile {
  path: string;
  status: ChangedFile["status"];
  binary: boolean;
  oversized: boolean;
}

export interface ReportSummary {
  runId: string;
  command: string[];
  cwd: string;
  exitCode: number | null | undefined;
  durationMs: number;
  changedFiles: number;
  mcpCalls: number;
  toolEvents: number;
  riskCount: number;
  redactionCount: number;
  highestRiskSeverity: Severity | null;
  files: ReportFile[];
  risks: RiskFlag[];
  htmlPath: string;
  zipPath?: string;
  artifactUrl?: string;
}

export interface ReportResult {
  summary: ReportSummary;
  markdown: string;
  outPath?: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function generateReport(options: ReportOptions): ReportResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const inspection = inspectRun(options.input, cwd);
  const events = readEvents(inspection.artifactPaths.eventsJsonl);
  const toolEvents = events
    .filter((event) => event.type === "tool")
    .map((event) => event.data as ToolLogEvent);
  const maxFiles = clampLimit(options.maxFiles, DEFAULT_REPORT_MAX_FILES);
  const maxRisks = clampLimit(options.maxRisks, DEFAULT_REPORT_MAX_RISKS);
  const risks = [...inspection.run.risks].sort(compareRisks);
  const files = inspection.files.files.slice(0, maxFiles).map((file) => ({
    path: file.path,
    status: file.status,
    binary: file.binary,
    oversized: file.oversized,
  }));
  const topRisks = risks.slice(0, maxRisks);
  const summary: ReportSummary = {
    runId: inspection.run.id,
    command: inspection.run.command,
    cwd: inspection.run.cwd,
    exitCode: inspection.run.exitCode,
    durationMs: inspection.run.durationMs ?? 0,
    changedFiles: inspection.files.changed,
    mcpCalls: inspection.mcpEvents.length,
    toolEvents: toolEvents.length,
    riskCount: inspection.run.risks.length,
    redactionCount: inspection.run.redactions.total,
    highestRiskSeverity: highestSeverity(inspection.run.risks),
    files,
    risks: topRisks,
    htmlPath: inspection.artifactPaths.html,
    ...(options.zipPath ? { zipPath: path.resolve(cwd, options.zipPath) } : {}),
    ...(options.artifactUrl ? { artifactUrl: options.artifactUrl } : {}),
  };
  const markdown = formatReportMarkdown(summary, {
    title: options.title,
    totalFiles: inspection.files.files.length,
    totalRisks: risks.length,
  });
  const outPath = options.outPath ? path.resolve(cwd, options.outPath) : undefined;
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, markdown);
  }
  return { summary, markdown, ...(outPath ? { outPath } : {}) };
}

export function shouldFailForRisk(risks: RiskFlag[], threshold: RiskThreshold): boolean {
  if (threshold === "off") return false;
  const minimum = SEVERITY_RANK[threshold];
  return risks.some((risk) => SEVERITY_RANK[risk.severity] >= minimum);
}

export function parseRiskThreshold(input: string): RiskThreshold {
  if (input === "off" || input === "high" || input === "medium" || input === "low") return input;
  throw new Error("fail-on-risk must be one of: off, high, medium, low");
}

function formatReportMarkdown(
  summary: ReportSummary,
  totals: { title?: string; totalFiles: number; totalRisks: number }
): string {
  const lines = [
    `# ${totals.title?.trim() || "Agentbox Report"}`,
    "",
    `Run ${inlineCode(summary.runId)} captured ${inlineCode(summary.command.join(" "))}.`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Exit | ${inlineCode(String(summary.exitCode ?? "unknown"))} |`,
    `| Duration | ${inlineCode(`${summary.durationMs}ms`)} |`,
    `| Files changed | ${inlineCode(String(summary.changedFiles))} |`,
    `| MCP calls | ${inlineCode(String(summary.mcpCalls))} |`,
    `| Tool events | ${inlineCode(String(summary.toolEvents))} |`,
    `| Risk flags | ${inlineCode(String(summary.riskCount))} |`,
    `| Redactions | ${inlineCode(String(summary.redactionCount))} |`,
    "",
    "## Replay",
    "",
    `- HTML: ${inlineCode(summary.htmlPath)}`,
  ];

  if (summary.zipPath) lines.push(`- Export zip: ${inlineCode(summary.zipPath)}`);
  if (summary.artifactUrl) lines.push(`- GitHub artifact: [download replay zip](${summary.artifactUrl})`);

  lines.push("", "## Files");
  if (summary.files.length === 0) {
    lines.push("", "No file changes captured.");
  } else {
    lines.push("");
    for (const file of summary.files) {
      const tags = [file.binary ? "binary" : "", file.oversized ? "oversized" : ""]
        .filter(Boolean)
        .join(", ");
      lines.push(`- ${inlineCode(file.status)} ${inlineCode(file.path)}${tags ? ` (${tags})` : ""}`);
    }
    if (totals.totalFiles > summary.files.length) {
      lines.push(`- ${totals.totalFiles - summary.files.length} more file(s) omitted by the report limit.`);
    }
  }

  lines.push("", "## Risks");
  if (summary.risks.length === 0) {
    lines.push("", "No risk flags detected.");
  } else {
    lines.push("");
    for (const risk of summary.risks) {
      lines.push(
        `- ${inlineCode(risk.severity)} ${inlineCode(risk.code)} from ${inlineCode(risk.source)}: ${escapeMarkdownText(
          risk.message
        )}`
      );
    }
    if (totals.totalRisks > summary.risks.length) {
      lines.push(`- ${totals.totalRisks - summary.risks.length} more risk flag(s) omitted by the report limit.`);
    }
  }

  return lines.join("\n") + "\n";
}

function highestSeverity(risks: RiskFlag[]): Severity | null {
  let highest: Severity | null = null;
  for (const risk of risks) {
    if (!highest || SEVERITY_RANK[risk.severity] > SEVERITY_RANK[highest]) highest = risk.severity;
  }
  return highest;
}

function compareRisks(a: RiskFlag, b: RiskFlag): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.code.localeCompare(b.code);
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error("report limits must be non-negative numbers");
  return Math.floor(value);
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, "\\`")}\``;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\|/g, "\\|");
}
