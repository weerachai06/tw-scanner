import { describe, it, expect } from 'bun:test'
import { runHook, type Deps } from '../src/runner.js'
import { hashContent } from '../src/core/baseline.js'
import type { CommandOutcome } from '../src/core/types.js'

const ROOT = '/repo'

const config = JSON.stringify({
  rules: [
    {
      id: 'fcis-core-pure',
      files: ['src/core/**/*.ts'],
      message: 'Core must be pure',
      forbidImports: ['fs'],
    },
  ],
})

/** In-memory file system keyed by absolute path. */
const depsWith = (files: Record<string, string>): Deps => ({
  readFile: (p) => files[p] ?? null,
  runCommand: async () => {
    throw new Error('runCommand must not be called')
  },
  writeFile: () => {
    throw new Error('writeFile must not be called')
  },
  listDir: () => null,
  tmpDir: '/tmp',
})

const hook = (event: string, tool: string, file: string) =>
  JSON.stringify({
    cwd: ROOT,
    hook_event_name: event,
    tool_name: tool,
    tool_input: { file_path: file },
  })

describe('runHook — edit', () => {
  it('blocks when an edited core file imports fs', async () => {
    const out = await runHook(
      hook('PostToolUse', 'Edit', '/repo/src/core/x.ts'),
      ROOT,
      depsWith({
        '/repo/agent-gate.json': config,
        '/repo/src/core/x.ts': "import fs from 'node:fs'",
      }),
    )
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('[fcis-core-pure] src/core/x.ts:1:0 imports "node:fs"')
  })

  it('allows a clean file', async () => {
    const out = await runHook(
      hook('PostToolUse', 'Write', '/repo/src/core/x.ts'),
      ROOT,
      depsWith({ '/repo/agent-gate.json': config, '/repo/src/core/x.ts': 'export const a = 1' }),
    )
    expect(out).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('allows a forbidden import in a file no rule covers', async () => {
    const out = await runHook(
      hook('PostToolUse', 'Edit', '/repo/src/shell/x.ts'),
      ROOT,
      depsWith({ '/repo/agent-gate.json': config, '/repo/src/shell/x.ts': "import fs from 'fs'" }),
    )
    expect(out.exitCode).toBe(0)
  })

  it('allows when the edited file is not on disk', async () => {
    const out = await runHook(
      hook('PostToolUse', 'Edit', '/repo/src/core/gone.ts'),
      ROOT,
      depsWith({ '/repo/agent-gate.json': config }),
    )
    expect(out.exitCode).toBe(0)
  })

  it('allows a file outside the repo root', async () => {
    const out = await runHook(
      hook('PostToolUse', 'Edit', '/elsewhere/x.ts'),
      ROOT,
      depsWith({ '/repo/agent-gate.json': config, '/elsewhere/x.ts': "import fs from 'fs'" }),
    )
    expect(out.exitCode).toBe(0)
  })

  it('exits 1 (non-blocking) when agent-gate.json is missing', async () => {
    const out = await runHook(hook('PostToolUse', 'Edit', '/repo/src/core/x.ts'), ROOT, depsWith({}))
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('agent-gate.json')
  })

  it('exits 1 (non-blocking) when the config is invalid', async () => {
    const out = await runHook(
      hook('PostToolUse', 'Edit', '/repo/src/core/x.ts'),
      ROOT,
      depsWith({ '/repo/agent-gate.json': '{"rules":"x"}' }),
    )
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('"rules" must be an array')
  })
})

describe('runHook — guard', () => {
  it('blocks an edit to agent-gate.json even when the config is missing', async () => {
    const out = await runHook(hook('PreToolUse', 'Write', '/repo/agent-gate.json'), ROOT, depsWith({}))
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('agent-gate.json')
  })

  it('allows an edit to an ordinary file', async () => {
    const out = await runHook(hook('PreToolUse', 'Edit', '/repo/src/a.ts'), ROOT, depsWith({}))
    expect(out.exitCode).toBe(0)
  })
})

describe('runHook — other events', () => {
  it('allows ignored events', async () => {
    expect((await runHook('not json', ROOT, depsWith({}))).exitCode).toBe(0)
  })

})

// ── Stop ──────────────────────────────────────────────────────────────────────

const ok = (stdout = ''): CommandOutcome => ({ exitCode: 0, stdout, stderr: '', timedOut: false })

const stopRaw = JSON.stringify({ cwd: ROOT, hook_event_name: 'Stop' })

interface World {
  files?: Record<string, string>
  /** Output of `git diff --name-only` and `git ls-files --others`. */
  changed?: string[]
  untracked?: string[]
  gitFails?: boolean
  /** `git symbolic-ref refs/remotes/origin/HEAD`, e.g. 'origin/main'. Unset = the repo has none. */
  originHead?: string
  /** `git merge-base <ref> HEAD` output. Unset = git cannot find one. */
  mergeBase?: string
  /** `git rev-parse HEAD` and `git rev-parse refs/stash`. Unset = the command fails (no commit / no stash). */
  head?: string
  stash?: string
  /** Changed files per `git diff` target. When set, a target that is not listed fails (unknown commit). */
  diffs?: Record<string, string[]>
  /** Directory listings, by absolute path. */
  dirs?: Record<string, string[]>
  /** Result per full command line (argv joined by spaces), default exit 0. */
  commands?: Record<string, CommandOutcome>
}

function stopWorld(world: World) {
  const calls: string[][] = []
  const store: Record<string, string> = { ...(world.files ?? {}) }
  const writes: string[] = []
  const deps: Deps = {
    readFile: (p) => store[p] ?? null,
    writeFile: (p, content) => {
      writes.push(p)
      store[p] = content
    },
    listDir: (d) => (world.dirs ?? {})[d] ?? null,
    tmpDir: '/tmp',
    runCommand: async (argv) => {
      calls.push(argv)
      if (argv[0] === 'git') {
        const fail: CommandOutcome = { exitCode: 128, stdout: '', stderr: 'fatal', timedOut: false }
        if (world.gitFails) return fail
        if (argv[1] === 'symbolic-ref') return world.originHead === undefined ? fail : ok(`${world.originHead}\n`)
        if (argv[1] === 'merge-base') return world.mergeBase === undefined ? fail : ok(`${world.mergeBase}\n`)
        if (argv[1] === 'rev-parse') {
          const value = argv[argv.length - 1] === 'HEAD' ? world.head : world.stash
          return value === undefined ? { ...fail, exitCode: 1 } : ok(`${value}\n`)
        }
        if (argv[1] === 'diff') {
          const target = argv[argv.length - 1]
          if (world.diffs) return target in world.diffs ? ok(world.diffs[target].join('\0')) : fail
          return ok((world.changed ?? []).join('\0'))
        }
        return ok((world.untracked ?? []).join('\0'))
      }
      return (world.commands ?? {})[argv.join(' ')] ?? ok()
    },
  }
  return {
    deps,
    store,
    writes,
    calls,
    commandCalls: () => calls.filter((c) => c[0] !== 'git'),
    gitCalls: () => calls.filter((c) => c[0] === 'git').map((c) => c.slice(1).join(' ')),
  }
}

const stopConfig = (extra: object = {}) =>
  JSON.stringify({
    rules: [{ id: 'fcis-core-pure', files: ['src/core/**/*.ts'], message: 'pure', forbidImports: ['fs'] }],
    commands: [
      { name: 'typecheck', run: ['bun', 'run', 'typecheck'] },
      { name: 'test', run: ['bun', 'run', 'test'] },
    ],
    ...extra,
  })

describe('runHook — stop', () => {
  it('allows without running commands when nothing changed', async () => {
    const w = stopWorld({ files: { '/repo/agent-gate.json': stopConfig() } })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(0)
    expect(w.commandCalls()).toEqual([])
  })

  it('runs every command and allows when all pass', async () => {
    const w = stopWorld({ files: { '/repo/agent-gate.json': stopConfig() }, changed: ['src/a.ts'] })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(0)
    expect(w.commandCalls()).toEqual([['bun', 'run', 'typecheck'], ['bun', 'run', 'test']])
  })

  it('includes untracked files in the changed set', async () => {
    const config = stopConfig({ commands: [{ name: 'lint', run: ['lint', '{files}'] }] })
    const w = stopWorld({ files: { '/repo/agent-gate.json': config }, changed: ['a.ts'], untracked: ['b.ts'] })
    await runHook(stopRaw, ROOT, w.deps)
    expect(w.commandCalls()).toEqual([['lint', 'a.ts', 'b.ts']])
  })

  it('blocks on a failed command with its output, and stops at the first failure', async () => {
    const w = stopWorld({
      files: { '/repo/agent-gate.json': stopConfig() },
      changed: ['src/a.ts'],
      commands: {
        'bun run typecheck': {
          exitCode: 2,
          stdout: 'src/a.ts(1,1): error TS2322: bad',
          stderr: '',
          timedOut: false,
        },
      },
    })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('[typecheck] exit 2 — run: bun run typecheck')
    expect(out.stderr).toContain('src/a.ts(1,1): error TS2322: bad')
    expect(w.commandCalls()).toEqual([['bun', 'run', 'typecheck']])
  })

  it('trims command output to maxOutputChars', async () => {
    const w = stopWorld({
      files: { '/repo/agent-gate.json': stopConfig({ maxOutputChars: 60 }) },
      changed: ['src/a.ts'],
      commands: {
        'bun run typecheck': {
          exitCode: 1,
          stdout: Array.from({ length: 100 }, (_, i) => `noise ${i}`).join('\n'),
          stderr: '',
          timedOut: false,
        },
      },
    })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.stderr).toMatch(/… \d+ lines omitted/)
  })

  it('warns (exit 1, not blocking) when a command times out', async () => {
    const w = stopWorld({
      files: { '/repo/agent-gate.json': stopConfig() },
      changed: ['src/a.ts'],
      commands: { 'bun run typecheck': { exitCode: null, stdout: '', stderr: '', timedOut: true } },
    })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('[typecheck] timed out')
  })

  it('checks rules on changed files and skips commands when a rule is broken', async () => {
    const w = stopWorld({
      files: {
        '/repo/agent-gate.json': stopConfig(),
        '/repo/src/core/x.ts': "import fs from 'fs'",
      },
      changed: ['src/core/x.ts'],
    })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('[fcis-core-pure] src/core/x.ts:1:0 imports "fs"')
    expect(w.commandCalls()).toEqual([])
  })

  it('does not read files that no rule covers', async () => {
    const reads: string[] = []
    const w = stopWorld({ files: { '/repo/agent-gate.json': stopConfig() }, changed: ['src/shell/a.ts'] })
    const deps: Deps = { ...w.deps, readFile: (p) => (reads.push(p), w.deps.readFile(p)) }
    await runHook(stopRaw, ROOT, deps)
    expect(reads).toEqual(['/repo/agent-gate.json'])
  })

  it('exits 1 (non-blocking) when git cannot list changes', async () => {
    const w = stopWorld({ files: { '/repo/agent-gate.json': stopConfig() }, gitFails: true })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('git')
  })

  it('exits 1 when the config is missing', async () => {
    const out = await runHook(stopRaw, ROOT, stopWorld({}).deps)
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('agent-gate.json')
  })
})

// ── Kiro ──────────────────────────────────────────────────────────────────────

describe('runHook — kiro', () => {
  const kiroPre = (file: string) =>
    JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: ROOT,
      tool_name: 'str_replace',
      tool_input: { path: file, oldStr: 'a', newStr: 'b' },
    })
  const kiroStop = JSON.stringify({ hook_event_name: 'Stop', cwd: ROOT })

  it('blocks a PreToolUse edit of agent-gate.json with exit 2 (relative path)', async () => {
    const out = await runHook(kiroPre('agent-gate.json'), ROOT, depsWith({}), 'kiro')
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('agent-gate.json')
  })

  it('allows a PreToolUse edit of an ordinary file', async () => {
    const out = await runHook(kiroPre('src/a.ts'), ROOT, depsWith({}), 'kiro')
    expect(out).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('on Stop, blocks a rule violation with exit 0 and a decision:block JSON', async () => {
    const w = stopWorld({
      files: { '/repo/agent-gate.json': stopConfig(), '/repo/src/core/x.ts': "import fs from 'fs'" },
      changed: ['src/core/x.ts'],
    })
    const out = await runHook(kiroStop, ROOT, w.deps, 'kiro')
    expect(out.exitCode).toBe(0)
    const body = JSON.parse(out.stdout)
    expect(body.decision).toBe('block')
    expect(body.reason).toContain('[fcis-core-pure] src/core/x.ts:1:0 imports "fs"')
  })

  it('on Stop, blocks a failing command the same way', async () => {
    const w = stopWorld({
      files: { '/repo/agent-gate.json': stopConfig() },
      changed: ['src/a.ts'],
      commands: { 'bun run typecheck': { exitCode: 2, stdout: 'error TS1', stderr: '', timedOut: false } },
    })
    const out = await runHook(kiroStop, ROOT, w.deps, 'kiro')
    expect(JSON.parse(out.stdout).reason).toContain('[typecheck] exit 2')
  })

  it('on Stop, allows when everything passes', async () => {
    const w = stopWorld({ files: { '/repo/agent-gate.json': stopConfig() }, changed: ['src/a.ts'] })
    expect(await runHook(kiroStop, ROOT, w.deps, 'kiro')).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('ignores PostToolUse', async () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      cwd: ROOT,
      tool_name: 'fs_write',
      tool_input: { path: '/repo/src/core/x.ts', text: "import fs from 'fs'" },
    })
    const w = stopWorld({ files: { '/repo/agent-gate.json': stopConfig() } })
    expect(await runHook(raw, ROOT, w.deps, 'kiro')).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })
})

