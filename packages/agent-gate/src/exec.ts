import { spawn } from 'child_process'
import type { CommandOutcome } from './core/types.js'

export type RunCommand = (
  argv: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<CommandOutcome>

/** Runs argv with no shell. On timeout the whole process group is killed. */
export const runCommand: RunCommand = (argv, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    const [cmd, ...args] = argv
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))

    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr, timedOut })
    }

    child.on('error', (err) => {
      stderr += err.message
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
