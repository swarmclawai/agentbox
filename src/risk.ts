import type { RiskFlag, Severity } from "./types.js";

interface RiskRule {
  code: string;
  severity: Severity;
  message: string;
  pattern: RegExp;
}

const RISK_RULES: RiskRule[] = [
  {
    code: "credential_request",
    severity: "high",
    message: "Output appears to request secrets or credentials.",
    pattern:
      /\b(api key|secret key|password|token|credential|ssh key|private key)\b/i,
  },
  {
    code: "exfiltration_url",
    severity: "high",
    message: "Output appears to instruct sending sensitive data to an external URL.",
    pattern:
      /\b(send|submit|upload|post|exfiltrate).{0,80}https?:\/\/[^\s"')]+/i,
  },
  {
    code: "system_prompt_override",
    severity: "medium",
    message: "Output contains prompt-injection language about overriding instructions.",
    pattern:
      /\b(ignore|override|bypass|forget).{0,60}\b(previous|system|developer|safety|instruction)s?\b/i,
  },
  {
    code: "hidden_instruction",
    severity: "medium",
    message: "Output contains directive-like language that may be untrusted tool content.",
    pattern: /\b(system|compliance|security|mandatory)\s+directive\b/i,
  },
  {
    code: "destructive_command",
    severity: "medium",
    message: "Output references a destructive shell command.",
    pattern: /\b(rm\s+-rf|mkfs|dd\s+if=|chmod\s+-R\s+777|sudo\s+rm)\b/i,
  },
];

export function detectRisks(text: string, source: string): RiskFlag[] {
  const risks: RiskFlag[] = [];
  for (const rule of RISK_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    risks.push({
      code: rule.code,
      message: rule.message,
      severity: rule.severity,
      source,
      sample: trimSample(match[0]),
    });
  }
  return risks;
}

function trimSample(sample: string): string {
  return sample.replace(/\s+/g, " ").slice(0, 160);
}
