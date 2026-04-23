import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { listRuns, type RunListEntry } from "./artifact.js";

export interface CleanRunsOptions {
  cwd?: string;
  keep?: number;
  before?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export interface CleanRunsResult {
  deleted: boolean;
  runs: RunListEntry[];
  bytes: number;
}

export function cleanRuns(options: CleanRunsOptions = {}): CleanRunsResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const hasKeep = options.keep != null;
  const hasBefore = options.before != null && options.before.trim().length > 0;
  if (!hasKeep && !hasBefore) throw new Error("clean requires at least one cleanup criterion: --keep or --before");
  if (!options.dryRun && !options.yes) throw new Error("clean refuses to delete without --yes");
  if (options.keep != null && (!Number.isInteger(options.keep) || options.keep < 0)) {
    throw new Error("--keep must be a non-negative integer");
  }

  const runs = listRuns(cwd).runs;
  const keepSet = new Set((options.keep == null ? [] : runs.slice(0, options.keep)).map((run) => run.runDir));
  const cutoff = hasBefore ? Date.now() - parseDurationMs(options.before!) : undefined;
  const selected = runs.filter((run) => {
    if (keepSet.has(run.runDir)) return false;
    if (cutoff != null) return Date.parse(run.updatedAt) < cutoff;
    return hasKeep;
  });
  const bytes = selected.reduce((total, run) => total + directorySize(run.runDir), 0);

  if (!options.dryRun) {
    for (const run of selected) {
      fs.rmSync(run.runDir, { recursive: true, force: true });
    }
  }

  return {
    deleted: !options.dryRun,
    runs: selected,
    bytes,
  };
}

export function parseDurationMs(input: string): number {
  const match = input.trim().match(/^(\d+)([hdw])$/i);
  if (!match) throw new Error("--before must be a duration like 12h, 7d, or 4w");
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const hour = 60 * 60 * 1000;
  if (unit === "h") return value * hour;
  if (unit === "d") return value * 24 * hour;
  return value * 7 * 24 * hour;
}

function directorySize(input: string): number {
  if (!fs.existsSync(input)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const fullPath = path.join(input, entry.name);
    if (entry.isDirectory()) total += directorySize(fullPath);
    else if (entry.isFile()) total += fs.statSync(fullPath).size;
  }
  return total;
}
