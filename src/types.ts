export const SCHEMA_VERSION = 2;

export type Severity = "low" | "medium" | "high";

export interface RiskFlag {
  code: string;
  message: string;
  severity: Severity;
  source: string;
  sample?: string;
}

export interface RedactionMatch {
  name: string;
  count: number;
}

export interface RedactionReport {
  total: number;
  matches: RedactionMatch[];
}

export interface TerminalInfo {
  cols: number;
  rows: number;
  captureInput: boolean;
  env: Record<string, string>;
}

export interface ChangedFile {
  path: string;
  status: "created" | "modified" | "deleted";
  oldHash?: string;
  newHash?: string;
  oldSize?: number;
  newSize?: number;
  binary: boolean;
  oversized: boolean;
  diff?: string;
}

export interface FileSummary {
  mode: "git" | "none";
  root?: string;
  changed: number;
  files: ChangedFile[];
}

export interface McpSummary {
  calls: number;
  servers: string[];
  tools: string[];
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface RunMetadata {
  schemaVersion: number;
  id: string;
  command: string[];
  cwd: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  signal?: string | null;
  terminal: TerminalInfo;
  files: FileSummary;
  redactions: RedactionReport;
  mcp: McpSummary;
  risks: RiskFlag[];
}

export interface AgentboxEvent {
  type: "run" | "mcp" | "risk" | "file" | "note" | "tool";
  time: string;
  data: unknown;
}

export interface ToolLogEvent {
  platform: string;
  eventName?: string;
  toolName?: string;
  observedAt: string;
  inputSummary: unknown;
  risks: RiskFlag[];
  redactions: RedactionReport;
}

export interface McpLogEvent {
  server: string;
  method: string;
  requestId?: string | number;
  toolName?: string;
  requestAt: string;
  responseAt?: string;
  durationMs?: number;
  argumentsSummary?: unknown;
  resultSummary?: unknown;
  toolAnnotations?: ToolAnnotations;
  risks: RiskFlag[];
}
