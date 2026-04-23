#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

console.log("agentbox fixture: reading fixture-input.txt");
const input = fs.readFileSync(path.join(cwd, "fixture-input.txt"), "utf8").trim();
fs.writeFileSync(path.join(cwd, "fixture-output.txt"), `processed: ${input}\n`);
fs.appendFileSync(path.join(cwd, "fixture-input.txt"), "agentbox fixture success\n");
console.log("wrote fixture-output.txt");
console.log("redaction check sk-abcdefghijklmnopqrstuvwxyz");
