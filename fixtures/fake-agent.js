#!/usr/bin/env node
import fs from "node:fs";

console.log("agentbox fixture starting");
console.log("secret sk-abcdefghijklmnopqrstuvwxyz should be redacted");
fs.writeFileSync("fixture-output.txt", "created by fake agent\n");
if (fs.existsSync("fixture-input.txt")) {
  fs.appendFileSync("fixture-input.txt", "updated\n");
}
setTimeout(() => {
  console.log("agentbox fixture done");
}, 20);
