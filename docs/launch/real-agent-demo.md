# Real Agent Demo Checklist

Use this for the polished launch GIF/video.

1. Create a small throwaway repo with one failing test.
2. Run:

```bash
agentbox record -- <agent command that fixes the test>
```

3. Open `.agentbox/runs/<run-id>/agentbox-run.html`.
4. Capture:
   - Terminal replay at the moment the agent runs tests.
   - Files tab showing the fix.
   - MCP tab if a proxied MCP server was used.
   - Risks tab showing no flags for the successful run.
5. Review the artifact manually before sharing.
