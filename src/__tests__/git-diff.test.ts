import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffSnapshots, snapshotWorkspace } from "../git-diff.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-git-"));
  execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
  fs.writeFileSync(path.join(tmp, ".gitignore"), "ignored.txt\n");
  fs.writeFileSync(path.join(tmp, "tracked.txt"), "before\n");
  fs.writeFileSync(path.join(tmp, "binary.dat"), Buffer.from([0, 1, 2, 3, 0]));
  execFileSync("git", ["add", ".gitignore", "tracked.txt", "binary.dat"], {
    cwd: tmp,
    stdio: "ignore",
  });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("git snapshots", () => {
  it("summarizes created, modified, deleted, and binary files", () => {
    const before = snapshotWorkspace(tmp);

    fs.writeFileSync(path.join(tmp, "tracked.txt"), "after\n");
    fs.writeFileSync(path.join(tmp, "created.txt"), "new\n");
    fs.rmSync(path.join(tmp, "binary.dat"));
    fs.writeFileSync(path.join(tmp, "ignored.txt"), "ignore me\n");
    fs.mkdirSync(path.join(tmp, ".agentbox", "runs"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".agentbox", "runs", "x.txt"), "skip\n");

    const after = snapshotWorkspace(tmp);
    const summary = diffSnapshots(before, after);

    expect(summary.mode).toBe("git");
    expect(summary.changed).toBe(3);
    expect(summary.files.map((file) => [file.path, file.status])).toEqual([
      ["binary.dat", "deleted"],
      ["created.txt", "created"],
      ["tracked.txt", "modified"],
    ]);
    expect(summary.files.find((file) => file.path === "tracked.txt")?.diff).toContain(
      "-before"
    );
    expect(summary.files.find((file) => file.path === "binary.dat")?.binary).toBe(true);
  });

  it("returns mode none outside a git repo", () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-non-git-"));
    try {
      expect(snapshotWorkspace(nonGit)).toEqual({ mode: "none", files: new Map() });
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });
});