describe('runHook — stop: which files count as changed', () => {
  const files = { '/repo/agent-gate.json': stopConfig() }
  const diffCall = (w: ReturnType<typeof stopWorld>) => w.gitCalls().find((c) => c.startsWith('diff'))

  it('diffs against HEAD when the repo has no origin/HEAD', async () => {
    const w = stopWorld({ files, changed: ['a.ts'] })
    await runHook(stopRaw, ROOT, w.deps)
    expect(diffCall(w)).toBe('diff -z --name-only --relative --diff-filter=d HEAD')
  })

  it('diffs against the merge-base with origin/HEAD, so committed work still counts', async () => {
    const w = stopWorld({ files, originHead: 'origin/main', mergeBase: 'abc123', changed: ['src/a.ts'] })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(w.gitCalls()).toContain('symbolic-ref --short refs/remotes/origin/HEAD')
    expect(w.gitCalls()).toContain('merge-base origin/main HEAD')
    expect(diffCall(w)).toBe('diff -z --name-only --relative --diff-filter=d abc123')
    expect(out.exitCode).toBe(0)
    expect(w.commandCalls()).toHaveLength(2)
  })

  it('blocks a rule violation in a file that is already committed on the branch', async () => {
    const w = stopWorld({
      files: { ...files, '/repo/src/core/x.ts': "import fs from 'fs'" },
      originHead: 'origin/main',
      mergeBase: 'abc123',
      changed: ['src/core/x.ts'],
    })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('src/core/x.ts:1:0 imports "fs"')
  })

  it('uses "base" from the config and skips auto-detection', async () => {
    const config = stopConfig({ base: 'origin/develop' })
    const w = stopWorld({
      files: { '/repo/agent-gate.json': config },
      originHead: 'origin/main',
      mergeBase: 'def456',
      changed: ['a.ts'],
    })
    await runHook(stopRaw, ROOT, w.deps)
    expect(w.gitCalls()).toContain('merge-base origin/develop HEAD')
    expect(w.gitCalls().some((c) => c.startsWith('symbolic-ref'))).toBe(false)
    expect(diffCall(w)).toContain('def456')
  })

  it('exits 1 (non-blocking) when a configured base cannot be resolved', async () => {
    const w = stopWorld({
      files: { '/repo/agent-gate.json': stopConfig({ base: 'origin/nope' }) },
      changed: ['a.ts'],
    })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('origin/nope')
    expect(w.commandCalls()).toEqual([])
  })

  it('falls back to HEAD when origin/HEAD exists but there is no merge-base (e.g. a shallow clone)', async () => {
    const w = stopWorld({ files, originHead: 'origin/main', changed: ['a.ts'] })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(0)
    expect(diffCall(w)).toContain(' HEAD')
    expect(w.commandCalls()).toHaveLength(2)
  })
})

