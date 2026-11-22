import { describe, it, expect } from 'bun:test'
import { parseClaudeInput, formatClaudeOutput } from '../src/core/claude.js'

const payload = (extra: Record<string, unknown>) =>
  JSON.stringify({ session_id: 's', cwd: '/repo', ...extra })

describe('parseClaudeInput', () => {
  it('maps a Write PostToolUse to an edit event', () => {
    const event = parseClaudeInput(
      payload({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/repo/src/a.ts' },
      }),
    )
    expect(event).toEqual({
      kind: 'edit',
      agent: 'claude',
      cwd: '/repo',
      tool: 'Write',
      files: ['/repo/src/a.ts'],
    })
  })

  it('maps an Edit PostToolUse to an edit event', () => {
    const event = parseClaudeInput(
      payload({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/src/b.ts' },
      }),
    )
    expect(event.kind).toBe('edit')
  })

  it('ignores PostToolUse from other tools', () => {
    const event = parseClaudeInput(
      payload({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      }),
    )
    expect(event.kind).toBe('ignored')
  })

  it('ignores an edit tool with no file_path', () => {
    const event = parseClaudeInput(
      payload({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: {} }),
    )
    expect(event.kind).toBe('ignored')
  })

  it('maps a Write PreToolUse to a pre-edit event', () => {
    const event = parseClaudeInput(
      payload({
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/repo/agent-gate.json' },
      }),
    )
    expect(event).toEqual({
      kind: 'pre-edit',
      agent: 'claude',
      cwd: '/repo',
      tool: 'Write',
      files: ['/repo/agent-gate.json'],
    })
  })

  it('ignores PreToolUse from other tools', () => {
    const event = parseClaudeInput(
      payload({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a' } }),
    )
    expect(event.kind).toBe('ignored')
  })

  it('maps Stop and carries stop_hook_active as retry', () => {
    expect(
      parseClaudeInput(payload({ hook_event_name: 'Stop', stop_hook_active: true })),
    ).toEqual({ kind: 'stop', agent: 'claude', cwd: '/repo', retry: true })
    expect(
      parseClaudeInput(payload({ hook_event_name: 'Stop' })),
    ).toEqual({ kind: 'stop', agent: 'claude', cwd: '/repo', retry: false })
  })

  it('ignores unknown events', () => {
    expect(parseClaudeInput(payload({ hook_event_name: 'SessionStart' })).kind).toBe('ignored')
  })

  it('ignores invalid JSON instead of throwing', () => {
    expect(parseClaudeInput('not json').kind).toBe('ignored')
  })

  it('ignores a payload without cwd', () => {
    const raw = JSON.stringify({ hook_event_name: 'Stop' })
    expect(parseClaudeInput(raw).kind).toBe('ignored')
  })
})

describe('formatClaudeOutput', () => {
  it('allow → exit 0, no output', () => {
    expect(formatClaudeOutput({ action: 'allow' })).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })

  it('warn → exit 1 (non-blocking) with the message on stderr', () => {
    expect(formatClaudeOutput({ action: 'warn', message: 'slow' })).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'slow',
    })
  })

  it('block → exit 2 with the reason on stderr', () => {
    expect(formatClaudeOutput({ action: 'block', reason: 'bad import' })).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'bad import',
    })
  })
})
