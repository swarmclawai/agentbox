import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { appendEvent, createRunId, ensureRunDir, resolveRunPaths, writeRunMetadata } from "./artifact.js";
import { buildRedactionRules, mergeRedactionReports, redactText, type RedactionRule } from "./redaction.js";
import { detectRisks } from "./risk.js";
import {
  SCHEMA_VERSION,
  type McpLogEvent,
  type RedactionReport,
  type RiskFlag,
  type RunMetadata,
  type ToolAnnotations,
} from "./types.js";

interface PendingMcpRequest {
  server: string;
  method: string;
  id: string | number;
  requestAt: string;
  startMs: number;
  toolName?: string;
  argumentsSummary?: unknown;
}

export interface McpProxyLoggerOptions {
  server: string;
  append: (event: McpLogEvent) => void;
  redactionRules?: RedactionRule[];
}

export class McpProxyLogger {
  private readonly pending = new Map<string, PendingMcpRequest>();
  private readonly tools = new Map<string, ToolAnnotations>();
  private redactions: RedactionReport = { total: 0, matches: [] };
  private readonly rules: RedactionRule[];

  constructor(private readonly opts: McpProxyLoggerOptions) {
    this.rules = opts.redactionRules ?? buildRedactionRules();
  }

  get redactionReport(): RedactionReport {
    return this.redactions;
  }

  observeClientMessage(message: unknown): void {
    if (!isObject(message)) return;
    const method = typeof message.method === "string" ? message.method : undefined;
    if (method !== "tools/list" && method !== "tools/call") return;
    const id = message.id;
    if (typeof id !== "string" && typeof id !== "number") return;
    const params = isObject(message.params) ? message.params : {};
    const toolName =
      method === "tools/call" && typeof params.name === "string" ? params.name : undefined;
    this.pending.set(String(id), {
      server: this.opts.server,
      method,
      id,
      requestAt: new Date().toISOString(),
      startMs: Date.now(),
      toolName,
      argumentsSummary:
        method === "tools/call" ? this.summarize(params.arguments ?? {}) : undefined,
    });
  }

  observeServerMessage(message: unknown): McpLogEvent | undefined {
    if (!isObject(message)) return undefined;
    const id = message.id;
    if (typeof id !== "string" && typeof id !== "number") return undefined;
    const pending = this.pending.get(String(id));
    if (!pending) return undefined;
    this.pending.delete(String(id));

    const resultSummary = this.summarize(message.result ?? message.error ?? {});
    if (pending.method === "tools/list") this.cacheToolAnnotations(resultSummary);
    const riskText = JSON.stringify(resultSummary);
    const annotations = pending.toolName ? this.tools.get(pending.toolName) : undefined;
    const risks = [
      ...detectRisks(riskText, `mcp:${pending.server}:${pending.method}`),
      ...detectToolRisks(pending.server, pending.toolName, annotations),
    ];
    const event: McpLogEvent = {
      server: pending.server,
      method: pending.method,
      requestId: pending.id,
      toolName: pending.toolName ?? toolNameFromListResult(message.result),
      requestAt: pending.requestAt,
      responseAt: new Date().toISOString(),
      durationMs: Date.now() - pending.startMs,
      argumentsSummary: pending.argumentsSummary,
      resultSummary,
      toolAnnotations: annotations,
      risks,
    };
    this.opts.append(event);
    return event;
  }

  private summarize(value: unknown): unknown {
    const text = JSON.stringify(value, null, 2);
    const redacted = redactText(text.length > 8000 ? `${text.slice(0, 8000)}...` : text, this.rules);
    this.redactions = mergeRedactionReports(this.redactions, redacted.report);
    try {
      return JSON.parse(redacted.text);
    } catch {
      return redacted.text;
    }
  }

  private cacheToolAnnotations(value: unknown): void {
    if (!isObject(value) || !Array.isArray(value.tools)) return;
    for (const tool of value.tools) {
      if (!isObject(tool) || typeof tool.name !== "string") continue;
      const annotations = isObject(tool.annotations) ? readToolAnnotations(tool.annotations) : {};
      this.tools.set(tool.name, annotations);
    }
  }
}

export interface RunMcpProxyOptions {
  name: string;
  command: string[];
  cwd: string;
  redactPatterns?: string[];
}

