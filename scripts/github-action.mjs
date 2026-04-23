#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const DEFAULT_PACKAGE = "@swarmclawai/agentbox@latest";
const DEFAULT_ARTIFACT = "agentbox-run";
const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

export function parseRedactPatterns(value = "") {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatGithubOutput(values) {
  let output = "";
  for (const [key, raw] of Object.entries(values)) {
    const value = raw == null ? "" : String(raw);
    if (value.includes("\n")) {
      const delimiter = chooseDelimiter(value);
      output += `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
    } else {
      output += `${key}=${value}\n`;
    }
  }
  return output;
}

export function writeGithubOutput(outputFile, values) {
  if (!outputFile) return;
  fs.appendFileSync(outputFile, formatGithubOutput(values));
}

export function shouldFailForRisk(summary, threshold) {
  if (!threshold || threshold === "off") return false;
  const minimum = SEVERITY_RANK[threshold];
  const highest = summary?.highestRiskSeverity;
  if (!minimum || !highest) return false;
  return SEVERITY_RANK[highest] >= minimum;
}

export function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function extractPullRequestNumber(eventPath) {
  if (!eventPath || !fs.existsSync(eventPath)) return undefined;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const number = event.pull_request?.number ?? event.number;
    return Number.isInteger(number) ? number : undefined;
  } catch {
    return undefined;
  }
}

export function buildRecordArgs(env) {
  const command = env.AGENTBOX_COMMAND;
  if (!command?.trim()) throw new Error("missing required command input");
  const args = ["record"];
  if (parseBoolean(env.AGENTBOX_CAPTURE_INPUT)) args.push("--capture-input");
  for (const pattern of parseRedactPatterns(env.AGENTBOX_REDACT_PATTERNS)) {
    args.push("--redact-pattern", pattern);
  }
  args.push("--", "bash", "-lc", command);
  return args;
}

export function buildExportArgs(zipPath, env) {
  const args = ["export", "latest", "--out", zipPath];
  for (const pattern of parseRedactPatterns(env.AGENTBOX_REDACT_PATTERNS)) {
    args.push("--redact-pattern", pattern);
  }
  return args;
}

export function buildReportArgs(env) {
  const args = ["--json", "report", "latest", "--title", env.AGENTBOX_REPORT_TITLE || "Agentbox CI Report"];
  if (env.AGENTBOX_ARTIFACT_URL) args.push("--artifact-url", env.AGENTBOX_ARTIFACT_URL);
  if (env.AGENTBOX_ZIP_PATH) args.push("--zip", env.AGENTBOX_ZIP_PATH);
  return args;
}

export function sanitizeArtifactName(value = DEFAULT_ARTIFACT) {
  const cleaned = String(value).trim().replace(/[^A-Za-z0-9_.-]+/g, "-");
  return cleaned || DEFAULT_ARTIFACT;
}

export function parseJsonEnvelope(stdout) {
  const line = String(stdout)
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith("{"));
  if (!line) return undefined;
  const parsed = JSON.parse(line);
  if (parsed?.ok !== true) return undefined;
  return parsed.data;
}

export function resolveWorkingDirectory(value = "") {
  return path.resolve(value || process.cwd());
}

async function recordMode(env) {
  const cwd = resolveWorkingDirectory(env.AGENTBOX_WORKING_DIRECTORY);
  const packageSpec = env.AGENTBOX_PACKAGE || DEFAULT_PACKAGE;
  const tempDir = env.RUNNER_TEMP || os.tmpdir();
  const zipPath =
    env.AGENTBOX_ZIP_PATH || path.join(tempDir, `${sanitizeArtifactName(env.AGENTBOX_ARTIFACT_NAME)}.zip`);

  const record = runAgentbox(packageSpec, buildRecordArgs(env), { cwd, stdio: "inherit" });
  const exitCode = normalizeStatus(record.status);
  let exported = false;
  let inspection;

  const exportRun = runAgentbox(packageSpec, buildExportArgs(zipPath, env), { cwd, stdio: "inherit" });
  exported = exportRun.status === 0 && fs.existsSync(zipPath);

  const inspectRun = runAgentbox(packageSpec, ["--json", "inspect", "latest"], {
    cwd,
    stdio: "pipe",
  });
  if (inspectRun.status === 0) inspection = parseJsonEnvelope(inspectRun.stdout);

  writeGithubOutput(env.GITHUB_OUTPUT, {
    "exit-code": exitCode,
    "run-id": inspection?.run?.id ?? "",
    "html-path": inspection?.artifactPaths?.html ?? "",
    "zip-path": exported ? zipPath : "",
    "risk-count": inspection?.riskCount ?? "",
  });
}

async function publishMode(env) {
  const cwd = resolveWorkingDirectory(env.AGENTBOX_WORKING_DIRECTORY);
  const packageSpec = env.AGENTBOX_PACKAGE || DEFAULT_PACKAGE;
  const report = runAgentbox(packageSpec, buildReportArgs(env), { cwd, stdio: "pipe" });
  let summary;
  let markdown = "";

  if (report.status === 0) {
    const data = parseJsonEnvelope(report.stdout);
    summary = data?.summary;
    markdown = data?.markdown || "";
  } else {
    warning(`Unable to generate Agentbox report: ${report.stderr || report.stdout}`);
  }

  if (markdown && parseBoolean(env.AGENTBOX_SUMMARY, true) && env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  }

  if (markdown && parseBoolean(env.AGENTBOX_COMMENT_PR, false)) {
    commentOnPullRequest(markdown, env);
  }

  const threshold = env.AGENTBOX_FAIL_ON_RISK || "off";
  const riskGateFailed = shouldFailForRisk(summary, threshold);
  writeGithubOutput(env.GITHUB_OUTPUT, {
    "risk-gate-failed": riskGateFailed ? "true" : "false",
    "risk-count": summary?.riskCount ?? "",
    "highest-risk-severity": summary?.highestRiskSeverity ?? "",
  });
}

function commentOnPullRequest(markdown, env) {
  const prNumber = extractPullRequestNumber(env.GITHUB_EVENT_PATH);
  if (!prNumber) {
    warning("comment-pr is enabled, but this workflow event does not include a pull request number.");
    return;
  }
  const tempFile = path.join(env.RUNNER_TEMP || os.tmpdir(), "agentbox-pr-comment.md");
  fs.writeFileSync(tempFile, markdown);
  const result = spawnSync("gh", ["pr", "comment", String(prNumber), "--body-file", tempFile, "--edit-last", "--create-if-none"], {
    cwd: resolveWorkingDirectory(env.AGENTBOX_WORKING_DIRECTORY),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GH_TOKEN: env.GH_TOKEN || env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "",
    },
  });
  if (result.status !== 0) warning(`Unable to update Agentbox PR comment: ${result.stderr || result.stdout}`);
}

function runAgentbox(packageSpec, args, options) {
  return spawnSync("npx", ["-y", "--package", packageSpec, "agentbox", ...args], {
    encoding: options.stdio === "pipe" ? "utf8" : undefined,
    ...options,
  });
}

function normalizeStatus(status) {
  return Number.isInteger(status) ? status : 1;
}

function chooseDelimiter(value) {
  let index = 0;
  let delimiter = "AGENTBOX_OUTPUT";
  while (value.includes(delimiter)) {
    index += 1;
    delimiter = `AGENTBOX_OUTPUT_${index}`;
  }
  return delimiter;
}

function warning(message) {
  process.stderr.write(`::warning::${String(message).trim()}\n`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "record") await recordMode(process.env);
  else if (mode === "publish") await publishMode(process.env);
  else throw new Error("usage: github-action.mjs <record|publish>");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    process.stderr.write(`::error::${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
