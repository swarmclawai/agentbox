import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectRun } from "../inspect.js";
import { recordRun } from "../recorder.js";

let tmp: string;
const fixture = path.resolve("fixtures", "fake-agent.js");

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-record-"));
  execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
  fs.writeFileSync(path.join(tmp, "fixture-input.txt"), "initial\n");
  execFileSync("git", ["add", "fixture-input.txt"], { cwd: tmp, stdio: "ignore" });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("recordRun", () => {
  it("records terminal output, file diffs, redactions, and replay html", async () => {
    const run = await recordRun({
      cwd: tmp,
      command: [process.execPath, fixture],
      quiet: true,
    });

    const runDir = path.join(tmp, ".agentbox", "runs", run.id);
    const inspection = inspectRun(runDir);
    const cast = fs.readFileSync(path.join(runDir, "terminal.cast"), "utf8");
    const html = fs.readFileSync(path.join(runDir, "agentbox-run.html"), "utf8");

    expect(run.exitCode).toBe(0);
    expect(fs.existsSync(path.join(runDir, "run.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "events.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "diffs.json"))).toBe(true);
    expect(cast).toContain('"version":2');
    expect(cast).toContain("[REDACTED:openai_key]");
    expect(cast).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(html).toContain("AsciinemaPlayer.create");
    expect(inspection.files.files.map((file) => file.path)).toContain("fixture-output.txt");
    expect(inspection.files.files.map((file) => file.path)).toContain("fixture-input.txt");
    expect(inspection.redactionCount).toBeGreaterThan(0);
  });
});
