export type Agent = 'claude' | 'kiro'

export type HookEvent =
  | { kind: 'edit'; agent: Agent; cwd: string; tool: string; files: string[] }
  | { kind: 'pre-edit'; agent: Agent; cwd: string; tool: string; files: string[] }
  | { kind: 'session-start'; agent: Agent; cwd: string; sessionId: string; source?: string }
  | { kind: 'stop'; agent: Agent; cwd: string; retry: boolean; sessionId?: string }
  | { kind: 'ignored'; agent: Agent; why: string }

export interface Rule {
  id: string
  files: string[]
  ignore?: string[]
  message: string
  /** How to fix a violation. Shown after the message. Keep it to one or two sentences. */
  fix?: string
  forbidImports?: string[]
  /** Names may be globs, e.g. `use*`. `from` also matches subpaths (`react/x`). */
  forbidImportNames?: { from: string; names: string[] }[]
  /** Identifiers that must not be used, e.g. `fetch`, `process`. */
  forbidGlobals?: string[]
}

export interface CommandSpec {
  name: string
  /** argv, no shell. A `{files}` argument expands to one argument per changed file. */
  run: string[]
  /** Only run when a changed file matches. Without it the command runs for any change. */
  files?: string[]
  timeoutSec?: number
}

export interface Config {
  rules: Rule[]
  commands: CommandSpec[]
  maxOutputChars: number
  /** Git ref that Stop diffs against, e.g. `origin/main`. Default: the remote's default branch. */
  base?: string
}

export interface PlannedCommand {
  name: string
  argv: string[]
  timeoutSec: number
}

export interface CommandOutcome {
  /** null when the process could not start or was killed. */
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface CommandFailure {
  name: string
  exitCode: number | null
  timedOut: boolean
  /** Already summarized. */
  output: string
  reproduce: string
}

export type ViolationKind = 'import' | 'import-name' | 'global' | 'parse-error'

export interface Violation {
  ruleId: string
  kind: ViolationKind
  file: string
  line: number
  col: number
  found: string
  message: string
  fix?: string
}

export type Decision =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'warn'; message: string }

export interface AgentOutput {
  /** 0 = allow, 2 = block the agent, 1 = agent-gate itself failed (non-blocking). */
  exitCode: 0 | 1 | 2
  stdout: string
  stderr: string
}

/** What the repo looked like at one moment, to spot changes agent-gate cannot see in a diff. */
export interface Snapshot {
  /** `git rev-parse HEAD`, null outside a repo or before the first commit. */
  head: string | null
  /** The top stash entry, null when there is none. */
  stash: string | null
  /** Hash of each file that controls the checks, null when the file is missing. */
  guard: Record<string, string | null>
}
