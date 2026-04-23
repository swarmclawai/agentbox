# Agent Instructions

## Project

`agentbox` is a TypeScript Node CLI published as `@swarmclawai/agentbox`.

## Commands

Use these checks before considering work complete:

```bash
pnpm run build
pnpm run typecheck
pnpm run test
```

## CLI Conventions

- stdout is data only.
- stderr is logs, progress, and warnings.
- Every data-returning command supports `--json`.
- JSON output is exactly one line:

```json
{"ok": true, "data": {}}
```

or:

```json
{"ok": false, "error": {"code": "E_CODE", "message": "message"}}
```

- `agentbox --help-agents` must stay machine-readable.
- Commands must not prompt interactively unless a future explicit `--interactive` flag is added.

## Safety

- Never write secrets into fixtures, docs, tests, or snapshots.
- Preserve local-first behavior; do not add cloud uploads by default.
- Do not publish npm packages, create GitHub repos, or post launch materials without explicit user confirmation.

## Commit Rules

- Never mention Codex, Anthropic, or any AI assistant in commit messages, Co-Authored-By lines, or PR descriptions.
