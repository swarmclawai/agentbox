import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { inspectRun } from "./inspect.js";
import type { ChangedFile, RiskFlag, Severity } from "./types.js";

export const DEFAULT_COMPARE_MAX_FILES = 12;
export const DEFAULT_COMPARE_MAX_RISKS = 8;

export interface CompareRunsOptions {
  base: string;
  head: string;
  cwd?: string;
  outPath?: string;
  maxFiles?: number;
  maxRisks?: number;
}

export interface CompareMetric<T> {
  base: T;
  head: T;
  changed: boolean;
}

export interface CompareDeltaMetric {
  base: number;
  head: number;
  delta: number;
}

export interface CompareSummary {
  baseRunId: string;
  headRunId: string;
  exitCode: CompareMetric<number | null | undefined>;
  durationMs: CompareDeltaMetric;
  changedFiles: CompareDeltaMetric;
  mcpCalls: CompareDeltaMetric;
  toolEvents: CompareDeltaMetric;
  riskCount: CompareDeltaMetric;
  redactionCount: CompareDeltaMetric;
  files: {
    shared: string[];
    baseOnly: string[];
    headOnly: string[];
    changedStatus: Array<{ path: string; base: ChangedFile["status"]; head: ChangedFile["status"] }>;
  };
  risks: {
    base: RiskFlag[];
    head: RiskFlag[];
  };
}

export interface CompareRunsResult {
  summary: CompareSummary;
  markdown: string;
  outPath?: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function compareRuns(options: CompareRunsOptions): CompareRunsResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const base = inspectRun(options.base, cwd);
  const head = inspectRun(options.head, cwd);
  const maxFiles = clampLimit(options.maxFiles, DEFAULT_COMPARE_MAX_FILES);
  const maxRisks = clampLimit(options.maxRisks, DEFAULT_COMPARE_MAX_RISKS);
  const baseFiles = new Map(base.files.files.map((file) => [file.path, file]));
  const headFiles = new Map(head.files.files.map((file) => [file.path, file]));
  const shared = [...baseFiles.keys()].filter((file) => headFiles.has(file)).sort();
  const baseOnly = [...baseFiles.keys()].filter((file) => !headFiles.has(file)).sort();
  const headOnly = [...headFiles.keys()].filter((file) => !baseFiles.has(file)).sort();
  const changedStatus = shared
    .map((file) => ({ path: file, base: baseFiles.get(file)!.status, head: headFiles.get(file)!.status }))
    .filter((file) => file.base !== file.head);
  const baseRisks = [...base.run.risks].sort(compareRisks);
  const headRisks = [...head.run.risks].sort(compareRisks);
  const baseToolEvents = base.mcpEvents.length === 0 ? countToolEvents(base.artifactPaths.eventsJsonl) : countToolEvents(base.artifactPaths.eventsJsonl);
  const headToolEvents = countToolEvents(head.artifactPaths.eventsJsonl);

  const summary: CompareSummary = {
    baseRunId: base.run.id,
    headRunId: head.run.id,
    exitCode: {
      base: base.run.exitCode,
      head: head.run.exitCode,
      changed: base.run.exitCode !== head.run.exitCode,
    },
    durationMs: delta(base.run.durationMs ?? 0, head.run.durationMs ?? 0),
    changedFiles: delta(base.files.changed, head.files.changed),
    mcpCalls: delta(base.mcpEvents.length, head.mcpEvents.length),
    toolEvents: delta(baseToolEvents, headToolEvents),
    riskCount: delta(base.run.risks.length, head.run.risks.length),
    redactionCount: delta(base.run.redactions.total, head.run.redactions.total),
    files: {
      shared: shared.slice(0, maxFiles),
      baseOnly: baseOnly.slice(0, maxFiles),
      headOnly: headOnly.slice(0, maxFiles),
      changedStatus: changedStatus.slice(0, maxFiles),
    },
    risks: {
      base: baseRisks.slice(0, maxRisks),
      head: headRisks.slice(0, maxRisks),
    },
  };
  const markdown = formatCompareMarkdown(summary, {
    totalShared: shared.length,
    totalBaseOnly: baseOnly.length,
    totalHeadOnly: headOnly.length,
    totalChangedStatus: changedStatus.length,
    totalBaseRisks: baseRisks.length,
    totalHeadRisks: headRisks.length,
  });
  const outPath = options.outPath ? path.resolve(cwd, options.outPath) : undefined;
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, markdown);
  }
  return { summary, markdown, ...(outPath ? { outPath } : {}) };
}

