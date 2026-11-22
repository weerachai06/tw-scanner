import * as path from 'path'
import type { AgentOutput, Decision, HookEvent } from './types.js'

// Tool names seen in kiro-cli 3.5.0 (V3) for the `write` matcher.
const WRITE_TOOLS = new Set(['fs_write', 'str_replace'])

const ignored = (why: string): HookEvent => ({ kind: 'ignored', agent: 'kiro', why })

/**
 * Kiro only shows the agent what a PreToolUse (exit 2) or Stop (decision:block) hook says.
 * PostToolUse output never reaches it, so PostToolUse is ignored.
 */
export function parseKiroInput(raw: string): HookEvent {
  let data: Record<string, any>
  try {
    data = JSON.parse(raw)
  } catch {
    return ignored('stdin is not valid JSON')
  }
  if (!data || typeof data !== 'object') return ignored('stdin is not a JSON object')
  if (typeof data.cwd !== 'string') return ignored('payload has no cwd')

  const cwd: string = data.cwd

  const sessionId = typeof data.session_id === 'string' ? data.session_id : undefined

  if (data.hook_event_name === 'SessionStart') {
    if (sessionId === undefined) return ignored('SessionStart payload has no session_id')
    return { kind: 'session-start', agent: 'kiro', cwd, sessionId }
  }

  if (data.hook_event_name === 'Stop') {
    return { kind: 'stop', agent: 'kiro', cwd, retry: false, ...(sessionId && { sessionId }) }
  }

  if (data.hook_event_name === 'PreToolUse') {
    const tool = data.tool_name
    const file = data.tool_input?.path
    if (!WRITE_TOOLS.has(tool)) return ignored(`tool ${tool} is not a file write`)
    if (typeof file !== 'string') return ignored(`${tool} payload has no path`)
    // Kiro sends absolute and relative paths; relative ones are relative to cwd.
    const abs = path.posix.isAbsolute(file) ? path.posix.normalize(file) : path.posix.join(cwd, file)
    return { kind: 'pre-edit', agent: 'kiro', cwd, tool, files: [abs] }
  }

  return ignored(`event ${data.hook_event_name} is not handled`)
}

export function formatKiroOutput(decision: Decision, kind: HookEvent['kind']): AgentOutput {
  if (decision.action === 'warn') return { exitCode: 1, stdout: '', stderr: decision.message }
  if (decision.action === 'block') {
    return kind === 'stop'
      ? { exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason: decision.reason }), stderr: '' }
      : { exitCode: 2, stdout: '', stderr: decision.reason }
  }
  return { exitCode: 0, stdout: '', stderr: '' }
}
