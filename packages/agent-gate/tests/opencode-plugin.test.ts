import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { AgentGate } from '../opencode/agent-gate.js'

// Runs the plugin against the real CLI in a throwaway git repo. Only the OpenCode client is fake.
const CLI = path.resolve(import.meta.dir, '../src/cli.ts')
const command = ['bun', CLI, 'hook', '--agent', 'opencode']

const config = {
  rules: [{ id: 'core-pure', files: ['src/core/**/*.ts'], forbidImports: ['fs'], message: 'Core must be pure' }],
}

let repo: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-gate-opencode-'))
  git('init', '-q')
  fs.writeFileSync(path.join(repo, 'agent-gate.json'), JSON.stringify(config))
  git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
})

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }))

function start() {
  const prompts: any[] = []
  const client = { session: { prompt: async (req: any) => void prompts.push(req) } }
  return { prompts, hooks: AgentGate({ client, directory: repo }, { command }) as Promise<any> }
}

const idle = (sessionID: string) => ({ event: { type: 'session.idle', properties: { sessionID } } })
const created = (info: object) => ({ event: { type: 'session.created', properties: { info } } })

describe('opencode plugin — guard', () => {
  it('throws the reason when an edit targets a file that controls the checks', async () => {
    const hooks = await start().hooks
    const before = (tool: string, args: object) =>
      hooks['tool.execute.before']({ tool, sessionID: 's', callID: 'c' }, { args })
    await expect(before('edit', { filePath: path.join(repo, 'agent-gate.json') })).rejects.toThrow('agent-gate.json')
    await expect(before('patch', { patchText: '*** Update File: .opencode/plugins/agent-gate.js' })).rejects.toThrow(
      '.opencode/plugins/agent-gate.js',
    )
    await expect(before('write', { filePath: path.join(repo, 'src/a.ts') })).resolves.toBeUndefined()
    await expect(before('read', { filePath: path.join(repo, 'agent-gate.json') })).resolves.toBeUndefined()
  })
})

describe('opencode plugin — stop', () => {
  // Without a baseline only the plugin's retry flag stops the loop; with one, the runner also remembers the block.
  it.each([true, false])('sends the agent back once, then lets it finish (baseline: %p)', async (baseline) => {
    const { prompts, hooks: pending } = start()
    const hooks = await pending
    const id = `ses_${Date.now()}_${baseline}`
    fs.mkdirSync(path.join(repo, 'src/core'), { recursive: true })

    if (baseline) await hooks.event(created({ id }))
    await hooks.event(idle(id))
    expect(prompts).toEqual([]) // nothing changed yet

    fs.writeFileSync(path.join(repo, 'src/core/x.ts'), "import fs from 'node:fs'\n")
    await hooks.event(idle(id))
    expect(prompts).toHaveLength(1)
    expect(prompts[0].path).toEqual({ id })
    expect(prompts[0].body.parts[0].text).toContain('[core-pure] src/core/x.ts')

    await hooks.event(idle(id)) // the retry: still broken, but it must not be sent back again
    expect(prompts).toHaveLength(1)

    fs.rmSync(path.join(repo, 'src'), { recursive: true })
  })

  it('ignores sessions started by another session (subagents)', async () => {
    const { prompts, hooks: pending } = start()
    const hooks = await pending
    fs.mkdirSync(path.join(repo, 'src/core'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'src/core/y.ts'), "import fs from 'node:fs'\n")

    await hooks.event(created({ id: 'child', parentID: 'root' }))
    await hooks.event(idle('child'))
    expect(prompts).toEqual([])

    fs.rmSync(path.join(repo, 'src'), { recursive: true })
  })

  it('fails open when the command cannot start', async () => {
    const prompts: any[] = []
    const client = { session: { prompt: async (r: any) => void prompts.push(r) } }
    const hooks = await AgentGate({ client, directory: repo }, { command: ['agent-gate-no-such-binary'] })
    await hooks.event(idle('s'))
    await expect(
      hooks['tool.execute.before']({ tool: 'edit', sessionID: 's', callID: 'c' }, { args: { filePath: 'agent-gate.json' } }),
    ).resolves.toBeUndefined()
    expect(prompts).toEqual([])
  })
})
