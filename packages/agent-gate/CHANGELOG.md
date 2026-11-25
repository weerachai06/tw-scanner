# @weerachai06/agent-gate

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
