import { hintFor } from './hints.js'
import type { CommandFailure, Decision, Violation } from './types.js'

function violationLine(v: Violation): string {
  const line = violationText(v)
  const fix = v.fix ?? hintFor(v)
  return fix ? `${line} Fix: ${fix}` : line
}

function violationText(v: Violation): string {
  const where = `[${v.ruleId}] ${v.file}:${v.line}:${v.col}`
  switch (v.kind) {
    case 'parse-error':
      return `${where} ${v.message}`
    case 'import':
      return `${where} imports "${v.found}" — ${v.message}`
    case 'import-name':
      return `${where} imports ${v.found} — ${v.message}`
    case 'global':
      return `${where} uses global "${v.found}" — ${v.message}`
  }
}

function failureLines(f: CommandFailure): string[] {
  const indented = f.output ? f.output.split('\n').map((l) => `  ${l}`) : []
  return [`[${f.name}] exit ${f.exitCode} — run: ${f.reproduce}`, ...indented]
}

/** A command that timed out or could not start is a warning: it must not trap the agent. */
export function decide(
  violations: Violation[],
  failures: CommandFailure[] = [],
  /** Session problems, already worded (a stash, an edited guard file). */
  problems: string[] = [],
): Decision {
  const failed = failures.filter((f) => f.exitCode !== null)
  const n = problems.length + violations.length + failed.length

  if (n > 0) {
    const head = `agent-gate: ${n} ${n === 1 ? 'problem' : 'problems'} in files you changed. Fix ${n === 1 ? 'it' : 'them'}, then finish.`
    const body = [...problems, ...violations.map(violationLine), ...failed.flatMap(failureLines)]
    return { action: 'block', reason: [head, ...body].join('\n') }
  }

  const unchecked = failures.filter((f) => f.exitCode === null)
  if (unchecked.length > 0) {
    const message = unchecked
      .map((f) => {
        const why = f.timedOut ? 'timed out — not checked' : `could not run — ${f.output}`
        return `[${f.name}] ${why}. run: ${f.reproduce}`
      })
      .join('\n')
    return { action: 'warn', message: `agent-gate: ${message}` }
  }

  return { action: 'allow' }
}
