// agent-gate plugin for OpenCode. Copy it to .opencode/plugins/agent-gate.js.
// OpenCode has no command hooks, so this plugin forwards three events to the agent-gate CLI:
//   tool.execute.before  → guard: refuse edits to the files that control the checks
//   session.created     → save the session baseline
//   session.idle        → Stop: run the rules and commands, and send the agent back when they fail
import { spawn } from 'node:child_process'

const COMMAND = ['npx', '--yes', '@weerachai06/agent-gate', 'hook', '--agent', 'opencode']
const WRITE_TOOLS = new Set(['edit', 'write', 'patch'])

/** Resolves { code, stderr }. Never rejects: a CLI that cannot start counts as exit 1, which does not block. */
function run(command, cwd, payload) {
  return new Promise((resolve) => {
    const [bin, ...args] = command
    const child = spawn(bin, args, { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (e) => resolve({ code: 1, stderr: String(e) }))
    child.on('close', (code) => resolve({ code: code ?? 1, stderr: stderr.trim() }))
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ cwd, ...payload }))
  })
}

/** `options.command` replaces the default command, e.g. ["bun", "path/to/cli.ts", "hook", "--agent", "opencode"]. */
export const AgentGate = async ({ client, directory }, options) => {
  const command = Array.isArray(options?.command) ? options.command : COMMAND
  const send = (payload) => run(command, directory, payload)
  const children = new Set()
  // Sessions we already sent back once. The next idle is a retry, so a block becomes a warning
  // and the agent is not trapped in a loop. Same meaning as Claude Code's stop_hook_active.
  const sentBack = new Set()

  return {
    'tool.execute.before': async (input, output) => {
      if (!WRITE_TOOLS.has(input.tool)) return
      const result = await send({
        hook_event_name: 'PreToolUse',
        session_id: input.sessionID,
        tool_name: input.tool,
        tool_input: output.args,
      })
      if (result.code === 2) throw new Error(result.stderr)
    },

    event: async ({ event }) => {
      if (event.type === 'session.created') {
        const info = event.properties.info
        if (info.parentID) return void children.add(info.id)
        await send({ hook_event_name: 'SessionStart', session_id: info.id })
      }

      if (event.type === 'session.idle') {
        const id = event.properties.sessionID
        if (children.has(id)) return
        const retry = sentBack.delete(id)
        const result = await send({ hook_event_name: 'Stop', session_id: id, stop_hook_active: retry })
        if (result.code !== 2) return
        sentBack.add(id)
        // Not awaited: the call returns when the whole turn is done, and we must see its idle event.
        client.session
          .prompt({ path: { id }, body: { parts: [{ type: 'text', text: result.stderr }] } })
          .catch(() => sentBack.delete(id))
      }
    },
  }
}
