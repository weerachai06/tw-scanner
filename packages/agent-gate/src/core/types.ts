export type Agent = 'claude' | 'kiro'

export type HookEvent =
  | { kind: 'edit'; agent: Agent; cwd: string; tool: string; files: string[] }
  | { kind: 'pre-edit'; agent: Agent; cwd: string; tool: string; files: string[] }
  | { kind: 'stop'; agent: Agent; cwd: string; retry: boolean }
  | { kind: 'ignored'; agent: Agent; why: string }

export interface Rule {
  id: string
  files: string[]
  ignore?: string[]
  message: string
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