describe('runHook — stop: odd file lists', () => {
  const files = { '/repo/agent-gate.json': stopConfig() }

  it('asks git for NUL-separated names so paths are never quoted', async () => {
    const w = stopWorld({ files, changed: ['a.ts'], untracked: ['b.ts'] })
    await runHook(stopRaw, ROOT, w.deps)
    expect(w.gitCalls().find((c) => c.startsWith('ls-files'))).toBe('ls-files -z --others --exclude-standard')
  })

  it('checks a file whose name is not ASCII', async () => {
    const w = stopWorld({
      files: { ...files, '/repo/src/core/สวัสดี.ts': "import fs from 'fs'" },
      untracked: ['src/core/สวัสดี.ts'],
    })
    const out = await runHook(stopRaw, ROOT, w.deps)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('src/core/สวัสดี.ts:1:0 imports "fs"')
  })

  it('runs a {files} command in batches and stops at the first failing batch', async () => {
    const changed = Array.from({ length: 4000 }, (_, i) => `src/generated/some-quite-long-file-name-${i}.ts`)
    const config = stopConfig({ commands: [{ name: 'lint', run: ['lint', '{files}'] }] })
    const passing = stopWorld({ files: { '/repo/agent-gate.json': config }, changed })
    expect((await runHook(stopRaw, ROOT, passing.deps)).exitCode).toBe(0)
    const calls = passing.commandCalls()
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.flatMap((c) => c.slice(1))).toEqual(changed)

    const failing = stopWorld({
      files: { '/repo/agent-gate.json': config },
      changed,
      commands: { [calls[0].join(' ')]: { exitCode: 1, stdout: 'lint error', stderr: '', timedOut: false } },
    })
    const out = await runHook(stopRaw, ROOT, failing.deps)
    expect(out.exitCode).toBe(2)
    expect(failing.commandCalls()).toHaveLength(1)
  })
})