function formatCompareMarkdown(
  summary: CompareSummary,
  totals: {
    totalShared: number;
    totalBaseOnly: number;
    totalHeadOnly: number;
    totalChangedStatus: number;
    totalBaseRisks: number;
    totalHeadRisks: number;
  }
): string {
  const lines = [
    "# Agentbox Compare",
    "",
    `Base ${inlineCode(summary.baseRunId)} compared with head ${inlineCode(summary.headRunId)}.`,
    "",
    "| Field | Base | Head | Delta |",
    "| --- | ---: | ---: | ---: |",
    `| Exit code | ${inlineCode(String(summary.exitCode.base ?? "unknown"))} | ${inlineCode(
      String(summary.exitCode.head ?? "unknown")
    )} | ${summary.exitCode.changed ? `${inlineCode(String(summary.exitCode.base ?? "unknown"))} -> ${inlineCode(String(summary.exitCode.head ?? "unknown"))}` : "unchanged"} |`,
    metricRow("Duration", summary.durationMs, "ms"),
    metricRow("Files changed", summary.changedFiles),
    metricRow("MCP calls", summary.mcpCalls),
    metricRow("Tool events", summary.toolEvents),
    metricRow("Risk flags", summary.riskCount),
    metricRow("Redactions", summary.redactionCount),
    "",
    "## Files",
    "",
    listSection("Shared", summary.files.shared, totals.totalShared),
    listSection("Base only", summary.files.baseOnly, totals.totalBaseOnly),
    listSection("Head only", summary.files.headOnly, totals.totalHeadOnly),
  ];

  if (summary.files.changedStatus.length > 0) {
    lines.push("", "Changed statuses:");
    for (const file of summary.files.changedStatus) {
      lines.push(`- ${inlineCode(file.path)} ${inlineCode(file.base)} -> ${inlineCode(file.head)}`);
    }
    if (totals.totalChangedStatus > summary.files.changedStatus.length) {
      lines.push(`- ${totals.totalChangedStatus - summary.files.changedStatus.length} more status change(s) omitted.`);
    }
  }

  lines.push("", "## Risks", "", "Base risks:");
  appendRisks(lines, summary.risks.base, totals.totalBaseRisks);
  lines.push("", "Head risks:");
  appendRisks(lines, summary.risks.head, totals.totalHeadRisks);
  return lines.join("\n") + "\n";
}

function metricRow(label: string, value: CompareDeltaMetric, unit = ""): string {
  const suffix = unit ? unit : "";
  const deltaValue = `${value.delta >= 0 ? "+" : ""}${value.delta}${suffix}`;
  return `| ${label} | ${inlineCode(`${value.base}${suffix}`)} | ${inlineCode(`${value.head}${suffix}`)} | ${inlineCode(deltaValue)} |`;
}

function listSection(title: string, values: string[], total: number): string {
  if (values.length === 0) return `${title}: none.`;
  return [
    `${title}:`,
    ...values.map((value) => `- ${inlineCode(value)}`),
    ...(total > values.length ? [`- ${total - values.length} more file(s) omitted.`] : []),
  ].join("\n");
}

function appendRisks(lines: string[], risks: RiskFlag[], total: number): void {
  if (risks.length === 0) {
    lines.push("No risk flags detected.");
    return;
  }
  for (const risk of risks) {
    lines.push(`- ${inlineCode(risk.severity)} ${inlineCode(risk.code)} from ${inlineCode(risk.source)}: ${risk.message}`);
  }
  if (total > risks.length) lines.push(`- ${total - risks.length} more risk flag(s) omitted.`);
}

function countToolEvents(eventsPath: string): number {
  if (!fs.existsSync(eventsPath)) return 0;
  return fs
    .readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string })
    .filter((event) => event.type === "tool").length;
}

function delta(base: number, head: number): CompareDeltaMetric {
  return { base, head, delta: head - base };
}

function compareRisks(a: RiskFlag, b: RiskFlag): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.code.localeCompare(b.code);
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error("compare limits must be non-negative numbers");
  return Math.floor(value);
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, "\\`")}\``;
}
