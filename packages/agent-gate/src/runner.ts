import * as path from 'path'
import { formatClaudeOutput, parseClaudeInput } from './core/claude.js'
import { parseConfig } from './core/config.js'
import { decide } from './core/decide.js'
import { guard } from './core/guard.js'
import { formatKiroOutput, parseKiroInput } from './core/kiro.js'
import { checkFiles, type SourceFile } from './core/rules.js'
import { parseGitFiles, planCommands, selectFiles, toRelative } from './core/scope.js'
import { summarizeOutput } from './core/summarize.js'
import type { Agent, AgentOutput, CommandFailure, Config, Decision, HookEvent } from './core/types.js'
import type { RunCommand } from './exec.js'

export const CONFIG_FILE = 'agent-gate.json'

const GIT_TIMEOUT_MS = 10_000
const REPRODUCE_MAX_CHARS = 200

/** I/O is injected so tests need no filesystem or processes. readFile returns null when missing. */
export interface Deps {
  readFile(file: string): string | null
  runCommand: RunCommand
}

const adapters: Record<
  Agent,
  {
    parse: (raw: string) => HookEvent
    format: (decision: Decision, kind: HookEvent['kind']) => AgentOutput
  }
> = {
  claude: { parse: parseClaudeInput, format: formatClaudeOutput },
  kiro: { parse: parseKiroInput, format: formatKiroOutput },
}

const failure = (message: string): AgentOutput => ({
  exitCode: 1,
  stdout: '',
  stderr: `agent-gate: ${message}`,
})

function readSources(relPaths: string[], root: string, deps: Deps): SourceFile[] {
  return relPaths.flatMap((rel) => {
    const source = deps.readFile(path.join(root, rel))
    return source === null ? [] : [{ path: rel, source }]
  })
}

/** Files changed since HEAD plus untracked ones, relative to root. null if git is unusable. */
async function changedFiles(root: string, deps: Deps): Promise<string[] | null> {
  const opts = { cwd: root, timeoutMs: GIT_TIMEOUT_MS }
  const [diff, untracked] = await Promise.all([
    deps.runCommand(['git', 'diff', '--name-only', '--relative', '--diff-filter=d', 'HEAD'], opts),
    deps.runCommand(['git', 'ls-files', '--others', '--exclude-standard'], opts),
  ])
  if (diff.exitCode !== 0 && untracked.exitCode !== 0) return null
  return parseGitFiles(
    diff.exitCode === 0 ? diff.stdout : '',
    untracked.exitCode === 0 ? untracked.stdout : '',
  )
}

type Format = (decision: Decision) => AgentOutput

async function runStop(root: string, config: Config, deps: Deps, format: Format): Promise<AgentOutput> {
  const changed = await changedFiles(root, deps)
  if (changed === null) return failure('could not list changed files (is this a git repository?)')
  if (changed.length === 0) return format({ action: 'allow' })

  // Cheap checks first: rules are pure, so a broken rule skips the slow commands.
  const covered = selectFiles(changed, config.rules.flatMap((r) => r.files))
  const violations = checkFiles(readSources(covered, root, deps), config.rules)
  if (violations.length > 0) return format(decide(violations))

  const failures: CommandFailure[] = []
  for (const plan of planCommands(config.commands, changed)) {
    const outcome = await deps.runCommand(plan.argv, { cwd: root, timeoutMs: plan.timeoutSec * 1000 })
    if (outcome.exitCode === 0) continue
    failures.push({
      name: plan.name,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      output: summarizeOutput(`${outcome.stdout}\n${outcome.stderr}`, changed, config.maxOutputChars),
      reproduce: plan.argv.join(' ').slice(0, REPRODUCE_MAX_CHARS),
    })
    break
  }
  return format(decide([], failures))
}

/** Fail-open: a problem in agent-gate itself exits 1, which does not block the agent. */
export async function runHook(
  raw: string,
  root: string,
  deps: Deps,
  agent: Agent = 'claude',
): Promise<AgentOutput> {
  const adapter = adapters[agent]
  const event = adapter.parse(raw)
  const format: Format = (decision) => adapter.format(decision, event.kind)

  if (event.kind === 'pre-edit') {
    const relative = event.files.flatMap((f) => toRelative(f, root) ?? [])
    return format(guard(relative))
  }

  if (event.kind !== 'edit' && event.kind !== 'stop') return format({ action: 'allow' })

  const configSource = deps.readFile(path.join(root, CONFIG_FILE))
  if (configSource === null) return failure(`${CONFIG_FILE} not found in ${root}`)
  const parsed = parseConfig(configSource)
  if (!parsed.ok) return failure(`invalid ${CONFIG_FILE}:\n${parsed.errors.join('\n')}`)

  if (event.kind === 'stop') return runStop(root, parsed.config, deps, format)

  const rel = event.files.flatMap((f) => toRelative(f, root) ?? [])
  return format(decide(checkFiles(readSources(rel, root, deps), parsed.config.rules)))
}
