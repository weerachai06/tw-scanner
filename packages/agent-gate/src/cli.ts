#!/usr/bin/env node
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runCommand } from './exec.js'
import { runHook } from './runner.js'

function readFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, content, { mode: 0o600 })
}

function listDir(dir: string): string[] | null {
  try {
    return fs.readdirSync(dir)
  } catch {
    return null
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const agent = argv[argv.indexOf('--agent') + 1]

  if (argv[0] !== 'hook' || (agent !== 'claude' && agent !== 'kiro' && agent !== 'opencode')) {
    console.error('Usage: agent-gate hook --agent claude|kiro|opencode   (hook JSON on stdin)')
    process.exit(1)
  }

  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
  const out = await runHook(
    fs.readFileSync(0, 'utf8'),
    root,
    { readFile, writeFile, listDir, runCommand, tmpDir: os.tmpdir() },
    agent,
  )

  if (out.stdout) process.stdout.write(out.stdout)
  if (out.stderr) process.stderr.write(`${out.stderr}\n`)
  process.exit(out.exitCode)
}

main()
