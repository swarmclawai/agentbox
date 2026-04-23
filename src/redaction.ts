import type { RedactionReport } from "./types.js";

export interface RedactionRule {
  name: string;
  pattern: RegExp;
}

export interface RedactionResult {
  text: string;
  report: RedactionReport;
}

export const DEFAULT_REDACTION_RULES: RedactionRule[] = [
  { name: "openai_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: "npm_token", pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  { name: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: "private_key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    name: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
  },
  {
    name: "connection_string",
    pattern:
      /\b(?:postgres|postgresql|mysql|mongodb):\/\/[^\s:@]+:[^\s@]+@[^\s]+/gi,
  },
];

export function buildRedactionRules(customPatterns: string[] = []): RedactionRule[] {
  const custom = customPatterns.map((pattern, index) => ({
    name: `custom_${index + 1}`,
    pattern: new RegExp(pattern, "g"),
  }));
  return [...DEFAULT_REDACTION_RULES, ...custom];
}

export function emptyRedactionReport(): RedactionReport {
  return { total: 0, matches: [] };
}

export function mergeRedactionReports(
  ...reports: RedactionReport[]
): RedactionReport {
  const counts = new Map<string, number>();
  for (const report of reports) {
    for (const match of report.matches) {
      counts.set(match.name, (counts.get(match.name) ?? 0) + match.count);
    }
  }
  const matches = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((match) => match.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    total: matches.reduce((sum, match) => sum + match.count, 0),
    matches,
  };
}

export function redactText(
  input: string,
  rules: RedactionRule[] = DEFAULT_REDACTION_RULES
): RedactionResult {
  let text = input;
  const matches: RedactionReport["matches"] = [];

  for (const rule of rules) {
    let count = 0;
    text = text.replace(rule.pattern, () => {
      count += 1;
      return `[REDACTED:${rule.name}]`;
    });
    if (count > 0) matches.push({ name: rule.name, count });
  }

  return {
    text,
    report: {
      total: matches.reduce((sum, match) => sum + match.count, 0),
      matches,
    },
  };
}