// ── Session baseline ──────────────────────────────────────────────────────────


describe('runHook — session start', () => {
  const claudeStart = (id: string, source?: string) =>
    JSON.stringify({ session_id: id, cwd: ROOT, hook_event_name: 'SessionStart', ...(source && { source }) })
  const BASELINE = '/tmp/agent-gate/sess-1.json'
  const config = stopConfig()

  it('saves head, stash and guard-file hashes, and prints nothing', async () => {
    const w = stopWorld({
      files: { '/repo/agent-gate.json': config, '/repo/.kiro/hooks/a.json': '{"hooks":[]}' },
      head: 'abc123',
      stash: 'beef',
      dirs: { '/repo/.kiro/hooks': ['a.json'] },
    })
    const out = await runHook(claudeStart('sess-1', 'startup'), ROOT, w.deps)
    expect(out).toEqual({ exitCode: 0, stdout: '', stderr: '' })
    expect(w.writes).toEqual([BASELINE])
    expect(JSON.parse(w.store[BASELINE])).toEqual({
      head: 'abc123',
      stash: 'beef',
      guard: {
        'agent-gate.json': hashContent(config),
        '.claude/settings.json': null,
        '.claude/settings.local.json': null,
        '.kiro/hooks/a.json': hashContent('{"hooks":[]}'),
      },
    })
  })

  it('stores hashes, never file contents', async () => {
    const w = stopWorld({ files: { '/repo/.claude/settings.json': 'SECRET-TOKEN-123' }, head: 'a' })
    await runHook(claudeStart('sess-1'), ROOT, w.deps)
    expect(w.store[BASELINE]).not.toContain('SECRET-TOKEN-123')
  })

  it('records null for a repo without commits or a stash', async () => {
    const w = stopWorld({})
    await runHook(claudeStart('sess-1'), ROOT, w.deps)
    const saved = JSON.parse(w.store[BASELINE])
    expect(saved.head).toBeNull()
    expect(saved.stash).toBeNull()
  })

  it('does not need agent-gate.json to exist', async () => {
    const w = stopWorld({ head: 'a' })
    expect((await runHook(claudeStart('sess-1'), ROOT, w.deps)).exitCode).toBe(0)
    expect(w.writes).toHaveLength(1)
  })

  it('replaces an older baseline on startup or resume', async () => {
    const w = stopWorld({ head: 'new', files: { [BASELINE]: JSON.stringify({ head: 'old', stash: null, guard: {} }) } })
    await runHook(claudeStart('sess-1', 'resume'), ROOT, w.deps)
    expect(JSON.parse(w.store[BASELINE]).head).toBe('new')
  })

  it('keeps the existing baseline when the session is only being compacted', async () => {
    const w = stopWorld({ head: 'new', files: { [BASELINE]: JSON.stringify({ head: 'old', stash: null, guard: {} }) } })
    await runHook(claudeStart('sess-1', 'compact'), ROOT, w.deps)
    expect(w.writes).toEqual([])
    expect(JSON.parse(w.store[BASELINE]).head).toBe('old')
  })

  it('still writes a baseline on compact when none exists yet', async () => {
    const w = stopWorld({ head: 'a' })
    await runHook(claudeStart('sess-1', 'compact'), ROOT, w.deps)
    expect(w.writes).toEqual([BASELINE])
  })

  it('does not write for a session id that is unsafe in a path', async () => {
    const w = stopWorld({ head: 'a' })
    const out = await runHook(claudeStart('../../etc/x'), ROOT, w.deps)
    expect(out.exitCode).toBe(0)
    expect(w.writes).toEqual([])
  })

  it('exits 1 (non-blocking) when the baseline cannot be written', async () => {
    const w = stopWorld({ head: 'a' })
    const deps: Deps = {
      ...w.deps,
      writeFile: () => {
        throw new Error('EACCES: permission denied')
      },
    }
    const out = await runHook(claudeStart('sess-1'), ROOT, deps)
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('EACCES')
  })

  it('works for Kiro, which sends no source', async () => {
    const w = stopWorld({ head: 'a' })
    const raw = JSON.stringify({ session_id: 'sess_9', hook_event_name: 'SessionStart', cwd: ROOT })
    const out = await runHook(raw, ROOT, w.deps, 'kiro')
    expect(out).toEqual({ exitCode: 0, stdout: '', stderr: '' })
    expect(w.writes).toEqual(['/tmp/agent-gate/sess_9.json'])
  })
})

