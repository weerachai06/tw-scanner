import { minimatch } from 'minimatch'
import type { CommandSpec, PlannedCommand } from './types.js'

/** Absolute path → path relative to `root`, or null when it is outside `root`. */
export function toRelative(file: string, root: string): string | null {
  const base = root.endsWith('/') ? root : `${root}/`
  if (!file.startsWith(base) || file.length === base.length) return null
  return file.slice(base.length)
}

const DEFAULT_TIMEOUT_SEC = 120

// Well under the OS limit for one command line (about 1 MB on macOS, 2 MB on Linux).
const MAX_ARGS_CHARS = 100_000

/** Merges `git diff -z --name-only` and `git ls-files -z` output (NUL-separated, never quoted). */
export function parseGitFiles(...outputs: string[]): string[] {
  const names = outputs.flatMap((o) => o.split('\0')).filter(Boolean)
  return [...new Set(names)]
}

/** Splits `files` into groups whose joined length stays within `maxChars`; a longer path gets its own. */
function batch(files: string[], maxChars: number): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  let size = 0
  for (const f of files) {
    if (current.length > 0 && size + f.length + 1 > maxChars) {
      groups.push(current)
      current = []
      size = 0
    }
    current.push(f)
    size += f.length + 1
  }
  if (current.length > 0) groups.push(current)
  return groups
}

export function selectFiles(files: string[], globs: string[]): string[] {
  return files.filter((f) => globs.some((g) => minimatch(f, g, { dot: true })))
}

/**
 * Picks the commands worth running for `changed` and expands `{files}`. A long file list becomes
 * several runs of the same command, so it never exceeds the OS limit on a command line.
 */
export function planCommands(
  commands: CommandSpec[],
  changed: string[],
  maxArgsChars = MAX_ARGS_CHARS,
): PlannedCommand[] {
  return commands.flatMap((c) => {
    const files = c.files ? selectFiles(changed, c.files) : changed
    if (files.length === 0) return []
    const timeoutSec = c.timeoutSec ?? DEFAULT_TIMEOUT_SEC
    const expand = (group: string[]) => c.run.flatMap((arg) => (arg === '{files}' ? group : [arg]))
    if (!c.run.includes('{files}')) return [{ name: c.name, argv: c.run, timeoutSec }]
    return batch(files, maxArgsChars).map((group) => ({ name: c.name, argv: expand(group), timeoutSec }))
  })
}
