import { minimatch } from 'minimatch'
import type { Decision } from './types.js'

// Files that make the checks run. An agent that can edit them can switch the checks off.
const PROTECTED = [
  'agent-gate.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.kiro/hooks/**',
]

/** `files` are relative to the repo root. */
export function guard(files: string[]): Decision {
  const hit = files.filter((f) => PROTECTED.some((g) => minimatch(f, g, { dot: true })))
  if (hit.length === 0) return { action: 'allow' }
  return {
    action: 'block',
    reason: `agent-gate: ${hit.join(', ')} control${hit.length === 1 ? 's' : ''} the checks and cannot be edited by the agent. Ask the user to change ${hit.length === 1 ? 'it' : 'them'}.`,
  }
}
