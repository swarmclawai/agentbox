import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEvents, resolveRunPaths } from "../artifact.js";
import { logHookEvent } from "../hook-log.js";
import { installPlatform, uninstallPlatform } from "../install.js";
import { McpProxyLogger } from "../mcp-proxy.js";
import type { McpLogEvent } from "../types.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-install-hook-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("platform install", () => {
  it("installs and uninstalls Codex instructions idempotently while preserving existing AGENTS.md", () => {
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# Existing\n\nDo not break things.\n");

    installPlatform({ platform: "codex", projectDir: tmp, homeDir: tmp });
    installPlatform({ platform: "codex", projectDir: tmp, homeDir: tmp });

    const agents = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    expect(agents).toContain("Do not break things.");
    expect(agents.match(/## agentbox/g)).toHaveLength(1);
    expect(fs.existsSync(path.join(tmp, ".codex", "hooks.json"))).toBe(true);

    uninstallPlatform({ platform: "codex", projectDir: tmp, homeDir: tmp });
    const cleaned = fs.readFileSync(path.join(tmp, "AGENTS.md"), "utf8");
    expect(cleaned).toContain("Do not break things.");
    expect(cleaned).not.toContain("## agentbox");
  });

  it("merges OpenCode plugin registration without dropping existing config", () => {
    fs.writeFileSync(path.join(tmp, "opencode.json"), JSON.stringify({ model: "test-model", plugin: [] }));

    installPlatform({ platform: "opencode", projectDir: tmp, homeDir: tmp });

    const plugin = path.join(tmp, ".opencode", "plugins", "agentbox.js");
    const config = JSON.parse(fs.readFileSync(path.join(tmp, "opencode.json"), "utf8"));
    expect(fs.readFileSync(plugin, "utf8")).toContain("tool.execute.before");
    expect(config.model).toBe("test-model");
    expect(config.plugin).toContain(".opencode/plugins/agentbox.js");
  });

  it("writes Claude and Gemini hook config files", () => {
    installPlatform({ platform: "claude", projectDir: tmp, homeDir: tmp });
    installPlatform({ platform: "gemini", projectDir: tmp, homeDir: tmp });

    expect(fs.readFileSync(path.join(tmp, ".claude", "settings.json"), "utf8")).toContain(
      "agentbox hook-log"
    );
    expect(fs.readFileSync(path.join(tmp, ".gemini", "settings.json"), "utf8")).toContain(
      "agentbox hook-log"
    );
  });
});

describe("hook-log", () => {
  it("no-ops when AGENTBOX_RUN_DIR is not set", async () => {
    const result = await logHookEvent({
      platform: "claude",
      input: { hook_event_name: "PreToolUse", tool_name: "Bash" },
      env: {},
    });

    expect(result.logged).toBe(false);
  });

  it("writes redacted tool events and risk events inside a run", async () => {
    const paths = resolveRunPaths(tmp, "run-hook-test");
    fs.mkdirSync(paths.runDir, { recursive: true });
    fs.writeFileSync(paths.eventsJsonl, "");

    const result = await logHookEvent({
      platform: "claude",
      input: {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo sk-abcdefghijklmnopqrstuvwxyz && rm -rf /tmp/nope" },
      },
      env: { AGENTBOX_RUN_DIR: paths.runDir },
    });

    const events = readEvents(paths.eventsJsonl);
    expect(result.logged).toBe(true);
    expect(events.map((event) => event.type)).toContain("tool");
    expect(events.map((event) => event.type)).toContain("risk");
    expect(JSON.stringify(events)).toContain("[REDACTED:openai_key]");
    expect(JSON.stringify(events)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
});

describe("MCP annotations", () => {
  it("caches tool annotations and labels risky tool calls", () => {
    const events: McpLogEvent[] = [];
    const logger = new McpProxyLogger({
      server: "fake",
      append: (event) => events.push(event),
    });

    logger.observeClientMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    logger.observeServerMessage({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          {
            name: "delete_file",
            annotations: { destructiveHint: true, openWorldHint: true },
          },
        ],
      },
    });
    logger.observeClientMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "delete_file", arguments: { path: "README.md" } },
    });
    logger.observeServerMessage({ jsonrpc: "2.0", id: 2, result: { content: [] } });

    const call = events.find((event) => event.method === "tools/call");
    expect(call?.toolAnnotations).toEqual({ destructiveHint: true, openWorldHint: true });
    expect(call?.risks.map((risk) => risk.code)).toContain("mcp_tool_destructive");
    expect(call?.risks.map((risk) => risk.code)).toContain("mcp_tool_open_world");
  });
});
