# Contributing

Thanks for helping improve `agentbox`.

## Setup

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```

## Development Principles

- Keep artifacts local-first.
- Keep CLI output predictable for agents and scripts.
- Prefer small, testable changes.
- Add tests for recorder, redaction, diff, render, and MCP proxy behavior.
- Do not introduce network uploads without an explicit opt-in design.

## Pull Requests

Before opening a PR, run:

```bash
pnpm run build
pnpm run typecheck
pnpm run test
```

Include a short description of the behavior change and the verification you ran.
