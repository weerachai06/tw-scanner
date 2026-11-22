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
  it('merges outputs, drops blanks and duplicates', () => {
    expect(parseGitFiles('a.ts\nb.ts\n', 'b.ts\nc.ts\n\n')).toEqual(['a.ts', 'b.ts', 'c.ts'])
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
