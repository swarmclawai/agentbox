export interface AsciicastHeaderOptions {
  cols: number;
  rows: number;
  timestamp: number;
  command: string;
  env: Record<string, string>;
}

export function asciicastHeader(options: AsciicastHeaderOptions): string {
  return (
    JSON.stringify({
      version: 2,
      width: options.cols,
      height: options.rows,
      timestamp: options.timestamp,
      command: options.command,
      env: options.env,
    }) + "\n"
  );
}

export function asciicastEvent(
  elapsedSeconds: number,
  code: "o" | "i" | "m" | "r",
  data: string
): string {
  return JSON.stringify([roundTime(elapsedSeconds), code, data]) + "\n";
}

function roundTime(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1_000_000) / 1_000_000);
}
