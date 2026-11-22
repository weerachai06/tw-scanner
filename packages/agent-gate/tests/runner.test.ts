import { describe, it, expect } from 'bun:test'
import { runHook, type Deps } from '../src/runner.js'
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
  /** Result per full command line (argv joined by spaces), default exit 0. */
  commands?: Record<string, CommandOutcome>
}

function stopWorld(world: World) {
  const calls: string[][] = []
  const deps: Deps = {
    readFile: (p) => (world.files ?? {})[p] ?? null,
    runCommand: async (argv) => {
      calls.push(argv)
      if (argv[0] === 'git') {
        if (world.gitFails) return { exitCode: 128, stdout: '', stderr: 'not a git repository', timedOut: false }
        return ok((argv[1] === 'diff' ? world.changed ?? [] : world.untracked ?? []).join('\n'))
      }
      return (world.commands ?? {})[argv.join(' ')] ?? ok()
    },
  }
  return { deps, calls, commandCalls: () => calls.filter((c) => c[0] !== 'git') }
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
