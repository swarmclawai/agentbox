# Launch Drafts

## Positioning

Black box footage for your AI agent.

`agentbox` records terminal-based agent runs and gives you local replays with terminal playback, file diffs, MCP calls, redactions, risk flags, and a searchable run library.

## Hacker News

Title:

```text
Show HN: Agentbox – replay what your AI coding agent actually did
```

Post:

```text
I built Agentbox, a local-first recorder for terminal-based AI agent runs.

You run:

  agentbox demo --scenario mcp-risk
  agentbox record -- <agent command>
  agentbox library --open

It writes self-contained HTML replays with terminal output, file diffs, MCP tool calls, redactions, risk flags, Markdown reports, and redacted export zips. The terminal recording is asciicast v2, and everything stays local by default.

The motivation: agents are getting access to terminals, files, browsers, and MCP tools, but debugging a surprising run still feels like reconstructing a story from scrollback and Git diff.
```

## X / LinkedIn

```text
New OSS project: Agentbox.

Black box footage for your AI agent.

agentbox record -- <agent command>
agentbox demo --scenario failure
agentbox library --open

You get local HTML replays with:
- terminal playback
- file diffs
- MCP tool calls
- redactions
- risk flags
- reports and shareable export zips
- searchable run history

No cloud trace service. No framework instrumentation.
```

## Reddit

```text
I built a local-first recorder for terminal AI agents.

It wraps the command you already run and outputs self-contained replays: terminal session, files changed, MCP tools called, redactions, suspicious-output flags, and a searchable local run library.

Would love feedback from people running Claude Code, Codex, Goose, Cursor agents, or MCP-heavy setups.
```
