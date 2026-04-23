import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoRun } from "../demo.js";
import { exportRun } from "../export.js";
import { inspectRun } from "../inspect.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-demo-export-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("demo and export", () => {
  it("creates a self-contained demo run without caller-local fixtures", async () => {
    const result = await createDemoRun({ outDir: tmp, quiet: true });
    const inspection = inspectRun("latest", result.workspace);

    expect(result.run.exitCode).toBe(0);
    expect(fs.existsSync(result.html)).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, "run.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, "terminal.cast"))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, "events.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, "diffs.json"))).toBe(true);
    expect(inspection.files.files.map((file) => file.path)).toContain("fixture-output.txt");
  });

  it("exports the latest run as a redacted zip with a manifest", async () => {
    const result = await createDemoRun({ outDir: tmp, quiet: true });
    const exported = exportRun({
      input: "latest",
      cwd: result.workspace,
      redactPatterns: ["agentbox fixture"],
    });
    const archive = unzipSync(fs.readFileSync(exported.zipPath));
    const names = Object.keys(archive).sort();

    expect(names).toContain("agentbox-run.html");
    expect(names).toContain("terminal.cast");
    expect(names).toContain("events.jsonl");
    expect(names).toContain("diffs.json");
    expect(names).toContain("run.json");
    expect(names).toContain("SHARE.md");
    expect(names).toContain("manifest.json");

    const manifest = JSON.parse(strFromU8(archive["manifest.json"]!));
    const cast = strFromU8(archive["terminal.cast"]!);
    expect(manifest.runId).toBe(result.run.id);
    expect(manifest.files).toHaveProperty("agentbox-run.html");
    expect(cast).toContain("[REDACTED:custom_1]");
    expect(cast).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("supports latest run resolution for inspect", async () => {
    execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
    fs.mkdirSync(path.join(tmp, ".agentbox", "runs"), { recursive: true });
    const result = await createDemoRun({ outDir: tmp, quiet: true });

    const inspection = inspectRun("latest", result.workspace);
    expect(inspection.run.id).toBe(result.run.id);
  });
});
