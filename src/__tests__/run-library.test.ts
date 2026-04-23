import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent, ensureRunDir, listRuns, resolveExistingRunPath, resolveRunPaths, writeRunMetadata } from "../artifact.js";
import { cleanRuns } from "../clean.js";
import { compareRuns } from "../compare.js";
import { renderLibrary } from "../library.js";
import { getOpenCommand } from "../open.js";
import { SCHEMA_VERSION, type RunMetadata } from "../types.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-library-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("run discovery", () => {
  it("lists runs newest first, filters status, and tolerates invalid run directories", () => {
    writeRun(tmp, "20260101000000-pass", { exitCode: 0, startedAt: "2026-01-01T00:00:00.000Z" });
    writeRun(tmp, "20260102000000-risk", {
      exitCode: 0,
      startedAt: "2026-01-02T00:00:00.000Z",
      risks: [{ code: "danger", message: "Risk", severity: "high", source: "test" }],
    });
    writeRun(tmp, "20260103000000-fail", { exitCode: 1, startedAt: "2026-01-03T00:00:00.000Z" });
    fs.mkdirSync(path.join(tmp, ".agentbox", "runs", "broken"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".agentbox", "runs", "broken", "run.json"), "{ nope");

    const all = listRuns(tmp);
    expect(all.count).toBe(4);
    expect(all.invalidCount).toBe(1);
    expect(all.runs.map((run) => run.id).slice(0, 3)).toEqual([
      "20260103000000-fail",
      "20260102000000-risk",
      "20260101000000-pass",
    ]);
    expect(listRuns(tmp, { status: "passed" }).runs.map((run) => run.id)).toEqual(["20260101000000-pass"]);
    expect(listRuns(tmp, { status: "failed" }).runs.map((run) => run.id)).toEqual(["20260103000000-fail"]);
    expect(listRuns(tmp, { status: "risky" }).runs.map((run) => run.id)).toEqual(["20260102000000-risk"]);
    expect(listRuns(tmp, { status: "invalid" }).runs.map((run) => run.id)).toEqual(["broken"]);
  });

  it("resolves latest, exact ids, unique prefixes, paths, and ambiguous prefixes", () => {
    const older = writeRun(tmp, "20260101000000-aaaa", { startedAt: "2026-01-01T00:00:00.000Z" });
    const newer = writeRun(tmp, "20260102000000-aaab", { startedAt: "2026-01-02T00:00:00.000Z" });

    expect(resolveExistingRunPath("latest", tmp).runDir).toBe(newer.runDir);
    expect(resolveExistingRunPath("20260101000000-aaaa", tmp).runDir).toBe(older.runDir);
    expect(resolveExistingRunPath("2026010200", tmp).runDir).toBe(newer.runDir);
    expect(resolveExistingRunPath(path.join(older.runDir, "terminal.cast"), tmp).runDir).toBe(older.runDir);
    expect(() => resolveExistingRunPath("2026010", tmp)).toThrow(/ambiguous/);
    expect(() => resolveExistingRunPath("missing", tmp)).toThrow(/no agentbox run/);
  });
});

describe("library", () => {
  it("renders an offline index without inlining terminal casts", () => {
    const run = writeRun(tmp, "20260101000000-pass", { exitCode: 0 });
    fs.writeFileSync(path.join(run.runDir, "terminal.cast"), "SECRET CAST CONTENT");

    const result = renderLibrary({ cwd: tmp });
    const html = fs.readFileSync(result.htmlPath, "utf8");

    expect(result.htmlPath).toBe(path.join(tmp, ".agentbox", "index.html"));
    expect(html).toContain("Agentbox Library");
    expect(html).toContain("20260101000000-pass");
    expect(html).toContain("runs/20260101000000-pass/agentbox-run.html");
    expect(html).toContain("data-run-search");
    expect(html).not.toContain("SECRET CAST CONTENT");
    expect(html).not.toContain("data:text/plain;base64");
  });
});

