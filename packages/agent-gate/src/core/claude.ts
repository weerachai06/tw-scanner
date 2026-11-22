import type { AgentOutput, Decision, HookEvent } from './types.js'

// MultiEdit's payload shape is not confirmed in the Claude Code docs.
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])

function ignored(why: string): HookEvent {
  return { kind: 'ignored', agent: 'claude', why }
}

export function parseClaudeInput(raw: string): HookEvent {
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
    const source = typeof data.source === 'string' ? data.source : undefined
    return { kind: 'session-start', agent: 'claude', cwd, sessionId, ...(source && { source }) }
  }

  if (data.hook_event_name === 'Stop') {
    return {
      kind: 'stop',
      agent: 'claude',
      cwd,
      retry: data.stop_hook_active === true,
      ...(sessionId && { sessionId }),
    }
  }

  if (data.hook_event_name === 'PostToolUse' || data.hook_event_name === 'PreToolUse') {
    const tool = data.tool_name
    const file = data.tool_input?.file_path
    if (!EDIT_TOOLS.has(tool)) return ignored(`tool ${tool} is not a file edit`)
    if (typeof file !== 'string') return ignored(`${tool} payload has no file_path`)
    const kind = data.hook_event_name === 'PreToolUse' ? 'pre-edit' : 'edit'
    return { kind, agent: 'claude', cwd, tool, files: [file] }
  }

  return ignored(`event ${data.hook_event_name} is not handled`)
}

export function formatClaudeOutput(decision: Decision): AgentOutput {
  if (decision.action === 'block') return { exitCode: 2, stdout: '', stderr: decision.reason }
  if (decision.action === 'warn') return { exitCode: 1, stdout: '', stderr: decision.message }
  return { exitCode: 0, stdout: '', stderr: '' }
}
