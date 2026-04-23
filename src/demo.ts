import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { recordRun } from "./recorder.js";
import type { RunMetadata } from "./types.js";

export interface DemoRunOptions {
  outDir?: string;
  quiet?: boolean;
  jsonMode?: boolean;
}

export interface DemoRunResult {
  run: RunMetadata;
  workspace: string;
  runDir: string;
  html: string;
}

export async function createDemoRun(options: DemoRunOptions = {}): Promise<DemoRunResult> {
  const workspace = path.resolve(
    options.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-demo-"))
  );
  fs.mkdirSync(workspace, { recursive: true });
  initializeDemoWorkspace(workspace);

  const fixture = fileURLToPath(new URL("../fixtures/fake-agent.js", import.meta.url));
  const run = await recordRun({
    cwd: workspace,
    command: [process.execPath, fixture],
    quiet: options.quiet,
    jsonMode: options.jsonMode,
  });
  const runDir = path.join(workspace, ".agentbox", "runs", run.id);
  return {
    run,
    workspace,
    runDir,
    html: path.join(runDir, "agentbox-run.html"),
  };
}

function initializeDemoWorkspace(workspace: string): void {
  try {
    execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  } catch {
    // Demo still works without Git; it just won't include file diffs.
  }
  fs.writeFileSync(path.join(workspace, "fixture-input.txt"), "initial\n");
  fs.writeFileSync(
    path.join(workspace, "README.md"),
    "# Agentbox demo workspace\n\nThis throwaway workspace is safe to delete.\n"
  );
}
