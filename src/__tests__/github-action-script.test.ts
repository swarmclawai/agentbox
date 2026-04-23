import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentbox-action-script-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("GitHub Action support script", () => {
  it("parses redaction patterns and builds record arguments", async () => {
    const script = await loadScript();

    expect(script.parseRedactPatterns("\nONE\n TWO \n\n")).toEqual(["ONE", "TWO"]);
    expect(script.resolveWorkingDirectory("subdir")).toBe(path.join(process.cwd(), "subdir"));
    expect(
      script.buildRecordArgs({
        AGENTBOX_COMMAND: "pnpm test",
        AGENTBOX_CAPTURE_INPUT: "true",
        AGENTBOX_REDACT_PATTERNS: "SECRET_[0-9]+\nTOKEN",
      })
    ).toEqual([
      "record",
      "--capture-input",
      "--redact-pattern",
      "SECRET_[0-9]+",
      "--redact-pattern",
      "TOKEN",
      "--",
      "bash",
      "-lc",
      "pnpm test",
    ]);
  });

  it("writes GitHub output keys with multiline values", async () => {
    const script = await loadScript();
    const outputPath = path.join(tmp, "github-output");

    script.writeGithubOutput(outputPath, {
      "exit-code": 0,
      markdown: "line one\nline two",
    });

    const output = fs.readFileSync(outputPath, "utf8");
    expect(output).toContain("exit-code=0");
    expect(output).toContain("markdown<<AGENTBOX_OUTPUT");
    expect(output).toContain("line two");
  });

  it("extracts pull request numbers and evaluates risk thresholds", async () => {
    const script = await loadScript();
    const eventPath = path.join(tmp, "event.json");
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 42 } }));

    expect(script.extractPullRequestNumber(eventPath)).toBe(42);
    expect(script.shouldFailForRisk({ highestRiskSeverity: "medium" }, "off")).toBe(false);
    expect(script.shouldFailForRisk({ highestRiskSeverity: "medium" }, "high")).toBe(false);
    expect(script.shouldFailForRisk({ highestRiskSeverity: "medium" }, "medium")).toBe(true);
    expect(script.shouldFailForRisk({ highestRiskSeverity: "medium" }, "low")).toBe(true);
  });
});

async function loadScript() {
  const scriptPath = path.join(process.cwd(), "scripts", "github-action.mjs");
  return import(`${pathToFileURL(scriptPath).href}?t=${Date.now()}`);
}
