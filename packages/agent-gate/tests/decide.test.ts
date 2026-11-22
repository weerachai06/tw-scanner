import { describe, it, expect } from 'bun:test'
import { decide } from '../src/core/decide.js'
import type { CommandFailure, Violation } from '../src/core/types.js'

const v = (over: Partial<Violation> = {}): Violation => ({
  ruleId: 'fcis-core-pure',
  kind: 'import',
  file: 'src/core/x.ts',
  line: 3,
  col: 0,
  found: 'node:fs',
  message: 'Core must be pure',
  ...over,
})

describe('decide', () => {
  it('allows when there are no violations', () => {
    expect(decide([])).toEqual({ action: 'allow' })
  })

  it('adds a built-in hint for a known forbidden module or global', () => {
    const reason = (found: string, kind: Violation['kind'] = 'import') => {
      const d = decide([v({ found, kind })])
      return d.action === 'block' ? d.reason : ''
    }
    expect(reason('node:fs')).toContain('Fix: Do not do I/O here.')
    expect(reason('fs/promises')).toContain('Take file contents as an argument')
    expect(reason('Date', 'global')).toContain('Let the shell read the time')
    expect(reason('child_process')).toContain('Return the argv to run')
    expect(reason('fetch', 'global')).toContain('Let the shell make the request')
    expect(reason('useState from "react"', 'import-name')).toContain('Hooks belong in a component')
  })

  it('adds no hint for an unknown module, and lets the rule fix win over the hint', () => {
    const unknown = decide([v({ found: 'lodash' })])
    expect(unknown.action === 'block' && unknown.reason).not.toContain('Fix:')
    const own = decide([v({ found: 'fs', fix: 'use src/exec.ts' })])
    expect(own.action === 'block' && own.reason).toContain('Fix: use src/exec.ts')
    expect(own.action === 'block' && own.reason).not.toContain('Do not do I/O here')
  })

  it('appends the fix after the message when the rule has one', () => {
    const decision = decide([v({ fix: 'Return an effect; run it in src/exec.ts.' })])
    expect(decision.action === 'block' && decision.reason).toContain(
      'Core must be pure Fix: Return an effect; run it in src/exec.ts.',
    )
  })

  it('blocks and lists each violation with file:line', () => {
    const decision = decide([v(), v({ file: 'src/core/y.ts', line: 9, found: 'child_process' })])
    expect(decision.action).toBe('block')
    if (decision.action === 'block') {
      expect(decision.reason).toContain('agent-gate: 2 problems in files you changed.')
      expect(decision.reason).toContain(
        '[fcis-core-pure] src/core/x.ts:3:0 imports "node:fs" — Core must be pure',
      )
      expect(decision.reason).toContain('src/core/y.ts:9:0 imports "child_process"')
    }
  })

  it('uses singular wording for one problem', () => {
    const decision = decide([v()])
    expect(decision.action === 'block' && decision.reason).toContain('1 problem in files')
  })

  it('words import-name and global violations by kind', () => {
    const decision = decide([
      v({ kind: 'import-name', found: 'useState from "react"', message: 'no hooks' }),
      v({ kind: 'global', found: 'fetch', message: 'no io', line: 7, col: 2 }),
    ])
    expect(decision.action === 'block' && decision.reason).toContain(
      '[fcis-core-pure] src/core/x.ts:3:0 imports useState from "react" — no hooks',
    )
    expect(decision.action === 'block' && decision.reason).toContain(
      'src/core/x.ts:7:2 uses global "fetch" — no io',
    )
  })

  it('does not say "imports" for a parse error', () => {
    const decision = decide([v({ ruleId: 'parse-error', kind: 'parse-error', found: 'parse error', message: 'file does not parse: x' })])
    expect(decision.action === 'block' && decision.reason).toContain(
      '[parse-error] src/core/x.ts:3:0 file does not parse: x',
    )
  })
})

const failure = (over: Partial<CommandFailure> = {}): CommandFailure => ({
  name: 'typecheck',
  exitCode: 2,
  timedOut: false,
  output: 'src/core/x.ts(10,5): error TS2322\n… 3 lines omitted',
  reproduce: 'bun run typecheck',
  ...over,
})

describe('decide — command failures', () => {
  it('blocks on a failed command and shows exit code, reproduce line, and output', () => {
    const decision = decide([], [failure()])
    expect(decision.action).toBe('block')
    if (decision.action === 'block') {
      expect(decision.reason).toContain('agent-gate: 1 problem in files you changed.')
      expect(decision.reason).toContain('[typecheck] exit 2 — run: bun run typecheck')
      expect(decision.reason).toContain('  src/core/x.ts(10,5): error TS2322')
      expect(decision.reason).toContain('  … 3 lines omitted')
    }
  })

  it('counts violations and failures together', () => {
    const decision = decide([v()], [failure()])
    expect(decision.action === 'block' && decision.reason).toContain('2 problems')
  })

  it('warns, not blocks, when a command timed out', () => {
    const decision = decide([], [failure({ exitCode: null, timedOut: true, output: '' })])
    expect(decision).toEqual({
      action: 'warn',
      message: 'agent-gate: [typecheck] timed out — not checked. run: bun run typecheck',
    })
  })

  it('warns when a command could not start', () => {
    const decision = decide([], [failure({ exitCode: null, output: 'spawn nope ENOENT' })])
    expect(decision.action).toBe('warn')
    expect(decision.action === 'warn' && decision.message).toContain('spawn nope ENOENT')
  })

  it('blocks when a violation exists even if a command also timed out', () => {
    const decision = decide([v()], [failure({ exitCode: null, timedOut: true })])
    expect(decision.action).toBe('block')
  })
})

describe('decide — session problems', () => {
  const problem = '[session] git stash changed during this session. Restore it.'

  it('blocks on a session problem and prints it verbatim', () => {
    const decision = decide([], [], [problem])
    expect(decision.action).toBe('block')
    if (decision.action === 'block') {
      expect(decision.reason).toContain('agent-gate: 1 problem in files you changed.')
      expect(decision.reason).toContain(problem)
    }
  })

  it('counts session problems with violations and failures, session problems first', () => {
    const decision = decide([v()], [failure()], [problem])
    expect(decision.action === 'block' && decision.reason).toContain('3 problems')
    const reason = decision.action === 'block' ? decision.reason : ''
    expect(reason.indexOf(problem)).toBeLessThan(reason.indexOf('[fcis-core-pure]'))
  })

  it('does not turn a timeout into a block just because there are no problems', () => {
    expect(decide([], [failure({ exitCode: null, timedOut: true })], []).action).toBe('warn')
  })
})

