import { createHash } from 'crypto'
import * as path from 'path'
import type { Snapshot } from './types.js'

/** Where one session's baseline lives, or null when the id is not safe to use in a file name. */
export function baselinePath(tmpDir: string, sessionId: string): string | null {
  return /^[A-Za-z0-9_-]{1,100}$/.test(sessionId)
    ? path.posix.join(tmpDir, 'agent-gate', `${sessionId}.json`)
    : null
}

/** Stored instead of file contents: settings files can hold secrets. */
export const hashContent = (text: string): string => createHash('sha1').update(text).digest('hex')

export function parseBaseline(raw: string | null): Snapshot | null {
  if (raw === null) return null
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const text = (v: unknown) => v === null || typeof v === 'string'
  if (!data || typeof data !== 'object' || !text(data.head) || !text(data.stash)) return null
  if (data.lastBlock !== undefined && !text(data.lastBlock)) return null
  if (!data.guard || typeof data.guard !== 'object') return null
  if (!Object.values(data.guard).every(text)) return null
  return data as Snapshot
}

/** Changes made during the session that a diff cannot show: a stash, or an edited guard file. */
export function tamperProblems(before: Snapshot, now: Snapshot): string[] {
  const problems: string[] = []

  if (now.stash !== before.stash) {
    problems.push(
      '[session] git stash changed during this session. A stash hides changes from the checks. ' +
        'Restore the stashed changes (git stash pop) before finishing.',
    )
  }

  const files = new Set([...Object.keys(before.guard), ...Object.keys(now.guard)])
  for (const file of [...files].sort()) {
    if ((before.guard[file] ?? null) !== (now.guard[file] ?? null)) {
      problems.push(
        `[session] ${file} controls the checks and changed during this session. ` +
          'Revert your change to it, or ask the user to make it.',
      )
    }
  }

  return problems
}
