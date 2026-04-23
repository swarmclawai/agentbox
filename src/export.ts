import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { zipSync, strToU8 } from "fflate";
import { resolveExistingRunPath } from "./artifact.js";
import { buildRedactionRules, mergeRedactionReports, redactText } from "./redaction.js";
import type { RedactionReport, RunMetadata } from "./types.js";

const TEXT_ARTIFACTS = ["agentbox-run.html", "run.json", "terminal.cast", "events.jsonl", "diffs.json"] as const;

export interface ExportRunOptions {
  input: string;
  cwd?: string;
  outPath?: string;
  redactPatterns?: string[];
}

export interface ExportRunResult {
  zipPath: string;
  runId: string;
  files: string[];
  redactions: RedactionReport;
}

export interface ExportManifest {
  schemaVersion: 1;
  exportedAt: string;
  runId: string;
  sourceRunDir: string;
  files: Record<string, { bytes: number; sha256: string }>;
  redactions: RedactionReport;
}

export function exportRun(options: ExportRunOptions): ExportRunResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const paths = resolveExistingRunPath(options.input, cwd);
  const run = JSON.parse(fs.readFileSync(paths.runJson, "utf8")) as RunMetadata;
  const rules = buildRedactionRules(options.redactPatterns);
  let redactions: RedactionReport = { total: 0, matches: [] };
  const archiveFiles: Record<string, Uint8Array> = {};

  for (const name of TEXT_ARTIFACTS) {
    const source = path.join(paths.runDir, name);
    if (!fs.existsSync(source)) continue;
    const redacted = redactText(fs.readFileSync(source, "utf8"), rules);
    redactions = mergeRedactionReports(redactions, redacted.report);
    archiveFiles[name] = strToU8(redacted.text);
  }

  if (archiveFiles["agentbox-run.html"] && archiveFiles["terminal.cast"]) {
    archiveFiles["agentbox-run.html"] = strToU8(
      replaceEmbeddedCast(
        Buffer.from(archiveFiles["agentbox-run.html"]).toString("utf8"),
        Buffer.from(archiveFiles["terminal.cast"]).toString("utf8")
      )
    );
  }

  archiveFiles["SHARE.md"] = strToU8(shareMarkdown(run));
  const manifest = createManifest(run.id, paths.runDir, archiveFiles, redactions);
  archiveFiles["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2) + "\n");

  const zipPath = path.resolve(options.outPath ?? path.join(paths.runDir, `agentbox-${run.id}.zip`));
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.from(zipSync(archiveFiles, { level: 9 })));
  return {
    zipPath,
    runId: run.id,
    files: Object.keys(archiveFiles).sort(),
    redactions,
  };
}

function replaceEmbeddedCast(html: string, cast: string): string {
  const castDataUrl = `data:text/plain;base64,${Buffer.from(cast, "utf8").toString("base64")}`;
  return html.replace(
    /window\.__AGENTBOX_CAST_URL__\s*=\s*"data:text\/plain;base64,[^"]*";/,
    `window.__AGENTBOX_CAST_URL__ = ${JSON.stringify(castDataUrl)};`
  );
}

function shareMarkdown(run: RunMetadata): string {
  return `# Agentbox Run ${run.id}

This bundle was exported by Agentbox for local review and sharing.

- Command: \`${run.command.join(" ")}\`
- Exit code: ${run.exitCode ?? "unknown"}
- Duration: ${run.durationMs ?? 0}ms
- Files changed: ${run.files.changed}
- MCP calls: ${run.mcp.calls}
- Risk flags: ${run.risks.length}
- Redactions: ${run.redactions.total}

Open \`agentbox-run.html\` in a browser to replay the run.
Review all artifacts before posting them publicly.
`;
}

function createManifest(
  runId: string,
  sourceRunDir: string,
  files: Record<string, Uint8Array>,
  redactions: RedactionReport
): ExportManifest {
  const manifestFiles: ExportManifest["files"] = {};
  for (const [name, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    manifestFiles[name] = {
      bytes: bytes.byteLength,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  }
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    runId,
    sourceRunDir,
    files: manifestFiles,
    redactions,
  };
}
