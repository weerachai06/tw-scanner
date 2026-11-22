# @weerachai06/agent-gate

Run architecture rules and project checks from AI coding agent hooks, and block the agent with the exact errors until they are fixed.

Agents ignore repo rules and say "done" without checking. A hook can't make code correct, but it can stop the agent from finishing while your checks fail.

**Supported agents:** Claude Code and kiro-cli (V3, tested on 3.5.0).

## Install

```bash
npm i -D @weerachai06/agent-gate
```

## Configure `agent-gate.json`

Put it at the repo root. Every field is optional.

```json
{
  "rules": [
    {
      "id": "fcis-core-pure",
      "files": ["src/core/**/*.ts"],
      "ignore": ["**/*.test.ts"],
      "forbidImports": ["fs", "child_process"],
      "forbidImportNames": [{ "from": "react", "names": ["use*"] }],
      "forbidGlobals": ["fetch", "process"],
      "message": "Core must be pure. Move I/O to the shell."
    }
  ],
  "commands": [
    { "name": "lint", "run": ["bunx", "eslint", "{files}"], "files": ["**/*.{ts,tsx}"] },
    { "name": "typecheck", "run": ["bun", "run", "typecheck"], "timeoutSec": 120 },
    { "name": "test", "run": ["bun", "run", "test"], "timeoutSec": 300 }
  ],
  "maxOutputChars": 4000
}
```

### Rules (pure checks on source files)

| Field | Meaning |
|---|---|
| `files` / `ignore` | Globs relative to the repo root. |
| `forbidImports` | Modules that must not be imported. `fs` also matches `node:fs` and `fs/promises`, not `fsevents`. Covers `import`, `export … from`, `require()`, and `import()`. `import type` is ignored. |
| `forbidImportNames` | Names that must not be imported from a module. `names` accept globs (`use*`). Matches the original name, not the alias. |
| `forbidGlobals` | Identifiers that must not be used (`fetch`, `process`). |
| `message` | Shown to the agent. Quote the line from your `CLAUDE.md` so it reads the repo's own wording. |

### Commands (run on Stop only)

| Field | Meaning |
|---|---|
| `run` | The command as an argument list. No shell. A `{files}` argument expands to one argument per changed file. |
| `files` | Only run when a changed file matches. Without it, the command runs for any change. |
| `timeoutSec` | Default 120. A command that times out is a warning, not a block. |

Commands run in order and stop at the first failure. Output is trimmed to `maxOutputChars`, keeping lines that mention changed files and error lines first.

## Claude Code setup

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR/node_modules/.bin/agent-gate\" hook --agent claude" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR/node_modules/.bin/agent-gate\" hook --agent claude" }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR/node_modules/.bin/agent-gate\" hook --agent claude" }]
      }
    ]
  }
}
```

| Hook | What it does |
|---|---|
| `PreToolUse` | Refuses edits to `agent-gate.json`, `.claude/settings.json`, `.claude/settings.local.json`, and `.kiro/hooks/**`, so the agent can't switch the checks off. |
| `PostToolUse` | Checks the rules on the file that was just edited. |
| `Stop` | Takes the files changed since `HEAD` plus untracked files, checks the rules on them, then runs the commands. If nothing changed, it allows right away. |

Exit codes: `0` allow, `2` block (the errors go to the agent on stderr), `1` agent-gate itself failed or a command timed out. `1` does not block the agent: a missing or invalid config, a timeout, or a folder that isn't a git repo all fail open.

## kiro-cli setup

`.kiro/hooks/agent-gate.json`:

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "agent-gate-guard",
      "trigger": "PreToolUse",
      "matcher": "write",
      "action": { "type": "command", "command": "./node_modules/.bin/agent-gate hook --agent kiro" },
      "timeout": 30,
      "enabled": true
    },
    {
      "name": "agent-gate-stop",
      "trigger": "Stop",
      "action": { "type": "command", "command": "./node_modules/.bin/agent-gate hook --agent kiro" },
      "timeout": 300,
      "enabled": true
    }
  ]
}
```

Kiro hooks run in the project folder. Kiro's default hook timeout is 60 seconds, so set the `Stop` timeout above the total of your command timeouts.

Kiro differs from Claude Code, and these were checked against kiro-cli 3.5.0 in non-interactive mode:

- **No `PostToolUse` hook.** Whatever a `PostToolUse` hook prints (exit 2, exit 1, or stdout) never reaches the agent, so agent-gate ignores that event. Rules are checked on `Stop` instead.
- **`PreToolUse`** (exit 2) blocks the write and the agent sees the message. It only runs the guard.
- **`Stop`** blocks with `{"decision":"block","reason":…}` on stdout and exit 0. Kiro ran the `Stop` hook once per turn: after one block the agent gets one chance to fix things, and the result is not re-checked.
- Tool paths can be absolute or relative to the project folder. agent-gate handles both.

## What it can't do

- It can't prove code is correct. It enforces only what you wrote down as a rule or a command.
- `forbidGlobals` has no scope analysis, so a local variable named `fetch` is reported too. Destructuring patterns are skipped, and `globalThis.fetch` is not seen.
- `PostToolUse` (Claude Code) runs after the file is written, so the bad file stays on disk until the agent fixes it.
- On Kiro, rules and commands are only checked when the agent finishes, and only once per turn.
- The guard sees Claude's `Write`, `Edit`, `MultiEdit` and Kiro's `fs_write`, `str_replace`. A shell command such as `sed -i` can still change a protected file.
- An agent can still dodge checks with `as any`, `eslint-disable`, or by deleting tests. Make the commands cover that.
- Commands in `agent-gate.json` run on every Stop with your permissions, like `package.json` scripts. Review changes to the file.

## Architecture

Functional core, imperative shell.

- `src/core/` is pure: no `fs`, `child_process`, `process`, or network. It parses hook input, extracts imports and globals from the AST, applies rules, plans commands, and decides. It's tested with inline strings.
- `src/runner.ts`, `src/exec.ts`, and `src/cli.ts` own all I/O. `runHook` takes `readFile` and `runCommand` as parameters, so tests use fakes.
