#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

console.log("agentbox fixture: running deterministic failing checks");
fs.writeFileSync(
  path.join(cwd, "fixture-failure-report.txt"),
  "expected: launch checklist passes\nactual: missing replay export\n"
);
console.error("FAIL launch-check exports replay zip");
console.error("redaction check sk-abcdefghijklmnopqrstuvwxyz");
process.exit(1);
