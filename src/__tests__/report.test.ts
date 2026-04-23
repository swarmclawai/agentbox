import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent, ensureRunDir, resolveRunPaths, writeRunMetadata } from "../artifact.js";
import { generateReport, shouldFailForRisk } from "../report.js";
import { SCHEMA_VERSION, type RiskFlag, type RunMetadata } from "../types.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-report-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("report", () => {
  it("renders a capped markdown summary for the latest run", () => {
    const paths = resolveRunPaths(tmp, "run-report");
    ensureRunDir(paths);
    const risks: RiskFlag[] = [
      {
        code: "low-note",
        message: "Low risk note",
        severity: "low",
        source: "terminal",
      },
      {
        code: "danger",
        message: "High risk command",
        severity: "high",
        source: "mcp",
      },
    ];
    const metadata: RunMetadata = {
      schemaVersion: SCHEMA_VERSION,
      id: "run-report",
      command: ["node", "fake.js"],
      cwd: tmp,
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString(),
      durationMs: 1000,
      exitCode: 0,
      signal: null,
      terminal: {
        cols: 80,
        rows: 24,
        captureInput: false,
        env: { SHELL: "/bin/zsh", TERM: "xterm-256color" },
      },
      files: {
        mode: "git",
        root: tmp,
        changed: 2,
        files: [
          { path: "one.txt", status: "modified", binary: false, oversized: false },
          { path: "two.txt", status: "created", binary: false, oversized: false },
        ],
      },
      redactions: { total: 1, matches: [{ name: "github_token", count: 1 }] },
      mcp: { calls: 1, servers: ["fake"], tools: ["write"] },
      risks,
    };
    writeRunMetadata(paths, metadata);
    fs.writeFileSync(paths.diffsJson, JSON.stringify(metadata.files, null, 2));
    fs.writeFileSync(paths.terminalCast, '{"version":2,"width":80,"height":24}\n');
    fs.writeFileSync(paths.eventsJsonl, "");
    appendEvent(paths, {
      type: "mcp",
      time: new Date(0).toISOString(),
      data: {
        server: "fake",
        method: "tools/call",
        toolName: "write",
        requestAt: new Date(0).toISOString(),
        risks: [],
      },
    });
    appendEvent(paths, {
      type: "tool",
      time: new Date(0).toISOString(),
      data: {
        platform: "claude",
        observedAt: new Date(0).toISOString(),
        inputSummary: {},
        risks: [],
        redactions: { total: 0, matches: [] },
      },
    });

    const result = generateReport({
      input: "latest",
      cwd: tmp,
      artifactUrl: "https://github.com/example/repo/actions/runs/1/artifacts/2",
      zipPath: "agentbox.zip",
      title: "Agentbox CI",
      maxFiles: 1,
      maxRisks: 1,
    });

    expect(result.summary.runId).toBe("run-report");
    expect(result.summary.highestRiskSeverity).toBe("high");
    expect(result.summary.mcpCalls).toBe(1);
    expect(result.summary.toolEvents).toBe(1);
    expect(result.summary.files).toHaveLength(1);
    expect(result.summary.risks).toHaveLength(1);
    expect(result.markdown).toContain("# Agentbox CI");
    expect(result.markdown).toContain("GitHub artifact");
    expect(result.markdown).toContain("1 more file(s) omitted");
    expect(result.markdown).toContain("1 more risk flag(s) omitted");
  });

  it("writes report output when requested", () => {
    const paths = resolveRunPaths(tmp, "run-write");
    ensureRunDir(paths);
    const metadata = minimalRunMetadata(tmp, "run-write");
    writeRunMetadata(paths, metadata);
    fs.writeFileSync(paths.diffsJson, JSON.stringify(metadata.files, null, 2));
    fs.writeFileSync(paths.eventsJsonl, "");

    const result = generateReport({ input: "latest", cwd: tmp, outPath: "report.md" });

    expect(result.outPath).toBe(path.join(tmp, "report.md"));
    expect(fs.readFileSync(path.join(tmp, "report.md"), "utf8")).toBe(result.markdown);
  });
});

describe("risk threshold", () => {
  const risks: RiskFlag[] = [
    { code: "low", message: "low", severity: "low", source: "test" },
    { code: "medium", message: "medium", severity: "medium", source: "test" },
  ];

  it("matches the configured minimum severity", () => {
    expect(shouldFailForRisk(risks, "off")).toBe(false);
    expect(shouldFailForRisk(risks, "high")).toBe(false);
    expect(shouldFailForRisk(risks, "medium")).toBe(true);
    expect(shouldFailForRisk(risks, "low")).toBe(true);
  });
});

function minimalRunMetadata(cwd: string, id: string): RunMetadata {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    command: ["node", "fake.js"],
    cwd,
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(1).toISOString(),
    durationMs: 1000,
    exitCode: 0,
    signal: null,
    terminal: {
      cols: 80,
      rows: 24,
      captureInput: false,
      env: { SHELL: "/bin/zsh", TERM: "xterm-256color" },
    },
    files: { mode: "git", root: cwd, changed: 0, files: [] },
    redactions: { total: 0, matches: [] },
    mcp: { calls: 0, servers: [], tools: [] },
    risks: [],
  };
}
