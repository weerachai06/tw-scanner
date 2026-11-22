# @weerachai06/agent-gate

Run architecture rules and project checks from AI coding agent hooks, and block the agent with the exact errors until they are fixed.

Agents ignore repo rules and say "done" without checking. A hook can't make code correct, but it can stop the agent from finishing while your checks fail.

**Supported agents:** Claude Code and kiro-cli (V3, tested on 3.5.0).

## Install

Nothing to install. The hook commands below run the package with `npx`:

```bash
npx @weerachai06/agent-gate hook --agent claude
```

Use the scoped name. `npx agent-gate` is a different package name, not this one.

To pin a version and avoid a download on first use, add it as a dev dependency. `npx` then runs the local copy, which costs about 0.1 s more per hook call than calling the binary directly:

```bash
npm i -D @weerachai06/agent-gate
```

## Configure `agent-gate.json`

Put it at the repo root. Every field is optional.

```json
{
  "$schema": "https://unpkg.com/@weerachai06/agent-gate/schema.json",
  "rules": [
    {
      "id": "fcis-core-pure",
      "files": ["src/core/**/*.ts"],
      "ignore": ["**/*.test.ts"],
      "forbidImports": ["fs", "child_process"],
      "forbidImportNames": [{ "from": "react", "names": ["use*"] }],
      "forbidGlobals": ["fetch", "process"],
      "message": "Core must be pure. Move I/O to the shell.",
      "fix": "Return a description of the effect from core and run it in src/exec.ts."
    }
  ],
  "commands": [
    { "name": "lint", "run": ["bunx", "eslint", "{files}"], "files": ["**/*.{ts,tsx}"] },
    { "name": "typecheck", "run": ["bun", "run", "typecheck"], "timeoutSec": 120 },
    { "name": "test", "run": ["bun", "run", "test"], "timeoutSec": 300 }
  ],
  "maxOutputChars": 4000,
  "base": "origin/main"
}
```

### Editor completion with `$schema`