describe('runHook — stop with a session baseline', () => {
  const BASELINE = '/tmp/agent-gate/sess-1.json'
  const config = stopConfig()
  const guardHashes = {
    'agent-gate.json': hashContent(config),
    '.claude/settings.json': null,
    '.claude/settings.local.json': null,
  }
  const baseline = (over: object = {}) =>
    JSON.stringify({ head: 'start123', stash: null, guard: guardHashes, ...over })
  const stopFor = (id?: string) =>
    JSON.stringify({ cwd: ROOT, hook_event_name: 'Stop', ...(id && { session_id: id }) })

  const world = (w: World = {}) =>
    stopWorld({
      files: { '/repo/agent-gate.json': config, [BASELINE]: baseline(), ...w.files },
      head: 'start123',
      ...w,
      ...{ files: { '/repo/agent-gate.json': config, [BASELINE]: baseline(), ...w.files } },
    })

  it('allows when nothing changed since the baseline', async () => {
    const w = world()
    expect(await runHook(stopFor('sess-1'), ROOT, w.deps)).toEqual({ exitCode: 0, stdout: '', stderr: '' })
    expect(w.commandCalls()).toEqual([])
  })

  it('blocks when a stash appeared, even though no file changed', async () => {
    const w = world({ stash: 'beef' })
    const out = await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('[session] git stash changed')
    expect(w.commandCalls()).toEqual([])
  })

  it('allows a stash that was already there when the session started', async () => {
    const w = world({ stash: 'beef', files: { [BASELINE]: baseline({ stash: 'beef' }) } })
    expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(0)
  })

  it('blocks when a guard file was changed behind the guard (e.g. with sed)', async () => {
    const w = world({ files: { '/repo/agent-gate.json': '{"rules":[]}' } })
    const out = await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('[session] agent-gate.json controls the checks and changed')
  })

  it('blocks when a new hook file appeared in .kiro/hooks', async () => {
    const w = world({ files: { '/repo/.kiro/hooks/evil.json': '{}' }, dirs: { '/repo/.kiro/hooks': ['evil.json'] } })
    const out = await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('.kiro/hooks/evil.json')
  })

  it('also checks files that were committed since the session started', async () => {
    const w = world({
      files: { '/repo/src/core/x.ts': "import fs from 'fs'" },
      diffs: { HEAD: [], start123: ['src/core/x.ts'] },
    })
    const out = await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('src/core/x.ts:1:0 imports "fs"')
    expect(w.gitCalls().filter((c) => c.startsWith('diff')).some((c) => c.endsWith(' start123'))).toBe(true)
  })

  it('checks only what changed since the session started, not the whole branch', async () => {
    const config2 = stopConfig({ commands: [{ name: 'lint', run: ['lint', '{files}'] }] })
    const w = world({
      files: { '/repo/agent-gate.json': config2, [BASELINE]: baseline({ guard: { ...guardHashes, 'agent-gate.json': hashContent(config2) } }) },
      diffs: { HEAD: ['a.ts', 'b.ts'], start123: ['b.ts', 'c.ts'] },
    })
    await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(w.commandCalls()).toEqual([['lint', 'b.ts', 'c.ts']])
  })

  it('ignores a violation committed on the branch before the session started', async () => {
    const w = world({
      files: { '/repo/src/core/old.ts': "import fs from 'fs'" },
      originHead: 'origin/main',
      mergeBase: 'base999',
      diffs: { base999: ['src/core/old.ts'], start123: ['src/new.ts'] },
    })
    const out = await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(out).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('falls back to the whole branch when the baseline commit no longer exists', async () => {
    const w = world({
      files: { '/repo/src/core/old.ts': "import fs from 'fs'" },
      originHead: 'origin/main',
      mergeBase: 'base999',
      diffs: { base999: ['src/core/old.ts'] },
    })
    expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
  })

  it('ignores the session diff when the baseline commit no longer exists', async () => {
    const w = world({ diffs: { HEAD: ['a.ts'] } })
    const out = await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(out.exitCode).toBe(0)
    expect(w.commandCalls()).toHaveLength(2)
  })

  it('reports session problems together with rule violations and skips commands', async () => {
    const w = world({
      stash: 'beef',
      files: { '/repo/src/core/x.ts': "import fs from 'fs'" },
      changed: ['src/core/x.ts'],
    })
    const out = await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(out.stderr).toContain('2 problems')
    expect(out.stderr).toContain('[session] git stash changed')
    expect(out.stderr).toContain('[fcis-core-pure] src/core/x.ts')
    expect(w.commandCalls()).toEqual([])
  })

  it('behaves as before when there is no baseline for the session', async () => {
    const w = stopWorld({ files: { '/repo/agent-gate.json': config }, stash: 'beef', changed: ['a.ts'] })
    const out = await runHook(stopFor('sess-1'), ROOT, w.deps)
    expect(out.exitCode).toBe(0)
    expect(w.gitCalls().some((c) => c.startsWith('rev-parse'))).toBe(false)
  })

  it('behaves as before when the baseline file is corrupt', async () => {
    const w = world({ files: { [BASELINE]: 'not json' }, stash: 'beef' })
    expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(0)
  })

  it('does not look for a baseline when the Stop payload has no session id', async () => {
    const w = world({ stash: 'beef' })
    expect((await runHook(stopFor(), ROOT, w.deps)).exitCode).toBe(0)
  })

  describe('does not block twice on the same problem (Kiro sends no retry flag)', () => {
    const bad = { '/repo/src/core/x.ts': "import fs from 'fs'" }
    const badWorld = (over: World = {}) => world({ files: bad, changed: ['src/core/x.ts'], ...over })

    it('blocks the first time, then warns when the same problem comes back', async () => {
      const w = badWorld()
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
      const again = await runHook(stopFor('sess-1'), ROOT, w.deps)
      expect(again.exitCode).toBe(1)
      expect(again.stderr).toContain('src/core/x.ts:1:0 imports "fs"')
    })

    it('blocks again when the problem is different', async () => {
      const w = badWorld()
      await runHook(stopFor('sess-1'), ROOT, w.deps)
      w.store['/repo/src/core/x.ts'] = "\nimport fs from 'fs'"
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
    })

    it('forgets the problem once a Stop is clean, so it blocks if it returns', async () => {
      const w = badWorld()
      await runHook(stopFor('sess-1'), ROOT, w.deps)
      w.store['/repo/src/core/x.ts'] = 'export const a = 1'
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(0)
      w.store['/repo/src/core/x.ts'] = "import fs from 'fs'"
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
    })

    it('treats a failing command with changing output as the same problem', async () => {
      const w = world({
        changed: ['src/a.ts'],
        commands: { 'bun run typecheck': { exitCode: 1, stdout: 'error 1', stderr: '', timedOut: false } },
      })
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
      const git = w.deps.runCommand
      w.deps.runCommand = async (argv, opts) =>
        argv[0] === 'git' ? git(argv, opts) : { exitCode: 1, stdout: 'error 1 (12ms)', stderr: '', timedOut: false }
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(1)
    })

    it('still blocks when the memory cannot be saved', async () => {
      const w = badWorld()
      w.deps.writeFile = () => {
        throw new Error('read-only')
      }
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
    })

    it('always blocks when there is no baseline to remember in', async () => {
      const w = stopWorld({ files: { '/repo/agent-gate.json': config, ...bad }, changed: ['src/core/x.ts'] })
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
      expect((await runHook(stopFor('sess-1'), ROOT, w.deps)).exitCode).toBe(2)
      expect(w.writes).toEqual([])
    })

    it('works for Kiro: second identical block is a warning, not decision:block', async () => {
      const w = badWorld()
      const raw = JSON.stringify({ session_id: 'sess-1', hook_event_name: 'Stop', cwd: ROOT })
      expect(JSON.parse((await runHook(raw, ROOT, w.deps, 'kiro')).stdout).decision).toBe('block')
      const again = await runHook(raw, ROOT, w.deps, 'kiro')
      expect(again.exitCode).toBe(1)
      expect(again.stdout).toBe('')
    })
  })

  it('reports session problems to Kiro as a decision:block JSON', async () => {
    const w = world({ stash: 'beef' })
    const raw = JSON.stringify({ session_id: 'sess-1', hook_event_name: 'Stop', cwd: ROOT })
    const out = await runHook(raw, ROOT, w.deps, 'kiro')
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.stdout).reason).toContain('[session] git stash changed')
  })
})

describe('runHook — stop retry (stop_hook_active)', () => {
  const retryRaw = (active: boolean) =>
    JSON.stringify({ cwd: ROOT, hook_event_name: 'Stop', stop_hook_active: active })
  const violating = () =>
    stopWorld({
      files: { '/repo/agent-gate.json': stopConfig(), '/repo/src/core/x.ts': "import fs from 'fs'" },
      changed: ['src/core/x.ts'],
    })

  it('blocks on the first Stop', async () => {
    expect((await runHook(retryRaw(false), ROOT, violating().deps)).exitCode).toBe(2)
  })

  it('does not block again on a retry: exits 1 and still reports the problem', async () => {
    const out = await runHook(retryRaw(true), ROOT, violating().deps)
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('src/core/x.ts:1:0 imports "fs"')
  })

  it('allows silently on a retry when everything is clean', async () => {
    const w = stopWorld({ files: { '/repo/agent-gate.json': stopConfig() } })
    expect(await runHook(retryRaw(true), ROOT, w.deps)).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })
})
