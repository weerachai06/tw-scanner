---
"@weerachai06/agent-gate": patch
---

Fix Stop hook loop. With a session baseline, only files changed since the session started are checked, not the whole branch. When Claude Code sends `stop_hook_active`, a block becomes a warning so the agent is not blocked again.
