import { describe, it, expect } from 'bun:test'
import { parseKiroInput, formatKiroOutput } from '../src/core/kiro.js'

const CWD = '/proj'

// Shapes captured from kiro-cli 3.5.0 (V3).
const pre = (tool_name: string, tool_input: object) =>
  JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', cwd: CWD, tool_name, tool_input })

describe('parseKiroInput', () => {
  it('maps an fs_write PreToolUse with an absolute path', () => {
    expect(parseKiroInput(pre('fs_write', { path: '/proj/hello.txt', text: 'hi' }))).toEqual({
      kind: 'pre-edit',
      agent: 'kiro',
      cwd: CWD,
      tool: 'fs_write',
      files: ['/proj/hello.txt'],
    })
  })

  it('maps a str_replace PreToolUse and resolves a relative path against cwd', () => {
    const event = parseKiroInput(
      pre('str_replace', { path: 'src/a.ts', oldStr: 'hi', newStr: 'hello', replace_all: false }),
    )
    expect(event).toEqual({
      kind: 'pre-edit',
      agent: 'kiro',
      cwd: CWD,
      tool: 'str_replace',
      files: ['/proj/src/a.ts'],
    })
  })

  it('normalizes ./ and .. in a relative path', () => {
    const event = parseKiroInput(pre('fs_write', { path: './src/../agent-gate.json', text: '' }))
    expect(event.kind === 'pre-edit' && event.files).toEqual(['/proj/agent-gate.json'])
  })

  it('ignores PostToolUse: Kiro does not show its output to the agent', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      cwd: CWD,
      tool_name: 'fs_write',
      tool_input: { path: '/proj/a.txt', text: 'x' },
      tool_response: 'Created',
    })
    expect(parseKiroInput(raw).kind).toBe('ignored')
  })

  it('maps Stop (it has no retry flag)', () => {
    const raw = JSON.stringify({ session_id: 's', hook_event_name: 'Stop', cwd: CWD })
    expect(parseKiroInput(raw)).toEqual({ kind: 'stop', agent: 'kiro', cwd: CWD, retry: false })
  })

  it('ignores PreToolUse from tools that are not file writes', () => {
    expect(parseKiroInput(pre('fs_read', { path: '/proj/a.txt' })).kind).toBe('ignored')
  })

  it('ignores a write tool without a path', () => {
    expect(parseKiroInput(pre('fs_write', { text: 'x' })).kind).toBe('ignored')
  })

  it('ignores invalid JSON, a non-object, a missing cwd, and unknown events', () => {
    expect(parseKiroInput('nope').kind).toBe('ignored')
    expect(parseKiroInput('null').kind).toBe('ignored')
    expect(parseKiroInput(JSON.stringify({ hook_event_name: 'Stop' })).kind).toBe('ignored')
    expect(parseKiroInput(JSON.stringify({ hook_event_name: 'SessionStart', cwd: CWD })).kind).toBe('ignored')
  })
})

describe('formatKiroOutput', () => {
  it('allow → exit 0, no output', () => {
    expect(formatKiroOutput({ action: 'allow' }, 'stop')).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('block on pre-edit → exit 2 with the reason on stderr (verified: reaches the agent)', () => {
    expect(formatKiroOutput({ action: 'block', reason: 'protected' }, 'pre-edit')).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'protected',
    })
  })

  it('block on stop → exit 0 with a decision:block JSON on stdout (verified: agent continues)', () => {
    const out = formatKiroOutput({ action: 'block', reason: 'fix it\nline 2' }, 'stop')
    expect(out.exitCode).toBe(0)
    expect(out.stderr).toBe('')
    expect(JSON.parse(out.stdout)).toEqual({ decision: 'block', reason: 'fix it\nline 2' })
  })

  it('warn → exit 1 with the message on stderr', () => {
    expect(formatKiroOutput({ action: 'warn', message: 'slow' }, 'stop')).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'slow',
    })
  })
})
