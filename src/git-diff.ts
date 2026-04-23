import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ChangedFile, FileSummary } from "./types.js";

const DEFAULT_MAX_TEXT_BYTES = 256 * 1024;

interface FileRecord {
  path: string;
  exists: boolean;
  hash?: string;
  size?: number;
  binary: boolean;
  oversized: boolean;
  text?: string;
}

export interface WorkspaceSnapshot {
  mode: "git" | "none";
  root?: string;
  files: Map<string, FileRecord>;
}

export interface SnapshotOptions {
  maxTextBytes?: number;
}

export function snapshotWorkspace(
  cwd: string,
  options: SnapshotOptions = {}
): WorkspaceSnapshot {
  const root = findGitRoot(cwd);
  if (!root) return { mode: "none", files: new Map() };

  const maxTextBytes = options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;
  const files = new Map<string, FileRecord>();
  for (const relPath of listGitVisibleFiles(root)) {
    if (shouldSkip(relPath)) continue;
    files.set(relPath, readFileRecord(root, relPath, maxTextBytes));
  }

  return { mode: "git", root, files };
}

export function diffSnapshots(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot
): FileSummary {
  if (before.mode !== "git" || after.mode !== "git") {
    return { mode: "none", changed: 0, files: [] };
  }

  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  const files: ChangedFile[] = [];

  for (const relPath of [...paths].sort()) {
    const oldFile = before.files.get(relPath);
    const newFile = after.files.get(relPath);
    const oldExists = oldFile?.exists ?? false;
    const newExists = newFile?.exists ?? false;

    if (!oldExists && !newExists) continue;
    if (oldFile?.hash && newFile?.hash && oldFile.hash === newFile.hash) continue;

    const status: ChangedFile["status"] = !oldExists
      ? "created"
      : !newExists
        ? "deleted"
        : "modified";
    const binary = Boolean(oldFile?.binary || newFile?.binary);
    const oversized = Boolean(oldFile?.oversized || newFile?.oversized);
    const changed: ChangedFile = {
      path: relPath,
      status,
      oldHash: oldFile?.hash,
      newHash: newFile?.hash,
      oldSize: oldFile?.size,
      newSize: newFile?.size,
      binary,
      oversized,
    };

    if (!binary && !oversized) {
      changed.diff = makeUnifiedDiff(
        relPath,
        oldFile?.text ?? "",
        newFile?.text ?? "",
        status
      );
    }

    files.push(changed);
  }

  return {
    mode: "git",
    root: after.root ?? before.root,
    changed: files.length,
    files,
  };
}

function findGitRoot(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function listGitVisibleFiles(root: string): string[] {
  const out = execFileSync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" }
  );
  return out.split("\0").filter(Boolean).map(toPosixPath);
}

function readFileRecord(root: string, relPath: string, maxTextBytes: number): FileRecord {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    return { path: relPath, exists: false, binary: false, oversized: false };
  }
  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    return { path: relPath, exists: false, binary: false, oversized: false };
  }
  const buf = fs.readFileSync(abs);
  const binary = isBinary(buf);
  const oversized = buf.byteLength > maxTextBytes;
  return {
    path: relPath,
    exists: true,
    hash: crypto.createHash("sha256").update(buf).digest("hex"),
    size: buf.byteLength,
    binary,
    oversized,
    text: !binary && !oversized ? buf.toString("utf8") : undefined,
  };
}

function isBinary(buf: Buffer): boolean {
  if (buf.includes(0)) return true;
  if (buf.byteLength === 0) return false;
  let suspicious = 0;
  const sample = buf.subarray(0, Math.min(buf.byteLength, 8192));
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.byteLength > 0.1;
}

function shouldSkip(relPath: string): boolean {
  const normalized = toPosixPath(relPath);
  return (
    normalized === ".agentbox" ||
    normalized.startsWith(".agentbox/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  );
}

function makeUnifiedDiff(
  relPath: string,
  before: string,
  after: string,
  status: ChangedFile["status"]
): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const lines = [`--- a/${relPath}`, `+++ b/${relPath}`, `@@ ${status} @@`];

  if (status === "created") {
    for (const line of afterLines) lines.push(`+${line}`);
    return lines.join("\n") + "\n";
  }
  if (status === "deleted") {
    for (const line of beforeLines) lines.push(`-${line}`);
    return lines.join("\n") + "\n";
  }

  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i += 1) {
    const oldLine = beforeLines[i];
    const newLine = afterLines[i];
    if (oldLine === newLine && oldLine !== undefined) {
      lines.push(` ${oldLine}`);
    } else {
      if (oldLine !== undefined) lines.push(`-${oldLine}`);
      if (newLine !== undefined) lines.push(`+${newLine}`);
    }
  }
  return lines.join("\n") + "\n";
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\n$/, "").split(/\r?\n/);
}

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}