export async function runMcpProxy(options: RunMcpProxyOptions): Promise<number> {
  if (options.command.length === 0) throw new Error("missing MCP server command");
  const cwd = path.resolve(options.cwd);
  const logPaths = resolveMcpRunPaths(cwd, options);
  const logger = new McpProxyLogger({
    server: options.name,
    redactionRules: buildRedactionRules(options.redactPatterns),
    append: (event) => {
      appendEvent(logPaths, { type: "mcp", time: event.responseAt ?? new Date().toISOString(), data: event });
      for (const risk of event.risks) {
        appendEvent(logPaths, { type: "risk", time: new Date().toISOString(), data: risk });
      }
    },
  });

  return await new Promise<number>((resolve) => {
    const child = spawn(options.command[0]!, options.command.slice(1), {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let clientBuffer = "";
    let serverBuffer = "";

    process.stdin.on("data", (chunk: Buffer) => {
      child.stdin.write(chunk);
      clientBuffer = consumeJsonLines(clientBuffer + chunk.toString("utf8"), (message) =>
        logger.observeClientMessage(message)
      );
    });

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      serverBuffer = consumeJsonLines(serverBuffer + chunk.toString("utf8"), (message) =>
        logger.observeServerMessage(message)
      );
    });

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    process.stdin.on("end", () => {
      child.stdin.end();
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}

function consumeJsonLines(buffer: string, onMessage: (message: unknown) => void): string {
  const parts = buffer.split(/\r?\n/);
  const rest = parts.pop() ?? "";
  for (const line of parts) {
    if (!line.trim()) continue;
    try {
      onMessage(JSON.parse(line));
    } catch {
      // MCP peers should send valid JSON-RPC lines. Forwarding still happened,
      // so logging simply skips malformed diagnostic fragments.
    }
  }
  return rest;
}

function resolveMcpRunPaths(cwd: string, options: RunMcpProxyOptions) {
  if (process.env.AGENTBOX_RUN_DIR) {
    const runDir = process.env.AGENTBOX_RUN_DIR;
    fs.mkdirSync(runDir, { recursive: true });
    return {
      runDir,
      eventsJsonl: path.join(runDir, "events.jsonl"),
    };
  }

  const runId = `mcp-${createRunId()}`;
  const paths = resolveRunPaths(cwd, runId);
  ensureRunDir(paths);
  fs.writeFileSync(paths.eventsJsonl, "");
  fs.writeFileSync(paths.terminalCast, '{"version":2,"width":80,"height":24}\n');
  const metadata: RunMetadata = {
    schemaVersion: SCHEMA_VERSION,
    id: runId,
    command: ["agentbox", "mcp-proxy", "--name", options.name, "--", ...options.command],
    cwd,
    startedAt: new Date().toISOString(),
    terminal: {
      cols: 80,
      rows: 24,
      captureInput: false,
      env: {
        SHELL: process.env.SHELL || "",
        TERM: process.env.TERM || "",
      },
    },
    files: { mode: "none", changed: 0, files: [] },
    redactions: { total: 0, matches: [] },
    mcp: { calls: 0, servers: [options.name], tools: [] },
    risks: [],
  };
  writeRunMetadata(paths, metadata);
  process.stderr.write(`agentbox mcp-proxy logging to ${paths.runDir}\n`);
  return paths;
}

function toolNameFromListResult(result: unknown): string | undefined {
  if (!isObject(result) || !Array.isArray(result.tools)) return undefined;
  return `${result.tools.length} tools`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readToolAnnotations(value: Record<string, unknown>): ToolAnnotations {
  return {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.readOnlyHint === "boolean" ? { readOnlyHint: value.readOnlyHint } : {}),
    ...(typeof value.destructiveHint === "boolean" ? { destructiveHint: value.destructiveHint } : {}),
    ...(typeof value.idempotentHint === "boolean" ? { idempotentHint: value.idempotentHint } : {}),
    ...(typeof value.openWorldHint === "boolean" ? { openWorldHint: value.openWorldHint } : {}),
  };
}

function detectToolRisks(
  server: string,
  toolName: string | undefined,
  annotations: ToolAnnotations | undefined
): RiskFlag[] {
  if (!toolName) return [];
  const source = `mcp:${server}:tools/call:${toolName}`;
  if (!annotations) {
    return [
      {
        code: "mcp_tool_unannotated",
        severity: "low",
        message: "MCP tool call had no cached tool annotations; review behavior manually.",
        source,
      },
    ];
  }
  const risks: RiskFlag[] = [];
  if (annotations.destructiveHint === true && annotations.readOnlyHint !== true) {
    risks.push({
      code: "mcp_tool_destructive",
      severity: "medium",
      message: "MCP tool is annotated as potentially destructive; annotations are untrusted hints.",
      source,
    });
  }
  if (annotations.openWorldHint === true) {
    risks.push({
      code: "mcp_tool_open_world",
      severity: "medium",
      message: "MCP tool is annotated as interacting with external entities; annotations are untrusted hints.",
      source,
    });
  }
  return risks;
}