describe("compare", () => {
  it("compares two runs and caps files and risks", () => {
    writeRun(tmp, "base-run", {
      exitCode: 0,
      durationMs: 100,
      files: {
        mode: "git",
        root: tmp,
        changed: 1,
        files: [{ path: "shared.txt", status: "modified", binary: false, oversized: false }],
      },
    });
    writeRun(tmp, "head-run", {
      exitCode: 1,
      durationMs: 250,
      files: {
        mode: "git",
        root: tmp,
        changed: 2,
        files: [
          { path: "shared.txt", status: "modified", binary: false, oversized: false },
          { path: "new.txt", status: "created", binary: false, oversized: false },
        ],
      },
      risks: [
        { code: "high", message: "High", severity: "high", source: "test" },
        { code: "low", message: "Low", severity: "low", source: "test" },
      ],
    });

    const result = compareRuns({ base: "base-run", head: "head-run", cwd: tmp, maxFiles: 1, maxRisks: 1 });

    expect(result.summary.exitCode).toEqual({ base: 0, head: 1, changed: true });
    expect(result.summary.durationMs.delta).toBe(150);
    expect(result.summary.files.shared).toEqual(["shared.txt"]);
    expect(result.summary.files.headOnly).toEqual(["new.txt"]);
    expect(result.summary.risks.head).toHaveLength(1);
    expect(result.markdown).toContain("# Agentbox Compare");
    expect(result.markdown).toContain("`0` -> `1`");
    expect(result.markdown).toContain("1 more risk flag(s) omitted");
  });
});

describe("clean", () => {
  it("dry-runs and deletes only selected runs when confirmed", () => {
    const oldRun = writeRun(tmp, "old-run", { startedAt: "2026-01-01T00:00:00.000Z" });
    const newRun = writeRun(tmp, "new-run", { startedAt: "2026-01-02T00:00:00.000Z" });

    const dryRun = cleanRuns({ cwd: tmp, keep: 1, dryRun: true });
    expect(dryRun.deleted).toBe(false);
    expect(dryRun.runs.map((run) => run.id)).toEqual(["old-run"]);
    expect(fs.existsSync(oldRun.runDir)).toBe(true);

    expect(() => cleanRuns({ cwd: tmp, keep: 1 })).toThrow(/--yes/);
    const deleted = cleanRuns({ cwd: tmp, keep: 1, yes: true });
    expect(deleted.deleted).toBe(true);
    expect(deleted.runs.map((run) => run.id)).toEqual(["old-run"]);
    expect(fs.existsSync(oldRun.runDir)).toBe(false);
    expect(fs.existsSync(newRun.runDir)).toBe(true);
  });

  it("requires at least one cleanup criterion", () => {
    expect(() => cleanRuns({ cwd: tmp, dryRun: true })).toThrow(/criterion/);
  });
});

describe("open", () => {
  it("selects the correct opener for supported platforms", () => {
    expect(getOpenCommand("darwin", "/tmp/run.html")).toEqual({ command: "open", args: ["/tmp/run.html"] });
    expect(getOpenCommand("linux", "/tmp/run.html")).toEqual({ command: "xdg-open", args: ["/tmp/run.html"] });
    expect(getOpenCommand("win32", "C:\\run.html")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "C:\\run.html"],
    });
  });
});

function writeRun(
  cwd: string,
  id: string,
  overrides: Partial<RunMetadata> = {}
): { runDir: string; metadata: RunMetadata } {
  const paths = resolveRunPaths(cwd, id);
  ensureRunDir(paths);
  const metadata: RunMetadata = {
    schemaVersion: SCHEMA_VERSION,
    id,
    command: ["node", "fake.js"],
    cwd,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
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
    ...overrides,
  };
  writeRunMetadata(paths, metadata);
  fs.writeFileSync(paths.diffsJson, JSON.stringify(metadata.files, null, 2) + "\n");
  fs.writeFileSync(paths.terminalCast, '{"version":2,"width":80,"height":24}\n');
  fs.writeFileSync(paths.eventsJsonl, "");
  appendEvent(paths, {
    type: "run",
    time: metadata.startedAt,
    data: { phase: "start", command: metadata.command, cwd },
  });
  return { runDir: paths.runDir, metadata };
}
