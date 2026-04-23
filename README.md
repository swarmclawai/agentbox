# agentbox

**Black box footage for your AI agent.** `agentbox` records terminal-based agent runs into a local, self-contained replay with terminal output, file diffs, MCP tool calls, redactions, and risk flags.

[![npm version](https://img.shields.io/npm/v/@swarmclawai/agentbox.svg)](https://www.npmjs.com/package/@swarmclawai/agentbox)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/swarmclawai/agentbox/actions/workflows/ci.yml/badge.svg)](https://github.com/swarmclawai/agentbox/actions/workflows/ci.yml)

## Why this exists

Coding agents now touch terminals, files, tools, and MCP servers. When a run succeeds, fails, or does something surprising, the evidence is usually scattered across scrollback, Git diff, and tool logs.

`agentbox` keeps that evidence local and replayable. It does not ask you to send traces to a cloud service, adopt a framework, or change agents. Wrap the command you already run, then inspect what happened.

## 30-second demo

```bash
npx @swarmclawai/agentbox@latest demo
npx @swarmclawai/agentbox@latest demo --scenario failure
npx @swarmclawai/agentbox@latest demo --scenario mcp-risk
```

Each demo writes a replay, Markdown report, and redacted export zip:

```text
.agentbox/runs/<run-id>/agentbox-run.html
.agentbox/runs/<run-id>/REPORT.md
.agentbox/runs/<run-id>/agentbox-<run-id>.zip
```

The replay includes:

- terminal playback stored as asciicast v2
- file diffs from before/after the run
- MCP `tools/list` and `tools/call` events when using `agentbox mcp-proxy`
- conservative secret redaction
- risk flags for suspicious tool output

## Install

```bash
pnpm add -g @swarmclawai/agentbox
```

Or run without installing:

```bash
npx @swarmclawai/agentbox@latest record -- <agent command>
```

## Commands

| Command | Purpose |
|---|---|
| `agentbox demo --scenario success\|failure\|mcp-risk` | Create a deterministic replay, report, and export zip |
| `agentbox record -- <command...>` | Record a terminal-based agent run |
| `agentbox export <run\|latest>` | Create a redacted zip for sharing |
| `agentbox report <run\|latest>` | Create a Markdown report for local review or CI |
| `agentbox list` | List local runs with status filters |
| `agentbox library` | Generate a searchable local HTML run index |
| `agentbox open <run\|latest\|library>` | Open a replay or the local run library |
| `agentbox compare <base> <head>` | Compare two recorded runs |
| `agentbox clean` | Safely delete old run directories |
| `agentbox inspect <run>` | Summarize a recorded run |
| `agentbox render <run>` | Regenerate `agentbox-run.html` |
| `agentbox mcp-proxy --name <server> -- <server-command...>` | Log MCP stdio `tools/list` and `tools/call` |
| `agentbox install --platform <name>` | Install platform instructions and lightweight hooks |
| `agentbox --help-agents` | Print the machine-readable command catalog |

Every data-returning command supports `--json` and emits one JSON line on stdout.

## Recording an agent

```bash
agentbox record -- codex "add tests for the parser"
agentbox record -- claude "fix the failing build"
agentbox record -- goose run "summarize this repo"
```

By default, `agentbox` captures terminal output and resize events. It does not store typed input unless you explicitly pass:

```bash
agentbox record --capture-input -- <agent command>
```

## Sharing a run

Create a local, redacted zip from the latest run:

```bash
agentbox export latest
```

The zip includes `agentbox-run.html`, `run.json`, `terminal.cast`, `events.jsonl`, `diffs.json`, `SHARE.md`, and `manifest.json` with checksums. Review the bundle before posting it publicly.

Create a Markdown summary for the latest run:

```bash
agentbox report latest
agentbox report latest --out agentbox-report.md
```

Reports include the command, exit code, duration, changed files, MCP/tool counts, risk flags, redactions, local replay path, export zip path, and artifact URL when supplied.

## Managing runs

List recent runs:

```bash
agentbox list
agentbox list --status risky --limit 5
```

Open the latest replay or a searchable local library:

```bash
agentbox open latest
agentbox library --open
```

Compare two runs by id, unique prefix, path, or `latest`:

```bash
agentbox compare 20260423120000-a1b2 20260423123000-c3d4
agentbox compare 20260423120000-a1b2 latest --out agentbox-compare.md
```

Cleanups are conservative. Preview first, then confirm:

```bash
agentbox clean --keep 10 --dry-run
agentbox clean --keep 10 --yes
agentbox clean --before 30d --yes
```

## Agent integrations

Install lightweight instructions and hooks for your agent platform:

```bash
agentbox install --platform codex
agentbox claude install
agentbox opencode install
agentbox gemini install
```

Supported platforms mirror the SwarmVault/Graphify coverage: Claude Code, Codex, OpenCode, GitHub Copilot CLI, VS Code Copilot Chat, Aider, OpenClaw, Factory Droid, Trae, Trae CN, Cursor, Gemini CLI, Hermes, Kiro, Google Antigravity, and Windows Claude Code.

Hook-capable platforms log tool payload summaries into the active run when `AGENTBOX_RUN_DIR` is set. Platforms without hook support receive always-on project instructions that point users at `agentbox record`, `agentbox inspect latest`, and `agentbox export latest`.

## MCP logging

Wrap an MCP stdio server with `agentbox mcp-proxy` inside a recorded run. The proxy forwards JSON-RPC unchanged and logs only `tools/list` and `tools/call` summaries.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "agentbox",
      "args": [
        "mcp-proxy",
        "--name",
        "filesystem",
        "--",
        "npx",
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "."
      ]
    }
  }
}
```

Then run your agent through `agentbox record`. MCP events appear in the replay's MCP tab.

## Artifact layout

```text
.agentbox/runs/<run-id>/
  run.json
  terminal.cast
  events.jsonl
  diffs.json
  agentbox-run.html
```

The HTML replay is self-contained and can be opened locally without a dev server.

## GitHub Actions

Use the bundled action to preserve a replay for CI jobs and write an Agentbox report to the workflow summary:

```yaml
- uses: swarmclawai/agentbox@v0.4.1
  with:
    command: pnpm test
    artifact-name: agentbox-test-run
```

The action records the command, exports a redacted zip, uploads it with `actions/upload-artifact`, and preserves the recorded command's exit code after reporting.

PR comments are opt-in so default workflows do not need write-token permissions:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v5
  - uses: swarmclawai/agentbox@v0.4.1
    with:
      command: pnpm test
      comment-pr: "true"
```

Risk gates are also opt-in:

```yaml
- uses: swarmclawai/agentbox@v0.4.1
  with:
    command: pnpm test
    fail-on-risk: high
```

Use `fail-on-risk: medium` or `fail-on-risk: low` for stricter gates. Set newline-separated `redact-patterns` to apply custom redaction during recording and export.

## Redaction

`agentbox` redacts common API key and token patterns before writing artifacts. Add your own patterns with:

```bash
agentbox record --redact-pattern 'MY_SECRET_[A-Z0-9]+' -- <agent command>
```

Redaction is a safety net, not a guarantee. Review artifacts before sharing them publicly.

## How it compares

| | agentbox | LLM observability SaaS | asciinema |
|---|---:|---:|---:|
| Works with any terminal agent | Yes | Usually no | Yes |
| Local-first HTML artifact | Yes | Usually no | Partial |
| Captures file diffs | Yes | Usually no | No |
| Captures MCP tool calls | Yes | Sometimes | No |
| Requires app/framework instrumentation | No | Often | No |

## Development

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```

## License

MIT
