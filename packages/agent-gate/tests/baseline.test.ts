import { describe, it, expect } from 'bun:test'
import { baselinePath, hashContent, parseBaseline, tamperProblems } from '../src/core/baseline.js'
import type { Snapshot } from '../src/core/types.js'

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  head: 'abc123',
  stash: null,
  guard: { 'agent-gate.json': 'h1', '.claude/settings.json': null },
  ...over,
})

describe('baselinePath', () => {
  it('puts the baseline in an agent-gate folder under the temp dir', () => {
    expect(baselinePath('/tmp', 'sess_59b4dcfc-af67-45f1')).toBe('/tmp/agent-gate/sess_59b4dcfc-af67-45f1.json')
  })

  it('handles a temp dir with a trailing slash', () => {
    expect(baselinePath('/var/T/', 'abc')).toBe('/var/T/agent-gate/abc.json')
  })

  it.each(['', '../evil', 'a/b', 'a b', 'x'.repeat(101), 'name.json', '..'])(
    'refuses %j: it is not safe to use in a path',
    (id) => {
      expect(baselinePath('/tmp', id)).toBeNull()
    },
  )
})

describe('hashContent', () => {
  it('is stable and differs for different text', () => {
    expect(hashContent('a')).toBe(hashContent('a'))
    expect(hashContent('a')).not.toBe(hashContent('b'))
    expect(hashContent('a')).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('parseBaseline', () => {
  it('round-trips a snapshot', () => {
    const s = snap({ stash: 'dead' })
    expect(parseBaseline(JSON.stringify(s))).toEqual(s)
  })

  it.each([null, '', 'nope', '[]', '{}', '{"head":1}', '{"head":null,"stash":null}', '{"head":null,"stash":null,"guard":{"a":5}}'])(
    'returns null for %j',
    (raw) => {
      expect(parseBaseline(raw)).toBeNull()
    },
  )
})

describe('tamperProblems', () => {
  it('reports nothing when nothing changed', () => {
    expect(tamperProblems(snap(), snap())).toEqual([])
  })

  it('reports a stash that appeared during the session', () => {
    const problems = tamperProblems(snap(), snap({ stash: 'beef' }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('[session]')
    expect(problems[0]).toContain('git stash')
  })

  it('ignores a stash that was already there and is unchanged', () => {
    expect(tamperProblems(snap({ stash: 'beef' }), snap({ stash: 'beef' }))).toEqual([])
  })

  it('reports a stash that was added on top of an older one', () => {
    expect(tamperProblems(snap({ stash: 'old' }), snap({ stash: 'new' }))).toHaveLength(1)
  })

  it('reports a changed guard file by name', () => {
    const now = snap({ guard: { 'agent-gate.json': 'h2', '.claude/settings.json': null } })
    const problems = tamperProblems(snap(), now)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('agent-gate.json')
  })

  it('reports a deleted guard file', () => {
    const now = snap({ guard: { 'agent-gate.json': null, '.claude/settings.json': null } })
    expect(tamperProblems(snap(), now)).toHaveLength(1)
  })

  it('reports a guard file that was created', () => {
    const now = snap({ guard: { 'agent-gate.json': 'h1', '.claude/settings.json': 'new' } })
    expect(tamperProblems(snap(), now)[0]).toContain('.claude/settings.json')
  })

  it('treats a file missing from one side as absent', () => {
    const now = snap({ guard: { 'agent-gate.json': 'h1' } })
    expect(tamperProblems(snap(), now)).toEqual([])
    const withNew = snap({ guard: { 'agent-gate.json': 'h1', '.kiro/hooks/x.json': 'z' } })
    expect(tamperProblems(snap(), withNew)[0]).toContain('.kiro/hooks/x.json')
  })

  it('a moved HEAD alone is not tampering', () => {
    expect(tamperProblems(snap(), snap({ head: 'other' }))).toEqual([])
  })
})
