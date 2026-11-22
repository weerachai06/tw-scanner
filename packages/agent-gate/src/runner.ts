import * as path from 'path'
import { baselinePath, hashContent, parseBaseline, tamperProblems } from './core/baseline.js'
import { formatClaudeOutput, parseClaudeInput } from './core/claude.js'
import { parseConfig } from './core/config.js'
import { decide, relax } from './core/decide.js'
import { GUARD_DIRS, GUARD_FILES, guard } from './core/guard.js'
import { formatKiroOutput, parseKiroInput } from './core/kiro.js'
import { checkFiles, type SourceFile } from './core/rules.js'
import { parseGitFiles, planCommands, selectFiles, toRelative } from './core/scope.js'
import { summarizeOutput } from './core/summarize.js'
import type { Agent, AgentOutput, CommandFailure, Config, Decision, HookEvent, Snapshot } from './core/types.js'
import type { RunCommand } from './exec.js'

export const CONFIG_FILE = 'agent-gate.json'

const GIT_TIMEOUT_MS = 10_000
const REPRODUCE_MAX_CHARS = 200

/** I/O is injected so tests need no filesystem or processes. readFile returns null when missing. */
export interface Deps {
  readFile(file: string): string | null
  /** Creates missing folders. Throws when it cannot write. */
  writeFile(file: string, content: string): void
  /** Names in a folder, or null when it does not exist. */
  listDir(dir: string): string[] | null
  runCommand: RunCommand
  /** Where per-session baselines are kept. */
  tmpDir: string
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

const git = (args: string[], root: string, deps: Deps) =>
  deps.runCommand(['git', ...args], { cwd: root, timeoutMs: GIT_TIMEOUT_MS })

/**
 * What to diff the working tree against. The merge-base with the base branch, so commits the
 * agent made on this branch still count as changed. An explicit `base` that cannot be resolved is
 * an error; an auto-detected one quietly falls back to HEAD (no origin, shallow clone).
 */
async function diffTarget(root: string, base: string | undefined, deps: Deps): Promise<string | { error: string }> {
  let ref = base
  if (ref === undefined) {
    const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root, deps)
    if (head.exitCode !== 0 || !head.stdout.trim()) return 'HEAD'
    ref = head.stdout.trim()
  }
  const mergeBase = await git(['merge-base', ref, 'HEAD'], root, deps)
  if (mergeBase.exitCode === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim()
  return base === undefined ? 'HEAD' : { error: `base "${base}" not found (git merge-base ${base} HEAD failed)` }
}

const listChanged = (target: string, root: string, deps: Deps) =>
  git(['diff', '-z', '--name-only', '--relative', '--diff-filter=d', target], root, deps)
const listUntracked = (root: string, deps: Deps) => git(['ls-files', '-z', '--others', '--exclude-standard'], root, deps)

/**
 * Files changed in this session when a baseline exists: since the commit the session started at,
 * plus untracked files. Work committed on the branch before the session is not the agent's to fix.
 * Without a baseline, or when its commit no longer exists (rebased away), the whole branch counts:
 * since the merge-base with the base branch, so commits the agent made still count.
 * An explicit `base` that cannot be resolved is an error.
 */
async function changedFiles(
  root: string,
  base: string | undefined,
  sessionHead: string | null,
  deps: Deps,
): Promise<string[] | { error: string }> {
  if (sessionHead !== null) {
    const [session, untracked] = await Promise.all([listChanged(sessionHead, root, deps), listUntracked(root, deps)])
    if (session.exitCode === 0) return parseGitFiles(session.stdout, untracked.exitCode === 0 ? untracked.stdout : '')
  }

  const target = await diffTarget(root, base, deps)
  if (typeof target !== 'string') return target
  const outcomes = await Promise.all([listChanged(target, root, deps), listUntracked(root, deps)])
  const listed = outcomes.filter((o) => o.exitCode === 0)
  if (listed.length === 0) return { error: 'could not list changed files (is this a git repository?)' }
  return parseGitFiles(...listed.map((o) => o.stdout))
}

/** HEAD, the top stash entry, and a hash of each file that controls the checks. */
async function takeSnapshot(root: string, deps: Deps): Promise<Snapshot> {
  const [head, stash] = await Promise.all([
    git(['rev-parse', '--verify', '-q', 'HEAD'], root, deps),
    git(['rev-parse', '--verify', '-q', 'refs/stash'], root, deps),
  ])
  const files = [
    ...GUARD_FILES,
    ...GUARD_DIRS.flatMap((dir) => (deps.listDir(path.join(root, dir)) ?? []).map((name) => `${dir}/${name}`)),
  ]
  const guardHashes = Object.fromEntries(
    files.map((f) => {
      const content = deps.readFile(path.join(root, f))
      return [f, content === null ? null : hashContent(content)]
    }),
  )
  const out = (o: { exitCode: number | null; stdout: string }) =>
    o.exitCode === 0 && o.stdout.trim() ? o.stdout.trim() : null
  return { head: out(head), stash: out(stash), guard: guardHashes }
}

/** Saves what the repo looks like now, so Stop can tell what happened during the session. */
async function startSession(
  event: Extract<HookEvent, { kind: 'session-start' }>,
  root: string,
  deps: Deps,
  format: Format,
): Promise<AgentOutput> {
  const file = baselinePath(deps.tmpDir, event.sessionId)
  if (file === null) return format({ action: 'allow' })
  // A compaction restarts the session mid-way: keep the baseline from the real start.
  if (event.source === 'compact' && deps.readFile(file) !== null) return format({ action: 'allow' })
  try {
    deps.writeFile(file, JSON.stringify(await takeSnapshot(root, deps)))
  } catch (e) {
    return failure(`could not save the session baseline: ${(e as Error).message}`)
  }
  return format({ action: 'allow' })
}

type Format = (decision: Decision) => AgentOutput

/** Names what went wrong, not the command output, which can change on every run (timings). */
const signatureOf = (parts: unknown): string => hashContent(JSON.stringify(parts))

/** Best effort: when it cannot be saved, Stop just blocks every time, as before. */
function remember(file: string | null, baseline: Snapshot | null, lastBlock: string | null, deps: Deps): void {
  if (file === null || baseline === null || (baseline.lastBlock ?? null) === lastBlock) return
  try {
    deps.writeFile(file, JSON.stringify({ ...baseline, lastBlock }))
  } catch {}
}

async function runStop(
  root: string,
  config: Config,
  deps: Deps,
  format: Format,
  sessionId: string | undefined,
  retry: boolean,
): Promise<AgentOutput> {
  const file = sessionId === undefined ? null : baselinePath(deps.tmpDir, sessionId)
  const baseline = file === null ? null : parseBaseline(deps.readFile(file))
  /**
   * Do not trap the agent in a loop: a block on a retry (Claude's stop_hook_active), or on the same
   * problems as the last block (Kiro sends no retry flag), is reported as a warning instead.
   * `signature` is null when there is nothing to block on.
   */
  const settle = (decision: Decision, signature: string | null = null) => {
    const blocking = decision.action === 'block'
    const repeated = blocking && signature !== null && baseline?.lastBlock === signature
    remember(file, baseline, blocking ? signature : null, deps)
    return format(retry || repeated ? relax(decision) : decision)
  }
  const problems = baseline === null ? [] : tamperProblems(baseline, await takeSnapshot(root, deps))

  const changed = await changedFiles(root, config.base, baseline?.head ?? null, deps)
  if ('error' in changed) return failure(changed.error)
  if (changed.length === 0 && problems.length === 0) return settle({ action: 'allow' })

  // Cheap checks first: rules are pure, so a broken rule skips the slow commands.
  const covered = selectFiles(changed, config.rules.flatMap((r) => r.files))
  const violations = checkFiles(readSources(covered, root, deps), config.rules)
  if (problems.length + violations.length > 0) {
    const where = violations.map((v) => [v.ruleId, v.file, v.line, v.col, v.kind])
    return settle(decide(violations, [], problems), signatureOf([problems, where]))
  }

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
  const failed = failures.filter((f) => f.exitCode !== null).map((f) => [f.name, f.exitCode])
  return settle(decide([], failures), signatureOf(failed))
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

  if (event.kind === 'session-start') return startSession(event, root, deps, format)

  if (event.kind !== 'edit' && event.kind !== 'stop') return format({ action: 'allow' })

  const configSource = deps.readFile(path.join(root, CONFIG_FILE))
  if (configSource === null) return failure(`${CONFIG_FILE} not found in ${root}`)
  const parsed = parseConfig(configSource)
  if (!parsed.ok) return failure(`invalid ${CONFIG_FILE}:\n${parsed.errors.join('\n')}`)

  if (event.kind === 'stop') return runStop(root, parsed.config, deps, format, event.sessionId, event.retry)

  const rel = event.files.flatMap((f) => toRelative(f, root) ?? [])
  return format(decide(checkFiles(readSources(rel, root, deps), parsed.config.rules)))
}
