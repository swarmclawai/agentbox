import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { appendEvent } from "./artifact.js";
import { buildRedactionRules, redactText } from "./redaction.js";
import { detectRisks } from "./risk.js";
import type { RedactionReport, ToolLogEvent } from "./types.js";

export interface HookLogOptions {
  platform: string;
  input: unknown;
  env?: Record<string, string | undefined>;
  redactPatterns?: string[];
}

export interface HookLogResult {
  logged: boolean;
  runDir?: string;
  risks: number;
  redactions: RedactionReport;
}

export async function readStdinJson(): Promise<unknown> {
  const input = await new Promise<string>((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    if (process.stdin.isTTY) resolve("");
  });
  if (!input.trim()) return {};
  return JSON.parse(input);
}

export async function logHookEvent(options: HookLogOptions): Promise<HookLogResult> {
  const env = options.env ?? process.env;
  const runDir = env.AGENTBOX_RUN_DIR;
  const redacted = redactHookInput(options.input, options.redactPatterns);
  const event = buildToolEvent(options.platform, redacted.value, redacted.report);

  if (!runDir) {
    return { logged: false, risks: event.risks.length, redactions: redacted.report };
  }

  fs.mkdirSync(runDir, { recursive: true });
  const paths = { eventsJsonl: path.join(runDir, "events.jsonl") };
  appendEvent(paths, { type: "tool", time: event.observedAt, data: event });
  for (const risk of event.risks) {
    appendEvent(paths, { type: "risk", time: event.observedAt, data: risk });
  }
  return {
    logged: true,
    runDir,
    risks: event.risks.length,
    redactions: redacted.report,
  };
}

function redactHookInput(
  input: unknown,
  redactPatterns?: string[]
): { value: unknown; report: RedactionReport } {
  const text = JSON.stringify(input ?? {}, null, 2);
  const redacted = redactText(text.length > 12000 ? `${text.slice(0, 12000)}...` : text, buildRedactionRules(redactPatterns));
  try {
    return { value: JSON.parse(redacted.text), report: redacted.report };
  } catch {
    return { value: redacted.text, report: redacted.report };
  }
}

function buildToolEvent(platform: string, input: unknown, redactions: RedactionReport): ToolLogEvent {
  const object = isObject(input) ? input : {};
  const eventName = stringField(object, "hook_event_name") ?? stringField(object, "event");
  const toolName =
    stringField(object, "tool_name") ??
    stringField(object, "tool") ??
    (isObject(object.tool_input) ? stringField(object.tool_input, "name") : undefined);
  const observedAt = new Date().toISOString();
  const risks = detectRisks(JSON.stringify(input), `hook:${platform}:${toolName ?? eventName ?? "unknown"}`);
  return {
    platform,
    eventName,
    toolName,
    observedAt,
    inputSummary: input,
    risks,
    redactions,
  };
}

function stringField(object: Record<string, unknown>, key: string): string | undefined {
  return typeof object[key] === "string" ? object[key] : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
