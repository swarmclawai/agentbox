import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureRunDir, resolveRunPaths, writeRunMetadata } from "../artifact.js";
import { inspectRun } from "../inspect.js";
import { renderRun } from "../render.js";
import { SCHEMA_VERSION, type RunMetadata } from "../types.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-render-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("render and inspect", () => {
  it("renders a self-contained replay and inspects run metadata", () => {
    const paths = resolveRunPaths(tmp, "run-test");
    ensureRunDir(paths);
    const metadata: RunMetadata = {
      schemaVersion: SCHEMA_VERSION,
      id: "run-test",
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
        changed: 1,
        files: [
          {
            path: "file.txt",
            status: "modified",
            binary: false,
            oversized: false,
            diff: "--- a/file.txt\n+++ b/file.txt\n@@ modified @@\n-old\n+new\n",
          },
        ],
      },
      redactions: { total: 1, matches: [{ name: "openai_key", count: 1 }] },
      mcp: { calls: 0, servers: [], tools: [] },
      risks: [],
    };
    writeRunMetadata(paths, metadata);
    fs.writeFileSync(paths.diffsJson, JSON.stringify(metadata.files, null, 2));
    fs.writeFileSync(
      paths.terminalCast,
      '{"version":2,"width":80,"height":24}\n[0.1,"o","hello"]\n'
    );
    fs.writeFileSync(paths.eventsJsonl, "");

    const htmlPath = renderRun(paths.runDir);
    const html = fs.readFileSync(htmlPath, "utf8");
    const inspection = inspectRun(paths.runDir);

    expect(html).toContain("AsciinemaPlayer.create");
    expect(html).toContain("Timeline");
    expect(html).toContain("idleTimeLimit: 2");
    expect(html).toContain("fit: true");
    expect(html).toContain("file-filter");
    expect(html).toContain("data:text/plain;base64");
    expect(html).toContain("file.txt");
    expect(inspection.run.id).toBe("run-test");
    expect(inspection.redactionCount).toBe(1);
  });
});
