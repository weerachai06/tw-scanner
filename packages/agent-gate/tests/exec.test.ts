import { describe, it, expect } from 'bun:test'
import { runCommand } from '../src/exec.js'

const run = (code: string, timeoutMs = 5000) =>
  runCommand([process.execPath, '-e', code], { cwd: process.cwd(), timeoutMs })

describe('runCommand', () => {
  it('captures stdout, stderr and a zero exit code', async () => {
    const out = await run("console.log('out'); console.error('err')")
    expect(out).toEqual({ exitCode: 0, stdout: 'out\n', stderr: 'err\n', timedOut: false })
  })

  it('returns a non-zero exit code', async () => {
    const out = await run('process.exit(3)')
    expect(out.exitCode).toBe(3)
    expect(out.timedOut).toBe(false)
  })

  it('kills a command that runs too long', async () => {
    const started = Date.now()
    const out = await run('setTimeout(() => {}, 10000)', 200)
    expect(out.timedOut).toBe(true)
    expect(out.exitCode).toBeNull()
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('reports a command that cannot start', async () => {
    const out = await runCommand(['agent-gate-no-such-binary'], { cwd: process.cwd(), timeoutMs: 1000 })
    expect(out.exitCode).toBeNull()
    expect(out.timedOut).toBe(false)
    expect(out.stderr).toContain('agent-gate-no-such-binary')
  })

  it('runs in the given cwd', async () => {
    const out = await runCommand([process.execPath, '-e', 'console.log(process.cwd())'], {
      cwd: '/',
      timeoutMs: 5000,
    })
    expect(out.stdout.trim()).toBe('/')
  })
})
