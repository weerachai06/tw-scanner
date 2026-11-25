import { minimatch } from 'minimatch'
import type { Decision } from './types.js'

// Files that make the checks run. An agent that can edit them can switch the checks off.
export const GUARD_FILES = [
  'agent-gate.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
  'opencode.json',
  'opencode.jsonc',
  '.opencode/opencode.json',
  '.opencode/opencode.jsonc',
]
export const GUARD_DIRS = ['.kiro/hooks', '.opencode/plugin', '.opencode/plugins']

const PROTECTED = [...GUARD_FILES, ...GUARD_DIRS.map((d) => `${d}/**`)]

/** `files` are relative to the repo root. */
export function guard(files: string[]): Decision {
  const hit = files.filter((f) => PROTECTED.some((g) => minimatch(f, g, { dot: true })))
  if (hit.length === 0) return { action: 'allow' }
  return {
    action: 'block',
    reason: `agent-gate: ${hit.join(', ')} control${hit.length === 1 ? 's' : ''} the checks and cannot be edited by the agent. Ask the user to change ${hit.length === 1 ? 'it' : 'them'}.`,
  }
}
