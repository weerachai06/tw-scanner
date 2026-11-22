---
"@weerachai06/agent-gate": patch
---

Stop now checks only uncommitted files (working tree against `HEAD`, plus untracked), so old commits on the branch never block the agent. The `base` option is removed from the schema and ignored if still in `agent-gate.json`.
