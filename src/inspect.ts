import fs from "node:fs";
import type { FileSummary, McpLogEvent, RunMetadata } from "./types.js";
import { readEvents, resolveExistingRunPath } from "./artifact.js";

export interface RunInspection {
  run: RunMetadata;
  files: FileSummary;
  mcpEvents: McpLogEvent[];
  riskCount: number;
  redactionCount: number;
  artifactPaths: {
    runJson: string;
    terminalCast: string;
    eventsJsonl: string;
    diffsJson: string;
    html: string;
  };
}

export function inspectRun(input: string, cwd = process.cwd()): RunInspection {
  const paths = resolveExistingRunPath(input, cwd);
  const run = JSON.parse(fs.readFileSync(paths.runJson, "utf8")) as RunMetadata;
  const files = fs.existsSync(paths.diffsJson)
    ? (JSON.parse(fs.readFileSync(paths.diffsJson, "utf8")) as FileSummary)
    : run.files;
  const events = readEvents(paths.eventsJsonl);
  const mcpEvents = events
    .filter((event) => event.type === "mcp")
    .map((event) => event.data as McpLogEvent);

  return {
    run,
    files,
    mcpEvents,
    riskCount: run.risks.length,
    redactionCount: run.redactions.total,
    artifactPaths: {
      runJson: paths.runJson,
      terminalCast: paths.terminalCast,
      eventsJsonl: paths.eventsJsonl,
      diffsJson: paths.diffsJson,
      html: paths.html,
    },
  };
}

export function formatInspectionHuman(inspection: RunInspection): string {
  const { run, files, mcpEvents } = inspection;
  const lines = [
    `Agentbox run ${run.id}`,
    `command: ${run.command.join(" ")}`,
    `cwd: ${run.cwd}`,
    `exit: ${run.exitCode ?? "unknown"}`,
    `duration: ${run.durationMs ?? 0}ms`,
    `files changed: ${files.changed}`,
    `mcp calls: ${mcpEvents.length}`,
    `risk flags: ${inspection.riskCount}`,
    `redactions: ${inspection.redactionCount}`,
    `html: ${inspection.artifactPaths.html}`,
  ];

  if (files.files.length > 0) {
    lines.push("", "Changed files:");
    for (const file of files.files) {
      lines.push(`  ${file.status.padEnd(8)} ${file.path}`);
    }
  }

  return lines.join("\n") + "\n";
}
