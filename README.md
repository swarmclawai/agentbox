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
npx @swarmclawai/agentbox@latest record -- node fixtures/fake-agent.js
```

Open the generated file:

```text
.agentbox/runs/<run-id>/agentbox-run.html
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
| `agentbox record -- <command...>` | Record a terminal-based agent run |
| `agentbox inspect <run>` | Summarize a recorded run |
| `agentbox render <run>` | Regenerate `agentbox-run.html` |
| `agentbox mcp-proxy --name <server> -- <server-command...>` | Log MCP stdio `tools/list` and `tools/call` |
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