`$schema` points your editor at [`schema.json`](https://unpkg.com/@weerachai06/agent-gate/schema.json), which ships in this package. You get completion, a tooltip on every field, and errors for a wrong type or a misspelled key (the schema rejects keys it doesn't know, for example `forbidImport` instead of `forbidImports`; agent-gate itself would ignore them). VS Code, JetBrains IDEs, and any editor that supports JSON Schema pick it up with no extra setup. agent-gate ignores the `$schema` line itself.

The URL above always serves the latest version. To match the version you installed, pin it:

```json
"$schema": "https://unpkg.com/@weerachai06/agent-gate@0.1.0/schema.json"
```

or, if you installed the package with `npm i -D`, use the local copy so it works offline:

```json
"$schema": "./node_modules/@weerachai06/agent-gate/schema.json"
```

### Rules (pure checks on source files)

| Field | Meaning |
|---|---|
| `files` / `ignore` | Globs relative to the repo root. |
| `forbidImports` | Modules that must not be imported. `fs` also matches `node:fs` and `fs/promises`, not `fsevents`. Covers `import`, `export … from`, `require()`, and `import()`. `import type` is ignored. |
| `forbidImportNames` | Names that must not be imported from a module. `names` accept globs (`use*`). Matches the original name, not the alias. |
| `forbidGlobals` | Identifiers that must not be used (`fetch`, `process`). |
| `message` | Shown to the agent. Quote the line from your `CLAUDE.md` so it reads the repo's own wording. |
| `fix` | Optional. How to fix a violation, shown after `message`. One or two sentences, pointing to an example file. Costs tokens only when the rule is broken. Works the same for Kiro and Claude Code. Without it, agent-gate adds a built-in hint for `fs`, `child_process`, `net`, `http`, `https`, `fetch`, `process`, `Date` and React `use*` hooks. A rule's `fix` replaces the built-in hint. |

### Commands (run on Stop only)

| Field | Meaning |
|---|---|
| `run` | The command as an argument list. No shell. A `{files}` argument expands to one argument per changed file. A long list is split into several runs of the command, so it never exceeds the OS limit on a command line. |
| `files` | Only run when a changed file matches. Without it, the command runs for any change. |
| `timeoutSec` | Default 120. A command that times out is a warning, not a block. |

Commands run in order and stop at the first failure. Output is trimmed to `maxOutputChars`, keeping lines that mention changed files and error lines first.

### Which files Stop checks

Stop checks files that changed on this branch, not just uncommitted ones, so work the agent already committed still counts. It diffs the working tree against the merge-base (the commit where the branch left the base branch), and adds untracked files. Deleted and git-ignored files are skipped.

The base branch is `base` from `agent-gate.json` (for example `"origin/develop"`). Without it, agent-gate uses the remote's default branch (`origin/HEAD`, usually `origin/main`).

| Situation | What happens |
|---|---|
| `base` is set but git can't find it | Exit `1` with a message. It does not block the agent. |
| No `base`, and git finds no `origin/HEAD` or no merge-base (no remote, or a shallow clone) | Falls back to `HEAD`: only uncommitted and untracked files are checked, so work the agent commits is no longer seen. |
| You are on the base branch | Local commits not yet pushed, uncommitted files, and untracked files. |

Because the scope is the whole branch, a rule violation in an earlier commit on the branch (yours or a teammate's) is also reported. Violations that were already on the base branch are not.

Commands without a `files` filter (`typecheck`, `test`) run on the whole project whenever at least one file changed. If nothing changed, nothing runs.

## Claude Code setup

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "npx @weerachai06/agent-gate hook --agent claude" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "npx @weerachai06/agent-gate hook --agent claude" }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "npx @weerachai06/agent-gate hook --agent claude" }]
      }
    ]
  }
}
```

| Hook | What it does |
|---|---|
| `PreToolUse` | Refuses edits to `agent-gate.json`, `.claude/settings.json`, `.claude/settings.local.json`, and `.kiro/hooks/**`, so the agent can't switch the checks off. |
| `PostToolUse` | Checks the rules on the file that was just edited. |
| `Stop` | Takes the files changed on this branch plus untracked files (see above), checks the rules on them, then runs the commands. If nothing changed, it allows right away. |

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
      "action": { "type": "command", "command": "npx @weerachai06/agent-gate hook --agent kiro" },
      "timeout": 30,
      "enabled": true
    },
    {
      "name": "agent-gate-stop",
      "trigger": "Stop",
      "action": { "type": "command", "command": "npx @weerachai06/agent-gate hook --agent kiro" },
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

### Workspace trust

kiro-cli can ask "Trust this workspace?" before it loads a folder's hooks, agents, and MCP servers. In an interactive session, accept it. `--trust-workspace` skips the prompt for one launch and does not save the decision. A headless run in testing loaded these hooks without the flag, so if your hooks don't fire, check trust first.

### Test the hook by hand

Pipe a sample payload into the command Kiro would run. The guard should print its reason and exit `2`:

```bash
echo '{"hook_event_name":"PreToolUse","cwd":"'"$PWD"'","tool_name":"str_replace","tool_input":{"path":"agent-gate.json"}}' \
  | npx @weerachai06/agent-gate hook --agent kiro; echo "exit=$?"
```

`Stop` exits `0` with no output when everything passes. When a rule or command fails it exits `0` and prints a `{"decision":"block","reason":…}` JSON line, which is how Kiro knows to keep the agent going:

```bash
echo '{"hook_event_name":"Stop","cwd":"'"$PWD"'"}' | npx @weerachai06/agent-gate hook --agent kiro; echo "exit=$?"
```

`Stop` needs a git repository to find the changed files. Outside one it exits `1` with a message and does not block. Inside one, it diffs against the merge-base with the base branch, as described above.

### Payloads Kiro sends

Captured on kiro-cli 3.5.0 (V3):

| Event | Fields |
|---|---|
| `PreToolUse` | `session_id`, `hook_event_name`, `cwd`, `tool_name`, `tool_input` |
| `PostToolUse` | the same, plus `tool_response` (a string). agent-gate ignores it. |
| `Stop` | `session_id`, `hook_event_name`, `cwd`. There is no retry flag. |

| `tool_name` | `tool_input` |
|---|---|
| `fs_write` | `path`, `text` |
| `str_replace` | `path`, `oldStr`, `newStr`, `replace_all` |

`path` is absolute or relative to `cwd`. The `write` matcher covers both tools. Other write tools may exist; agent-gate ignores any `tool_name` it has not seen.

### Headless and CI runs

Hooks also run in non-interactive mode:

```bash
kiro-cli chat --no-interactive --trust-workspace --trust-tools=fs_write "your prompt"
```

`--no-interactive` can't ask for approval, so any tool you haven't trusted is denied. Shell commands are denied unless you pass `--trust-tools=run_command` or `--trust-all-tools`. Trusting the shell lets an agent run something like `sed -i` on a protected file, which the guard does not see.

## Session baseline (optional, recommended)

A diff can't show everything an agent does. Register a `SessionStart` hook and agent-gate saves what the repo looks like when the session begins: the commit `HEAD` points at, the top `git stash` entry, and a hash of each file that controls the checks. `Stop` then compares against it, which closes three gaps:

| Gap | What Stop does with the baseline |
|---|---|
| `git stash` hides uncommitted changes | Blocks if a stash entry was added during the session. |
| No remote or a shallow clone, so committed work is not seen | Also diffs against the commit the session started at, so commits made during the session are checked. |
| A guard file edited through a shell command such as `sed -i` | Blocks if `agent-gate.json`, `.claude/settings*.json`, or a file in `.kiro/hooks/` changed. |

Add the hook next to the others. Claude Code, in `.claude/settings.json`:

```json
"SessionStart": [
  {
    "hooks": [{ "type": "command", "command": "npx @weerachai06/agent-gate hook --agent claude" }]
  }
]
```

kiro-cli, one more entry in the `hooks` array of `.kiro/hooks/agent-gate.json`:

```json
{
  "name": "agent-gate-session-start",
  "trigger": "SessionStart",
  "action": { "type": "command", "command": "npx @weerachai06/agent-gate hook --agent kiro" },
  "timeout": 30,
  "enabled": true
}
```

The hook prints nothing. It writes one file, `<OS temp dir>/agent-gate/<session id>.json`, readable only by you. It holds commit and stash ids and file hashes, never file contents. The OS usually cleans the temp dir up on its own.

Without the `SessionStart` hook, everything works as before and these three gaps stay open. Other points:

- If you edit `agent-gate.json` or a hook file yourself during a session, Stop blocks until you start a new session. The baseline can't tell your edit from the agent's.
- Claude Code also fires `SessionStart` when it compacts a conversation. agent-gate keeps the original baseline in that case. Kiro sends no such marker, so if its `SessionStart` fires again mid-session, the baseline is replaced.
- A stash is fine if it was already there at the start, or if the agent pops it again before finishing.

## What it can't do

- It can't prove code is correct. It enforces only what you wrote down as a rule or a command.
- `forbidGlobals` has no scope analysis, so a local variable named `fetch` is reported too. Destructuring patterns are skipped, and `globalThis.fetch` is not seen.
- `PostToolUse` (Claude Code) runs after the file is written, so the bad file stays on disk until the agent fixes it.
- On Kiro, rules and commands are only checked when the agent finishes, and only once per turn.
- Files outside the changed set are never checked: a violation that already exists on the base branch is ignored, and so is a git-ignored file.
- Without a usable remote base (no remote, or a shallow clone), the scope falls back to uncommitted files, and an agent that commits its work before finishing is not checked. Set `base`, or register the `SessionStart` hook, to avoid this.
- The guard sees Claude's `Write`, `Edit`, `MultiEdit` and Kiro's `fs_write`, `str_replace`. A shell command such as `sed -i` can still change a protected file. With the `SessionStart` hook registered, Stop reports that change, but the file is already changed by then.
- An agent can still dodge checks with `as any`, `eslint-disable`, or by deleting tests. Make the commands cover that.
- Commands in `agent-gate.json` run on every Stop with your permissions, like `package.json` scripts. Review changes to the file.

## Architecture

Functional core, imperative shell.

- `src/core/` is pure: no `fs`, `child_process`, `process`, or network. It parses hook input, extracts imports and globals from the AST, applies rules, plans commands, and decides. It's tested with inline strings.
- `src/runner.ts`, `src/exec.ts`, and `src/cli.ts` own all I/O. `runHook` takes `readFile` and `runCommand` as parameters, so tests use fakes.
