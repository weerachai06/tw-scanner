import { describe, it, expect } from 'bun:test'
import { summarizeOutput } from '../src/core/summarize.js'

describe('summarizeOutput', () => {
  it('returns short output unchanged', () => {
    expect(summarizeOutput('one\ntwo', [], 100)).toBe('one\ntwo')
  })

  it('strips ANSI colour codes', () => {
    expect(summarizeOutput('\u001b[31merror\u001b[0m TS1', [], 100)).toBe('error TS1')
  })

  it('trims trailing whitespace', () => {
    expect(summarizeOutput('a\n\n', [], 100)).toBe('a')
  })

  it('keeps lines about changed files first when over budget', () => {
    const noise = Array.from({ length: 50 }, (_, i) => `noise line number ${i}`)
    const text = [...noise, 'src/core/x.ts(10,5): error TS2322', ...noise].join('\n')
    const out = summarizeOutput(text, ['src/core/x.ts'], 120)
    expect(out).toContain('src/core/x.ts(10,5): error TS2322')
    expect(out.length).toBeLessThanOrEqual(120 + 40)
  })

  it('prefers error-like lines over plain lines', () => {
    const noise = Array.from({ length: 50 }, (_, i) => `plain output ${i}`)
    const out = summarizeOutput([...noise, 'FAIL tests/a.test.ts', ...noise].join('\n'), [], 100)
    expect(out).toContain('FAIL tests/a.test.ts')
  })

  it('says how many lines were omitted and keeps original order', () => {
    const lines = ['error first', ...Array.from({ length: 40 }, (_, i) => `x${i}`), 'error last']
    const out = summarizeOutput(lines.join('\n'), [], 40)
    expect(out).toMatch(/… \d+ lines omitted/)
    expect(out.indexOf('error first')).toBeLessThan(out.indexOf('error last'))
  })

  it('still returns something when one line is longer than the budget', () => {
    const out = summarizeOutput('x'.repeat(500), [], 50)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(100)
  })
})
