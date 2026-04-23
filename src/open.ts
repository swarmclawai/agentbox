import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { renderLibrary } from "./library.js";
import { renderRun } from "./render.js";

export interface OpenCommand {
  command: string;
  args: string[];
}

export interface OpenAgentboxTargetOptions {
  target: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  launch?: (command: string, args: string[]) => { status: number | null; error?: Error };
}

export interface OpenAgentboxTargetResult {
  path: string;
  target: "library" | "run";
  opened: boolean;
  warning?: string;
}

export function openAgentboxTarget(options: OpenAgentboxTargetOptions): OpenAgentboxTargetResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const targetPath = options.target === "library" ? renderLibrary({ cwd }).htmlPath : renderRun(options.target, cwd);
  const targetKind = options.target === "library" ? "library" : "run";
  return openFile(targetPath, targetKind, options);
}

export function openFile(
  targetPath: string,
  targetKind: "library" | "run",
  options: Omit<OpenAgentboxTargetOptions, "target" | "cwd"> = {}
): OpenAgentboxTargetResult {
  const env = options.env ?? process.env;
  const platform = options.platform ?? os.platform();
  if (env.CI) {
    return {
      path: targetPath,
      target: targetKind,
      opened: false,
      warning: "CI environment detected; not launching a browser.",
    };
  }

  const openCommand = getOpenCommand(platform, targetPath);
  const launch = options.launch ?? defaultLaunch;
  const result = launch(openCommand.command, openCommand.args);
  if (result.status === 0) return { path: targetPath, target: targetKind, opened: true };
  return {
    path: targetPath,
    target: targetKind,
    opened: false,
    warning: result.error?.message || `opener exited with status ${result.status ?? "unknown"}`,
  };
}

export function getOpenCommand(platform: NodeJS.Platform, targetPath: string): OpenCommand {
  if (platform === "darwin") return { command: "open", args: [targetPath] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", targetPath] };
  return { command: "xdg-open", args: [targetPath] };
}

function defaultLaunch(command: string, args: string[]): { status: number | null; error?: Error } {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return { status: result.status, ...(result.error ? { error: result.error } : {}) };
}
