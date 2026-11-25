# @weerachai06/agent-gate

## 0.2.1

### Patch Changes

- a806935: Add OpenCode to the package description, so the npm page lists all three supported agents.

## 0.2.0

### Minor Changes

- 0b02dc3: Add OpenCode support. OpenCode has no command hooks, so the package ships a plugin (`opencode/agent-gate.js`) that calls `agent-gate hook --agent opencode`. It guards edits to the files that control the checks, saves the session baseline, and sends the agent back when Stop fails. The guard also protects `opencode.json(c)` and `.opencode/plugin(s)/`.

## 0.1.3

### Patch Changes

- 307efb1: Stop now checks only uncommitted files (working tree against `HEAD`, plus untracked), so old commits on the branch never block the agent. The `base` option is removed from the schema and ignored if still in `agent-gate.json`.

## 0.1.2

### Patch Changes

- 9444dee: Fix Stop hook loop. With a session baseline, only files changed since the session started are checked, not the whole branch. When Claude Code sends `stop_hook_active`, a block becomes a warning so the agent is not blocked again. Without that flag (Kiro), the same block is also downgraded when it repeats, using the session baseline.

## 0.1.1

### Patch Changes

- 7a6edaa: Add a Date hint and use `npx --yes` in the README commands.

## 0.1.0

### Minor Changes

- 44fa3a7: First release. Runs architecture rules (`forbidImports`, `forbidImportNames`, `forbidGlobals`) and project commands from Claude Code and kiro-cli (V3) hooks, and blocks the agent with the errors.
