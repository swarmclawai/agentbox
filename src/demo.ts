import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { exportRun } from "./export.js";
import { recordRun } from "./recorder.js";
import { generateReport } from "./report.js";
import type { RunMetadata } from "./types.js";

export const DEMO_SCENARIOS = ["success", "failure", "mcp-risk"] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export interface DemoRunOptions {
  outDir?: string;
  quiet?: boolean;
  jsonMode?: boolean;
  scenario?: DemoScenario;
}

export interface DemoRunResult {
  scenario: DemoScenario;
  run: RunMetadata;
  workspace: string;
  runDir: string;
  html: string;
  report: string;
  zip: string;
}

export async function createDemoRun(options: DemoRunOptions = {}): Promise<DemoRunResult> {
  const scenario = options.scenario ?? "success";
  const workspace = path.resolve(
    options.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-demo-"))
  );
  fs.mkdirSync(workspace, { recursive: true });
  initializeDemoWorkspace(workspace, scenario);

  const fixture = fileURLToPath(new URL(`../fixtures/fake-agent-${scenario}.js`, import.meta.url));
  const run = await recordRun({
    cwd: workspace,
    command: [process.execPath, fixture],
    quiet: options.quiet,
    jsonMode: options.jsonMode,
  });
  const runDir = path.join(workspace, ".agentbox", "runs", run.id);
  const exported = exportRun({
    input: runDir,
    cwd: workspace,
  });
  const report = generateReport({
    input: runDir,
    cwd: workspace,
    outPath: path.join(runDir, "REPORT.md"),
    zipPath: exported.zipPath,
    title: `Agentbox Demo: ${scenario}`,
  });
  return {
    scenario,
    run,
    workspace,
    runDir,
    html: path.join(runDir, "agentbox-run.html"),
    report: report.outPath!,
    zip: exported.zipPath,
  };
}

export function parseDemoScenario(input: string): DemoScenario {
  if (DEMO_SCENARIOS.includes(input as DemoScenario)) return input as DemoScenario;
  throw new Error(`scenario must be one of: ${DEMO_SCENARIOS.join(", ")}`);
}

function initializeDemoWorkspace(workspace: string, scenario: DemoScenario): void {
  try {
    execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  } catch {
    // Demo still works without Git; it just won't include file diffs.
  }
  fs.writeFileSync(path.join(workspace, "fixture-input.txt"), "initial\n");
  fs.writeFileSync(
    path.join(workspace, "README.md"),
    `# Agentbox demo workspace\n\nScenario: ${scenario}\n\nThis throwaway workspace is safe to delete.\n`
  );
}
