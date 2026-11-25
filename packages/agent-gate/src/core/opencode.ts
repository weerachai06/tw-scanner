import * as path from 'path'
import type { HookEvent } from './types.js'

// Built-in tools that write files. `patch` can touch several files in one call.
const WRITE_TOOLS = new Set(['edit', 'write', 'patch'])

const PATCH_PATH = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

const ignored = (why: string): HookEvent => ({ kind: 'ignored', agent: 'opencode', why })

/** Paths named in a `patch` tool's `patchText`. */
function patchPaths(patchText: unknown): string[] {
  return typeof patchText === 'string' ? [...patchText.matchAll(PATCH_PATH)].map((m) => m[1].trim()) : []
}

/**
 * The payload comes from the OpenCode plugin in `opencode/agent-gate.js`, which forwards what
 * OpenCode gave its hooks, in the same shape Claude Code uses: `hook_event_name`, `cwd`,
 * `session_id`, `tool_name`, `tool_input`. OpenCode has no command hooks, so only a plugin can call us.
 * `stop_hook_active` is set by the plugin when it already sent the agent back once this turn.
 */
export function parseOpencodeInput(raw: string): HookEvent {
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
    return { kind: 'session-start', agent: 'opencode', cwd, sessionId }
  }

  if (data.hook_event_name === 'Stop') {
    return {
      kind: 'stop',
      agent: 'opencode',
      cwd,
      retry: data.stop_hook_active === true,
      ...(sessionId && { sessionId }),
    }
  }

  if (data.hook_event_name === 'PreToolUse') {
    const tool = data.tool_name
    if (!WRITE_TOOLS.has(tool)) return ignored(`tool ${tool} is not a file write`)
    // OpenCode versions differ: `filePath` in V1 tools, `path` in newer ones.
    const input = data.tool_input ?? {}
    const named = tool === 'patch' ? patchPaths(input.patchText) : [input.filePath ?? input.path]
    const files = named.filter((f): f is string => typeof f === 'string' && f !== '')
    if (files.length === 0) return ignored(`${tool} payload has no file path`)
    // Paths can be absolute or relative to cwd.
    const abs = files.map((f) => (path.posix.isAbsolute(f) ? path.posix.normalize(f) : path.posix.join(cwd, f)))
    return { kind: 'pre-edit', agent: 'opencode', cwd, tool, files: abs }
  }

  return ignored(`event ${data.hook_event_name} is not handled`)
}
