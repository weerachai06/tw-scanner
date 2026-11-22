import { minimatch } from 'minimatch'
import type { CommandSpec, PlannedCommand } from './types.js'

/** Absolute path → path relative to `root`, or null when it is outside `root`. */
export function toRelative(file: string, root: string): string | null {
  const base = root.endsWith('/') ? root : `${root}/`
  if (!file.startsWith(base) || file.length === base.length) return null
  return file.slice(base.length)
}

const DEFAULT_TIMEOUT_SEC = 120

/** Merges `git diff --name-only` and `git ls-files --others` output into one list. */
export function parseGitFiles(...outputs: string[]): string[] {
  const lines = outputs.flatMap((o) => o.split('\n')).filter(Boolean)
  return [...new Set(lines)]
}

export function selectFiles(files: string[], globs: string[]): string[] {
  return files.filter((f) => globs.some((g) => minimatch(f, g, { dot: true })))
}

/** Picks the commands worth running for `changed` and expands `{files}`. */
export function planCommands(commands: CommandSpec[], changed: string[]): PlannedCommand[] {
  return commands.flatMap((c) => {
    const files = c.files ? selectFiles(changed, c.files) : changed
    if (files.length === 0) return []
    return [
      {
        name: c.name,
        argv: c.run.flatMap((arg) => (arg === '{files}' ? files : [arg])),
        timeoutSec: c.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
      },
    ]
  })
}
