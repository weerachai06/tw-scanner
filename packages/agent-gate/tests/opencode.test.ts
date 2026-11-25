import { describe, it, expect } from 'bun:test'
import { parseOpencodeInput } from '../src/core/opencode.js'

const CWD = '/proj'

const pre = (tool_name: string, tool_input: object) =>
  JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', cwd: CWD, tool_name, tool_input })

describe('parseOpencodeInput', () => {
  it('maps an edit PreToolUse with an absolute filePath (V1 tools)', () => {
    expect(parseOpencodeInput(pre('edit', { filePath: '/proj/src/a.ts', oldString: 'a', newString: 'b' }))).toEqual({
      kind: 'pre-edit',
      agent: 'opencode',
      cwd: CWD,
      tool: 'edit',
      files: ['/proj/src/a.ts'],
    })
  })

  it('maps a write PreToolUse with a relative path (newer tools) against cwd', () => {
    const event = parseOpencodeInput(pre('write', { path: './src/../agent-gate.json', content: '' }))
    expect(event.kind === 'pre-edit' && event.files).toEqual(['/proj/agent-gate.json'])
  })

  it('maps a patch PreToolUse to every file it names, including moves', () => {
    const patchText = [
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+export const a = 1',
      '*** Update File: agent-gate.json',
      '*** Move to: docs/gate.json',
      '@@',
      '-a',
      '+b',
      '*** Delete File: /proj/old.ts',
      '*** End Patch',
    ].join('\n')
    const event = parseOpencodeInput(pre('patch', { patchText }))
    expect(event.kind === 'pre-edit' && event.files).toEqual([
      '/proj/src/new.ts',
      '/proj/agent-gate.json',
      '/proj/docs/gate.json',
      '/proj/old.ts',
    ])
  })

  it('ignores a patch with no file lines, and a write tool without a path', () => {
    expect(parseOpencodeInput(pre('patch', { patchText: 'nothing' })).kind).toBe('ignored')
    expect(parseOpencodeInput(pre('patch', {})).kind).toBe('ignored')
    expect(parseOpencodeInput(pre('write', { content: 'x' })).kind).toBe('ignored')
    expect(parseOpencodeInput(pre('edit', { filePath: 5 })).kind).toBe('ignored')
  })

  it('ignores tools that are not file writes', () => {
    expect(parseOpencodeInput(pre('read', { filePath: '/proj/a.ts' })).kind).toBe('ignored')
    expect(parseOpencodeInput(pre('shell', { command: 'ls' })).kind).toBe('ignored')
  })

  it('maps SessionStart with its session id', () => {
    const raw = JSON.stringify({ session_id: 'ses_1', hook_event_name: 'SessionStart', cwd: CWD })
    expect(parseOpencodeInput(raw)).toEqual({ kind: 'session-start', agent: 'opencode', cwd: CWD, sessionId: 'ses_1' })
  })

  it('ignores SessionStart without a session id', () => {
    expect(parseOpencodeInput(JSON.stringify({ hook_event_name: 'SessionStart', cwd: CWD })).kind).toBe('ignored')
  })

  it('maps Stop and carries stop_hook_active as retry', () => {
    const stop = (extra: object) => JSON.stringify({ session_id: 's', hook_event_name: 'Stop', cwd: CWD, ...extra })
    expect(parseOpencodeInput(stop({ stop_hook_active: true }))).toEqual({
      kind: 'stop',
      agent: 'opencode',
      cwd: CWD,
      retry: true,
      sessionId: 's',
    })
    expect(parseOpencodeInput(stop({}))).toMatchObject({ kind: 'stop', retry: false })
  })

  it('maps Stop without a session id', () => {
    expect(parseOpencodeInput(JSON.stringify({ hook_event_name: 'Stop', cwd: CWD }))).toEqual({
      kind: 'stop',
      agent: 'opencode',
      cwd: CWD,
      retry: false,
    })
  })

  it('ignores invalid JSON, a non-object, a missing cwd, and unknown events', () => {
    expect(parseOpencodeInput('nope').kind).toBe('ignored')
    expect(parseOpencodeInput('null').kind).toBe('ignored')
    expect(parseOpencodeInput(JSON.stringify({ hook_event_name: 'Stop' })).kind).toBe('ignored')
    expect(parseOpencodeInput(JSON.stringify({ hook_event_name: 'PostToolUse', cwd: CWD })).kind).toBe('ignored')
  })
})
