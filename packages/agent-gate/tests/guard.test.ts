import { describe, it, expect } from 'bun:test'
import { guard } from '../src/core/guard.js'

describe('guard', () => {
  it('allows ordinary source files', () => {
    expect(guard(['src/a.ts', 'README.md'])).toEqual({ action: 'allow' })
  })

  it.each([
    'agent-gate.json',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.kiro/hooks/capture.json',
  ])('blocks edits to %s', (file) => {
    const decision = guard(['src/a.ts', file])
    expect(decision.action).toBe('block')
    if (decision.action === 'block') {
      expect(decision.reason).toContain(file)
      expect(decision.reason).toContain('agent-gate')
    }
  })

  it('does not block similarly named files elsewhere', () => {
    expect(guard(['docs/agent-gate.json.md', 'src/.claude/other.json'])).toEqual({ action: 'allow' })
  })
})
