---
"@weerachai06/agent-gate": minor
---

Add OpenCode support. OpenCode has no command hooks, so the package ships a plugin (`opencode/agent-gate.js`) that calls `agent-gate hook --agent opencode`. It guards edits to the files that control the checks, saves the session baseline, and sends the agent back when Stop fails. The guard also protects `opencode.json(c)` and `.opencode/plugin(s)/`.
