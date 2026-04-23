import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const PLATFORMS = [
  "claude",
  "codex",
  "opencode",
  "copilot",
  "vscode",
  "aider",
  "claw",
  "droid",
  "trae",
  "trae-cn",
  "cursor",
  "gemini",
  "hermes",
  "kiro",
  "antigravity",
  "windows",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface PlatformInstallOptions {
  platform: string;
  projectDir?: string;
  homeDir?: string;
}

export interface PlatformInstallResult {
  platform: Platform;
  action: "install" | "uninstall";
  changed: string[];
}

const AGENTBOX_SECTION = `## agentbox

This project can record AI agent runs with Agentbox.

Rules:
- For important agent work, prefer wrapping the command with \`agentbox record -- <command>\`.
- After a surprising or failed run, inspect the latest replay with \`agentbox inspect latest\`.
- Before sharing a replay, run \`agentbox export latest\` and review the generated zip.
`;

const SKILL = `---
name: agentbox
description: Record, inspect, and export local black box replays for AI agent terminal runs.
---

# agentbox

Use \`agentbox record -- <command>\` to record terminal-based agent work.
Use \`agentbox inspect latest\` to summarize the most recent run.
Use \`agentbox export latest\` to create a redacted zip before sharing.
`;

const OPENCODE_PLUGIN = `// agentbox OpenCode plugin
import { spawnSync } from "child_process";

export const AgentboxPlugin = async () => ({
  "tool.execute.before": async (input) => {
    spawnSync("agentbox", ["hook-log", "--platform", "opencode"], {
      input: JSON.stringify(input),
      stdio: ["pipe", "ignore", "ignore"],
    });
  },
});
`;

export function installPlatform(options: PlatformInstallOptions): PlatformInstallResult {
  const platform = parsePlatform(options.platform);
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const changed: string[] = [];

  installSkill(platform, homeDir, changed);

  if (platform === "claude" || platform === "windows") {
    upsertSection(path.join(projectDir, "CLAUDE.md"), AGENTBOX_SECTION, changed);
    upsertClaudeHook(projectDir, changed);
  } else if (platform === "gemini") {
    upsertSection(path.join(projectDir, "GEMINI.md"), AGENTBOX_SECTION, changed);
    upsertGeminiHook(projectDir, changed);
  } else if (platform === "cursor") {
    writeFileIfChanged(path.join(projectDir, ".cursor", "rules", "agentbox.mdc"), cursorRule(), changed);
  } else if (platform === "vscode") {
    upsertSection(path.join(projectDir, ".github", "copilot-instructions.md"), AGENTBOX_SECTION, changed);
  } else if (platform === "kiro") {
    writeFileIfChanged(path.join(projectDir, ".kiro", "skills", "agentbox", "SKILL.md"), SKILL, changed);
    writeFileIfChanged(path.join(projectDir, ".kiro", "steering", "agentbox.md"), kiroSteering(), changed);
  } else if (platform === "antigravity") {
    writeFileIfChanged(path.join(projectDir, ".agent", "rules", "agentbox.md"), AGENTBOX_SECTION, changed);
    writeFileIfChanged(path.join(projectDir, ".agent", "workflows", "agentbox.md"), antigravityWorkflow(), changed);
  } else {
    upsertSection(path.join(projectDir, "AGENTS.md"), AGENTBOX_SECTION, changed);
  }

  if (platform === "codex") upsertCodexHook(projectDir, changed);
  if (platform === "opencode") upsertOpenCodePlugin(projectDir, changed);

  return { platform, action: "install", changed };
}

export function uninstallPlatform(options: PlatformInstallOptions): PlatformInstallResult {
  const platform = parsePlatform(options.platform);
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const changed: string[] = [];

  removeSkill(platform, homeDir, changed);

  for (const file of [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    path.join(".github", "copilot-instructions.md"),
  ]) {
    removeSection(path.join(projectDir, file), changed);
  }
  for (const file of [
    path.join(".cursor", "rules", "agentbox.mdc"),
    path.join(".kiro", "skills", "agentbox", "SKILL.md"),
    path.join(".kiro", "steering", "agentbox.md"),
    path.join(".agent", "rules", "agentbox.md"),
    path.join(".agent", "workflows", "agentbox.md"),
  ]) {
    removeFile(path.join(projectDir, file), changed);
  }
  removeCodexHook(projectDir, changed);
  removeClaudeHook(projectDir, changed);
  removeGeminiHook(projectDir, changed);
  removeOpenCodePlugin(projectDir, changed);

  return { platform, action: "uninstall", changed };
}

function parsePlatform(platform: string): Platform {
  if ((PLATFORMS as readonly string[]).includes(platform)) return platform as Platform;
  throw new Error(`unknown platform '${platform}'. Choose from: ${PLATFORMS.join(", ")}`);
}

function installSkill(platform: Platform, homeDir: string, changed: string[]): void {
  const rel = skillPath(platform);
  if (!rel) return;
  writeFileIfChanged(path.join(homeDir, rel), SKILL, changed);
}

function removeSkill(platform: Platform, homeDir: string, changed: string[]): void {
  const rel = skillPath(platform);
  if (!rel) return;
  removeFile(path.join(homeDir, rel), changed);
}

function skillPath(platform: Platform): string | undefined {
  const byPlatform: Partial<Record<Platform, string>> = {
    claude: path.join(".claude", "skills", "agentbox", "SKILL.md"),
    windows: path.join(".claude", "skills", "agentbox", "SKILL.md"),
    codex: path.join(".agents", "skills", "agentbox", "SKILL.md"),
    opencode: path.join(".config", "opencode", "skills", "agentbox", "SKILL.md"),
    copilot: path.join(".copilot", "skills", "agentbox", "SKILL.md"),
    aider: path.join(".aider", "agentbox", "SKILL.md"),
    claw: path.join(".openclaw", "skills", "agentbox", "SKILL.md"),
    droid: path.join(".factory", "skills", "agentbox", "SKILL.md"),
    trae: path.join(".trae", "skills", "agentbox", "SKILL.md"),
    "trae-cn": path.join(".trae-cn", "skills", "agentbox", "SKILL.md"),
    gemini: path.join(".gemini", "skills", "agentbox", "SKILL.md"),
    hermes: path.join(".hermes", "skills", "agentbox", "SKILL.md"),
    antigravity: path.join(".agent", "skills", "agentbox", "SKILL.md"),
  };
  return byPlatform[platform];
}

function upsertSection(file: string, section: string, changed: string[]): void {
  const marker = "## agentbox";
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (existing.includes(marker)) return;
  const next = existing.trim() ? `${existing.trimEnd()}\n\n${section}` : section;
  writeFileIfChanged(file, next, changed);
}

function removeSection(file: string, changed: string[]): void {
  if (!fs.existsSync(file)) return;
  const existing = fs.readFileSync(file, "utf8");
  if (!existing.includes("## agentbox")) return;
  const next = existing.replace(/(?:\n|^)## agentbox\n[\s\S]*?(?=\n## |\n# |$)/, "").trim();
  if (next) writeFileIfChanged(file, `${next}\n`, changed);
  else removeFile(file, changed);
}

function upsertClaudeHook(projectDir: string, changed: string[]): void {
  upsertHookArray(
    path.join(projectDir, ".claude", "settings.json"),
    ["hooks", "PreToolUse"],
    { matcher: "*", hooks: [{ type: "command", command: "agentbox hook-log --platform claude" }] },
    changed
  );
}

function removeClaudeHook(projectDir: string, changed: string[]): void {
  removeHookArrayEntry(path.join(projectDir, ".claude", "settings.json"), ["hooks", "PreToolUse"], changed);
}

function upsertCodexHook(projectDir: string, changed: string[]): void {
  upsertHookArray(
    path.join(projectDir, ".codex", "hooks.json"),
    ["hooks", "PreToolUse"],
    { matcher: "Bash", hooks: [{ type: "command", command: "agentbox hook-log --platform codex" }] },
    changed
  );
}

function removeCodexHook(projectDir: string, changed: string[]): void {
  removeHookArrayEntry(path.join(projectDir, ".codex", "hooks.json"), ["hooks", "PreToolUse"], changed);
}

function upsertGeminiHook(projectDir: string, changed: string[]): void {
  upsertHookArray(
    path.join(projectDir, ".gemini", "settings.json"),
    ["hooks", "BeforeTool"],
    { matcher: "*", hooks: [{ type: "command", command: "agentbox hook-log --platform gemini" }] },
    changed
  );
}

function removeGeminiHook(projectDir: string, changed: string[]): void {
  removeHookArrayEntry(path.join(projectDir, ".gemini", "settings.json"), ["hooks", "BeforeTool"], changed);
}

function upsertOpenCodePlugin(projectDir: string, changed: string[]): void {
  const pluginPath = path.join(projectDir, ".opencode", "plugins", "agentbox.js");
  writeFileIfChanged(pluginPath, OPENCODE_PLUGIN, changed);
  const configPath = path.join(projectDir, "opencode.json");
  const config = readJsonObject(configPath);
  const plugins = Array.isArray(config.plugin) ? config.plugin.filter((value) => typeof value === "string") : [];
  if (!plugins.includes(".opencode/plugins/agentbox.js")) plugins.push(".opencode/plugins/agentbox.js");
  config.plugin = plugins;
  writeJsonIfChanged(configPath, config, changed);
}

function removeOpenCodePlugin(projectDir: string, changed: string[]): void {
  removeFile(path.join(projectDir, ".opencode", "plugins", "agentbox.js"), changed);
  const configPath = path.join(projectDir, "opencode.json");
  if (!fs.existsSync(configPath)) return;
  const config = readJsonObject(configPath);
  const plugins = Array.isArray(config.plugin) ? config.plugin.filter((value) => typeof value === "string") : [];
  const nextPlugins = plugins.filter((entry) => entry !== ".opencode/plugins/agentbox.js");
  if (nextPlugins.length > 0) config.plugin = nextPlugins;
  else delete config.plugin;
  writeJsonIfChanged(configPath, config, changed);
}

function upsertHookArray(file: string, keys: [string, string], entry: unknown, changed: string[]): void {
  const config = readJsonObject(file);
  const parent = getObject(config, keys[0]);
  const raw = parent[keys[1]];
  const current: unknown[] = Array.isArray(raw) ? raw : [];
  parent[keys[1]] = [...current.filter((item) => !JSON.stringify(item).includes("agentbox hook-log")), entry];
  writeJsonIfChanged(file, config, changed);
}

function removeHookArrayEntry(file: string, keys: [string, string], changed: string[]): void {
  if (!fs.existsSync(file)) return;
  const config = readJsonObject(file);
  const parent = getObject(config, keys[0]);
  const raw = parent[keys[1]];
  if (!Array.isArray(raw)) return;
  const current: unknown[] = raw;
  parent[keys[1]] = current.filter((item) => !JSON.stringify(item).includes("agentbox hook-log"));
  writeJsonIfChanged(file, config, changed);
}

function getObject(config: Record<string, unknown>, key: string): Record<string, unknown> {
  if (typeof config[key] !== "object" || config[key] === null || Array.isArray(config[key])) config[key] = {};
  return config[key] as Record<string, unknown>;
}

function readJsonObject(file: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonIfChanged(file: string, value: unknown, changed: string[]): void {
  writeFileIfChanged(file, JSON.stringify(value, null, 2) + "\n", changed);
}

function writeFileIfChanged(file: string, content: string, changed: string[]): void {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  changed.push(file);
}

function removeFile(file: string, changed: string[]): void {
  if (!fs.existsSync(file)) return;
  fs.rmSync(file, { force: true });
  changed.push(file);
}

function cursorRule(): string {
  return `---
description: agentbox recorder
alwaysApply: true
---

${AGENTBOX_SECTION}`;
}

function kiroSteering(): string {
  return `---
inclusion: always
---

${AGENTBOX_SECTION}`;
}

function antigravityWorkflow(): string {
  return `# Workflow: agentbox

Use \`agentbox record -- <agent command>\` to capture important terminal agent work.
Use \`agentbox export latest\` before sharing a replay.
`;
}
