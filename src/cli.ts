#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { listRuns, type RunStatusFilter } from "./artifact.js";
import { cleanRuns } from "./clean.js";
import { compareRuns } from "./compare.js";
import { DEMO_SCENARIOS, createDemoRun, parseDemoScenario } from "./demo.js";
import { exportRun } from "./export.js";
import { logHookEvent, readStdinJson } from "./hook-log.js";
import { installPlatform, PLATFORMS, uninstallPlatform } from "./install.js";
import { inspectRun, formatInspectionHuman } from "./inspect.js";
import { formatRunListHuman, renderLibrary } from "./library.js";
import { openAgentboxTarget, openFile } from "./open.js";
import { recordRun } from "./recorder.js";
import { generateReport } from "./report.js";
import { renderRun } from "./render.js";
import { runMcpProxy } from "./mcp-proxy.js";

const PKG_VERSION = "0.4.1";
const OK = 0;
const USER_ERROR = 1;
const INTERNAL_ERROR = 2;

interface GlobalFlags {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  cwd?: string;
  color?: boolean;
}

function main(): void {
  if (process.argv.includes("--help-agents")) {
    process.stdout.write(JSON.stringify(agentCatalog(), null, 2) + "\n");
    process.exit(OK);
  }

  const program = buildProgram();
  program.parseAsync(process.argv).catch((err) => {
    exitInternal(err, {});
  });
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name("agentbox")
    .description("Black box footage for your AI agent.")
    .version(PKG_VERSION)
    .option("--json", "emit one-line machine-readable JSON on stdout")
    .option("--quiet", "suppress progress logs on stderr")
    .option("--verbose", "print verbose logs on stderr")
    .option("--cwd <path>", "override working directory for relative paths")
    .option("--no-color", "disable ANSI in agentbox stderr output");

  program
    .command("install")
    .description("install Agentbox instructions and hooks for an agent platform")
    .requiredOption("--platform <platform>", `platform: ${PLATFORMS.join(", ")}`)
    .action((_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ platform: string }>();
      try {
        const result = installPlatform({ platform: opts.platform, projectDir: resolveCwd(flags) });
        if (flags.json) successJson(result);
        else log(formatChanged(result.action, result.platform, result.changed), flags);
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("uninstall")
    .description("remove Agentbox instructions and hooks for an agent platform")
    .requiredOption("--platform <platform>", `platform: ${PLATFORMS.join(", ")}`)
    .action((_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ platform: string }>();
      try {
        const result = uninstallPlatform({ platform: opts.platform, projectDir: resolveCwd(flags) });
        if (flags.json) successJson(result);
        else log(formatChanged(result.action, result.platform, result.changed), flags);
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  for (const platform of PLATFORMS) {
    const platformCommand = program.command(platform).description(`${platform} integration helpers`);
    platformCommand
      .command("install")
      .description(`install Agentbox for ${platform}`)
      .action((_opts, cmd: Command) => {
        const flags = mergeFlags(cmd);
        try {
          const result = installPlatform({ platform, projectDir: resolveCwd(flags) });
          if (flags.json) successJson(result);
          else log(formatChanged(result.action, result.platform, result.changed), flags);
          process.exit(OK);
        } catch (err) {
          exitInternal(err, flags);
        }
      });
    platformCommand
      .command("uninstall")
      .description(`uninstall Agentbox for ${platform}`)
      .action((_opts, cmd: Command) => {
        const flags = mergeFlags(cmd);
        try {
          const result = uninstallPlatform({ platform, projectDir: resolveCwd(flags) });
          if (flags.json) successJson(result);
          else log(formatChanged(result.action, result.platform, result.changed), flags);
          process.exit(OK);
        } catch (err) {
          exitInternal(err, flags);
        }
      });
  }

  program
    .command("hook-log")
    .description("record an agent hook payload into the current Agentbox run")
    .requiredOption("--platform <platform>", "agent platform name")
    .option("--redact-pattern <regex>", "extra regex to redact from hook payloads", collect, [])
    .action(async (_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ platform: string; redactPattern: string[] }>();
      try {
        const input = await readStdinJson();
        const result = await logHookEvent({
          platform: opts.platform,
          input,
          redactPatterns: opts.redactPattern,
        });
        if (flags.json) successJson(result);
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("demo")
    .description("create and record a deterministic demo run")
    .option("--out <dir>", "workspace directory for the demo run")
    .option("--scenario <scenario>", `scenario: ${DEMO_SCENARIOS.join(", ")}`, "success")
    .action(async (_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ out?: string; scenario: string }>();
      try {
        let scenario;
        try {
          scenario = parseDemoScenario(opts.scenario);
        } catch (err) {
          exitUser("E_INVALID_SCENARIO", err instanceof Error ? err.message : String(err), flags);
          return;
        }
        const result = await createDemoRun({
          outDir: opts.out ? resolveArg(opts.out, flags) : undefined,
          quiet: flags.quiet,
          jsonMode: flags.json,
          scenario,
        });
        if (flags.json) successJson(result);
        else {
          log(`agentbox demo replay: ${result.html}`, flags);
          log(`agentbox demo report: ${result.report}`, flags);
          log(`agentbox demo export: ${result.zip}`, flags);
        }
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("record")
    .description("record a terminal-based agent command")
    .argument("[command...]", "command to record after --")
    .option("--capture-input", "store typed input in terminal.cast")
    .option("--redact-pattern <regex>", "extra regex to redact from artifacts", collect, [])
    .allowUnknownOption(true)
    .action(async (command: string[], _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ captureInput?: boolean; redactPattern: string[] }>();
      try {
        if (command.length === 0) {
          exitUser("E_MISSING_COMMAND", "record requires a command after --", flags);
          return;
        }
        const run = await recordRun({
          cwd: resolveCwd(flags),
          command,
          captureInput: opts.captureInput,
          redactPatterns: opts.redactPattern,
          quiet: flags.quiet,
          jsonMode: flags.json,
        });
        const runDir = path.join(run.cwd, ".agentbox", "runs", run.id);
        if (flags.json) {
          successJson({ run, runDir, html: path.join(runDir, "agentbox-run.html") });
        } else {
          log(`\nagentbox replay: ${path.join(runDir, "agentbox-run.html")}`, flags);
        }
        process.exit(run.exitCode ?? OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("export")
    .description("export a redacted shareable zip for a run")
    .argument("<run>", "run id, prefix, directory, artifact path, or latest")
    .option("--out <zip>", "zip file to write")
    .option("--redact-pattern <regex>", "extra regex to redact from exported artifacts", collect, [])
    .action((target: string, _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ out?: string; redactPattern: string[] }>();
      try {
        const exported = exportRun({
          input: target,
          cwd: resolveCwd(flags),
          outPath: opts.out ? resolveArg(opts.out, flags) : undefined,
          redactPatterns: opts.redactPattern,
        });
        if (flags.json) successJson(exported);
        else log(`exported ${exported.zipPath}`, flags);
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("report")
    .description("create a Markdown report for a run")
    .argument("<run>", "run id, prefix, directory, artifact path, or latest")
    .option("--out <file>", "Markdown file to write")
    .option("--artifact-url <url>", "GitHub Actions artifact URL to include")
    .option("--zip <path>", "export zip path to include")
    .option("--title <text>", "report title")
    .option("--max-files <n>", "maximum changed files to include")
    .option("--max-risks <n>", "maximum risk flags to include")
    .action((target: string, _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{
        out?: string;
        artifactUrl?: string;
        zip?: string;
        title?: string;
        maxFiles?: string;
        maxRisks?: string;
      }>();
      try {
        const result = generateReport({
          input: target,
          cwd: resolveCwd(flags),
          outPath: opts.out ? resolveArg(opts.out, flags) : undefined,
          artifactUrl: opts.artifactUrl,
          zipPath: opts.zip ? resolveArg(opts.zip, flags) : undefined,
          title: opts.title,
          maxFiles: parseOptionalLimit("max-files", opts.maxFiles),
          maxRisks: parseOptionalLimit("max-risks", opts.maxRisks),
        });
        if (flags.json) successJson(result);
        else if (result.outPath) log(`wrote ${result.outPath}`, flags);
        else process.stdout.write(result.markdown);
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("list")
    .description("list local Agentbox runs")
    .option("--limit <n>", "maximum runs to list")
    .option("--status <status>", "status: all, passed, failed, risky, invalid", "all")
    .action((_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ limit?: string; status: string }>();
      try {
        const result = listRuns(resolveCwd(flags), {
          limit: parseOptionalLimit("limit", opts.limit),
          status: parseStatus(opts.status),
        });
        if (flags.json) successJson(result);
        else process.stdout.write(formatRunListHuman({
          cwd: resolveCwd(flags),
          limit: parseOptionalLimit("limit", opts.limit),
          status: parseStatus(opts.status),
        }));
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("library")
    .description("generate a local HTML index of Agentbox runs")
    .option("--out <file>", "HTML file to write")
    .option("--open", "open the generated library in a browser")
    .action((_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ out?: string; open?: boolean }>();
      try {
        const result = renderLibrary({
          cwd: resolveCwd(flags),
          outPath: opts.out ? resolveArg(opts.out, flags) : undefined,
        });
        if (opts.open) {
          const opened = openFile(result.htmlPath, "library");
          if (opened.warning) log(`warning: ${opened.warning}`, flags);
        }
        if (flags.json) successJson(result);
        else log(`library ${result.htmlPath}`, flags);
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("open")
    .description("open a run replay or the local run library")
    .argument("<run>", "run id, prefix, directory, artifact path, latest, or library")
    .action((target: string, _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      try {
        const result = openAgentboxTarget({ target, cwd: resolveCwd(flags) });
        if (flags.json) successJson(result);
        else {
          if (result.warning) log(`warning: ${result.warning}`, flags);
          log(`${result.opened ? "opened" : "path"} ${result.path}`, flags);
        }
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("compare")
    .description("compare two Agentbox runs")
    .argument("<base>", "base run id, prefix, directory, artifact path, or latest")
    .argument("<head>", "head run id, prefix, directory, artifact path, or latest")
    .option("--out <file>", "Markdown file to write")
    .option("--max-files <n>", "maximum changed files per section")
    .option("--max-risks <n>", "maximum risk flags per run")
    .action((base: string, head: string, _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ out?: string; maxFiles?: string; maxRisks?: string }>();
      try {
        const result = compareRuns({
          base,
          head,
          cwd: resolveCwd(flags),
          outPath: opts.out ? resolveArg(opts.out, flags) : undefined,
          maxFiles: parseOptionalLimit("max-files", opts.maxFiles),
          maxRisks: parseOptionalLimit("max-risks", opts.maxRisks),
        });
        if (flags.json) successJson(result);
        else if (result.outPath) log(`wrote ${result.outPath}`, flags);
        else process.stdout.write(result.markdown);
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("clean")
    .description("delete old Agentbox run directories")
    .option("--keep <n>", "preserve the newest n runs")
    .option("--before <duration>", "delete runs older than a duration such as 12h, 7d, or 4w")
    .option("--dry-run", "show selected runs without deleting")
    .option("--yes", "confirm deletion")
    .action((_opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ keep?: string; before?: string; dryRun?: boolean; yes?: boolean }>();
      try {
        const result = cleanRuns({
          cwd: resolveCwd(flags),
          keep: parseOptionalLimit("keep", opts.keep),
          before: opts.before,
          dryRun: opts.dryRun,
          yes: opts.yes,
        });
        if (flags.json) successJson(result);
        else {
          const verb = result.deleted ? "deleted" : "would delete";
          log(`${verb} ${result.runs.length} run(s), ${result.bytes} bytes`, flags);
          for (const run of result.runs) log(`  ${run.id} ${run.runDir}`, flags);
        }
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("render")
    .description("regenerate agentbox-run.html for a run directory")
    .argument("<run>", "run id, prefix, directory, artifact path, or latest")
    .action((target: string, _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      try {
        const html = renderRun(target, resolveCwd(flags));
        if (flags.json) successJson({ html });
        else log(`rendered ${html}`, flags);
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("inspect")
    .description("summarize a recorded run")
    .argument("<run>", "run id, prefix, directory, artifact path, or latest")
    .action((target: string, _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      try {
        const inspection = inspectRun(target, resolveCwd(flags));
        if (flags.json) successJson(inspection);
        else process.stdout.write(formatInspectionHuman(inspection));
        process.exit(OK);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("mcp-proxy")
    .description("wrap an MCP stdio server and log tools/list + tools/call")
    .requiredOption("--name <server>", "server name to use in logs")
    .option("--redact-pattern <regex>", "extra regex to redact from MCP logs", collect, [])
    .argument("[command...]", "MCP server command after --")
    .allowUnknownOption(true)
    .action(async (command: string[], _opts, cmd: Command) => {
      const flags = mergeFlags(cmd);
      const opts = cmd.opts<{ name: string; redactPattern: string[] }>();
      try {
        if (command.length === 0) {
          exitUser("E_MISSING_COMMAND", "mcp-proxy requires a server command after --", flags);
          return;
        }
        const code = await runMcpProxy({
          name: opts.name,
          command,
          cwd: resolveCwd(flags),
          redactPatterns: opts.redactPattern,
        });
        process.exit(code);
      } catch (err) {
        exitInternal(err, flags);
      }
    });

  program
    .command("help-agents")
    .description("print the machine-readable command catalog")
    .action(() => {
      process.stdout.write(JSON.stringify(agentCatalog(), null, 2) + "\n");
      process.exit(OK);
    });

  return program;
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseOptionalLimit(name: string, value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function parseStatus(value: string): RunStatusFilter {
  if (value === "all" || value === "passed" || value === "failed" || value === "risky" || value === "invalid") {
    return value;
  }
  throw new Error("status must be one of: all, passed, failed, risky, invalid");
}

function successJson(data: unknown): void {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
}

function errorJson(code: string, message: string, hint?: string): void {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { code, message, ...(hint ? { hint } : {}) } }) + "\n"
  );
}

function log(message: string, flags: GlobalFlags): void {
  if (flags.quiet) return;
  process.stderr.write(message + "\n");
}

function formatChanged(action: string, platform: string, changed: string[]): string {
  const lines = [`agentbox ${action} ${platform}`];
  if (changed.length === 0) lines.push("no changes");
  else lines.push(...changed.map((file) => `changed ${file}`));
  return lines.join("\n");
}

function exitUser(code: string, message: string, flags: GlobalFlags, hint?: string): void {
  if (flags.json) errorJson(code, message, hint);
  else process.stderr.write(`error: ${message}${hint ? `\n${hint}` : ""}\n`);
  process.exit(USER_ERROR);
}

function exitInternal(err: unknown, flags: GlobalFlags): never {
  const message = err instanceof Error ? err.message : String(err);
  if (flags.json) errorJson("E_INTERNAL", message);
  else process.stderr.write(`error: ${message}\n`);
  process.exit(INTERNAL_ERROR);
}

function mergeFlags(cmd: Command): GlobalFlags {
  let current: Command | null = cmd;
  const merged: Record<string, unknown> = {};
  while (current) {
    Object.assign(merged, current.opts());
    current = current.parent;
  }
  return merged as GlobalFlags;
}

function resolveCwd(flags: GlobalFlags): string {
  return flags.cwd ? path.resolve(flags.cwd) : process.cwd();
}

function resolveArg(input: string, flags: GlobalFlags): string {
  return path.isAbsolute(input) ? input : path.resolve(resolveCwd(flags), input);
}

function agentCatalog() {
  return {
    name: "agentbox",
    version: PKG_VERSION,
    description: "Local-first black box recorder for AI agent terminal runs.",
    jsonEnvelope: {
      success: { ok: true, data: {} },
      failure: { ok: false, error: { code: "E_CODE", message: "message", hint: "optional" } },
    },
    globalFlags: [
      { name: "--json", type: "boolean", description: "emit one-line JSON on stdout" },
      { name: "--quiet", type: "boolean", description: "suppress progress logs" },
      { name: "--verbose", type: "boolean", description: "extra logs on stderr" },
      { name: "--cwd", type: "path", description: "working directory for relative paths" },
      { name: "--no-color", type: "boolean", description: "disable color in agentbox stderr output" },
    ],
    commands: [
      {
        name: "install",
        description: "Install Agentbox instructions and hooks for a platform.",
        args: [],
        flags: [{ name: "--platform", type: "string", required: true }],
        returns: { platform: "string", action: "install", changed: "path[]" },
      },
      {
        name: "uninstall",
        description: "Remove Agentbox instructions and hooks for a platform.",
        args: [],
        flags: [{ name: "--platform", type: "string", required: true }],
        returns: { platform: "string", action: "uninstall", changed: "path[]" },
      },
      {
        name: "hook-log",
        description: "Record an agent hook payload into AGENTBOX_RUN_DIR/events.jsonl.",
        args: [],
        flags: [
          { name: "--platform", type: "string", required: true },
          { name: "--redact-pattern", type: "regex", repeatable: true },
        ],
        returns: { logged: "boolean", runDir: "path?", risks: "number", redactions: "RedactionReport" },
      },
      {
        name: "demo",
        description: "Create a deterministic demo workspace, replay, report, and export zip.",
        args: [],
        flags: [
          { name: "--out", type: "path" },
          { name: "--scenario", type: "enum", values: DEMO_SCENARIOS },
        ],
        returns: {
          scenario: "success|failure|mcp-risk",
          run: "RunMetadata",
          workspace: "path",
          runDir: "path",
          html: "path",
          report: "path",
          zip: "path",
        },
      },
      {
        name: "record",
        description: "Record a terminal-based agent command into .agentbox/runs/<run-id>.",
        args: [{ name: "command", required: true, type: "string[]" }],
        flags: [
          { name: "--capture-input", type: "boolean" },
          { name: "--redact-pattern", type: "regex", repeatable: true },
        ],
        returns: { run: "RunMetadata", runDir: "path", html: "path" },
      },
      {
        name: "export",
        description: "Export a redacted shareable zip for a run.",
        args: [{ name: "run", required: true, type: "id|prefix|path|latest" }],
        flags: [
          { name: "--out", type: "path" },
          { name: "--redact-pattern", type: "regex", repeatable: true },
        ],
        returns: { zipPath: "path", runId: "string", files: "string[]", redactions: "RedactionReport" },
      },
      {
        name: "report",
        description: "Create a Markdown report for a run.",
        args: [{ name: "run", required: true, type: "id|prefix|path|latest" }],
        flags: [
          { name: "--out", type: "path" },
          { name: "--artifact-url", type: "url" },
          { name: "--zip", type: "path" },
          { name: "--title", type: "string" },
          { name: "--max-files", type: "number" },
          { name: "--max-risks", type: "number" },
        ],
        returns: { summary: "ReportSummary", markdown: "string", outPath: "path?" },
      },
      {
        name: "list",
        description: "List local Agentbox runs.",
        args: [],
        flags: [
          { name: "--limit", type: "number" },
          { name: "--status", type: "enum", values: ["all", "passed", "failed", "risky", "invalid"] },
        ],
        returns: { runs: "RunListEntry[]", count: "number", invalidCount: "number" },
      },
      {
        name: "library",
        description: "Generate a local HTML index of Agentbox runs.",
        args: [],
        flags: [
          { name: "--out", type: "path" },
          { name: "--open", type: "boolean" },
        ],
        returns: { htmlPath: "path", runs: "RunListEntry[]", totals: "LibraryTotals" },
      },
      {
        name: "open",
        description: "Open a run replay or the local run library.",
        args: [{ name: "run", required: true, type: "id|prefix|path|latest|library" }],
        returns: { path: "path", target: "library|run", opened: "boolean", warning: "string?" },
      },
      {
        name: "compare",
        description: "Compare two Agentbox runs.",
        args: [
          { name: "base", required: true, type: "id|prefix|path|latest" },
          { name: "head", required: true, type: "id|prefix|path|latest" },
        ],
        flags: [
          { name: "--out", type: "path" },
          { name: "--max-files", type: "number" },
          { name: "--max-risks", type: "number" },
        ],
        returns: { summary: "CompareSummary", markdown: "string", outPath: "path?" },
      },
      {
        name: "clean",
        description: "Delete old Agentbox run directories.",
        args: [],
        flags: [
          { name: "--keep", type: "number" },
          { name: "--before", type: "duration" },
          { name: "--dry-run", type: "boolean" },
          { name: "--yes", type: "boolean" },
        ],
        returns: { deleted: "boolean", runs: "RunListEntry[]", bytes: "number" },
      },
      {
        name: "render",
        description: "Regenerate agentbox-run.html for a run.",
        args: [{ name: "run", required: true, type: "id|prefix|path|latest" }],
        returns: { html: "path" },
      },
      {
        name: "inspect",
        description: "Summarize a run.",
        args: [{ name: "run", required: true, type: "id|prefix|path|latest" }],
        returns: "RunInspection",
      },
      {
        name: "mcp-proxy",
        description: "Wrap an MCP stdio server and log tools/list and tools/call.",
        args: [{ name: "command", required: true, type: "string[]" }],
        flags: [
          { name: "--name", type: "string", required: true },
          { name: "--redact-pattern", type: "regex", repeatable: true },
        ],
        returns: "stdio JSON-RPC pass-through; logs to AGENTBOX_RUN_DIR/events.jsonl",
      },
    ],
  };
}

main();
