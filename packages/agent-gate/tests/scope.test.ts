import { describe, it, expect } from 'bun:test'
import { toRelative, parseGitFiles, selectFiles, planCommands } from '../src/core/scope.js'

describe('toRelative', () => {
  it('strips the root from an absolute path', () => {
    expect(toRelative('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
  })

  it('handles a root with a trailing slash', () => {
    expect(toRelative('/repo/src/a.ts', '/repo/')).toBe('src/a.ts')
  })

  it('returns null for a path outside the root', () => {
    expect(toRelative('/other/a.ts', '/repo')).toBeNull()
  })

  it('does not treat a sibling with the same prefix as inside the root', () => {
    expect(toRelative('/repo-two/a.ts', '/repo')).toBeNull()
  })

  it('returns null for the root itself', () => {
    expect(toRelative('/repo', '/repo')).toBeNull()
  })
})

describe('parseGitFiles', () => {
  it('merges NUL-separated outputs, drops blanks and duplicates', () => {
    expect(parseGitFiles('a.ts\0b.ts\0', 'b.ts\0c.ts\0\0')).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('keeps non-ASCII names and names with newlines or quotes as they are', () => {
    expect(parseGitFiles('src/สวัสดี.ts\0we"ird\nname.ts\0', '')).toEqual(['src/สวัสดี.ts', 'we"ird\nname.ts'])
  })

  it('returns nothing for empty output', () => {
    expect(parseGitFiles('', '')).toEqual([])
  })
})

describe('selectFiles', () => {
  it('keeps files matching any glob', () => {
    expect(selectFiles(['a.ts', 'b.md', 'src/c.tsx'], ['**/*.ts', '**/*.tsx'])).toEqual(['a.ts', 'src/c.tsx'])
  })
})

describe('planCommands', () => {
  const changed = ['src/a.ts', 'README.md']

  it('expands {files} to the matching changed files', () => {
    const plan = planCommands(
      [{ name: 'lint', run: ['eslint', '{files}'], files: ['**/*.ts'] }],
      changed,
    )
    expect(plan).toEqual([{ name: 'lint', argv: ['eslint', 'src/a.ts'], timeoutSec: 120 }])
  })

  it('skips a command whose files filter matches nothing', () => {
    const plan = planCommands([{ name: 'lint', run: ['eslint'], files: ['**/*.css'] }], changed)
    expect(plan).toEqual([])
  })

  it('runs a command without a files filter for any change', () => {
    const plan = planCommands([{ name: 'test', run: ['bun', 'test'], timeoutSec: 5 }], changed)
    expect(plan).toEqual([{ name: 'test', argv: ['bun', 'test'], timeoutSec: 5 }])
  })

  it('expands {files} to all changed files when there is no filter', () => {
    const plan = planCommands([{ name: 'x', run: ['x', '{files}'] }], changed)
    expect(plan[0].argv).toEqual(['x', 'src/a.ts', 'README.md'])
  })

  it('keeps order', () => {
    const plan = planCommands(
      [{ name: 'one', run: ['1'] }, { name: 'two', run: ['2'] }],
      changed,
    )
    expect(plan.map((p) => p.name)).toEqual(['one', 'two'])
  })
})

describe('planCommands — batching {files}', () => {
  const many = Array.from({ length: 50 }, (_, i) => `src/dir/file-${String(i).padStart(3, '0')}.ts`)

  it('splits {files} into several runs when the list is too long, keeping order and every file', () => {
    const plan = planCommands([{ name: 'lint', run: ['eslint', '{files}'] }], many, 200)
    expect(plan.length).toBeGreaterThan(1)
    expect(plan.every((p) => p.name === 'lint' && p.argv[0] === 'eslint')).toBe(true)
    expect(plan.flatMap((p) => p.argv.slice(1))).toEqual(many)
    for (const p of plan) expect(p.argv.slice(1).join(' ').length).toBeLessThanOrEqual(200)
  })

  it('keeps one run when the list fits', () => {
    expect(planCommands([{ name: 'lint', run: ['eslint', '{files}'] }], many, 100_000)).toHaveLength(1)
  })

  it('gives a path longer than the budget its own run instead of dropping it', () => {
    const plan = planCommands([{ name: 'x', run: ['x', '{files}'] }], ['a'.repeat(300), 'b.ts'], 100)
    expect(plan.flatMap((p) => p.argv.slice(1))).toEqual(['a'.repeat(300), 'b.ts'])
  })

  it('never splits a command that does not use {files}', () => {
    expect(planCommands([{ name: 't', run: ['bun', 'test'] }], many, 10)).toHaveLength(1)
  })
})
