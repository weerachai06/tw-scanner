const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
const ERROR_LIKE = /error|✗|✘|fail|TS\d+/i

/**
 * Shrinks command output to about `maxChars`. Lines naming a changed file come first,
 * then error-like lines, then the rest. Kept lines stay in their original order.
 */
export function summarizeOutput(text: string, changed: string[], maxChars: number): string {
  const clean = text.replace(ANSI, '').trimEnd()
  if (clean.length <= maxChars) return clean

  const lines = clean.split('\n')
  const rank = (line: string) =>
    changed.some((f) => line.includes(f)) ? 0 : ERROR_LIKE.test(line) ? 1 : 2

  const order = lines.map((_, i) => i).sort((a, b) => rank(lines[a]) - rank(lines[b]) || a - b)

  const kept = new Set<number>()
  let used = 0
  for (const i of order) {
    const cost = lines[i].length + 1
    if (used + cost > maxChars && kept.size > 0) continue
    kept.add(i)
    used += cost
  }

  const out = lines.filter((_, i) => kept.has(i))
  // A single line longer than the budget is cut rather than dropped.
  if (out.length === 1 && out[0].length > maxChars) out[0] = out[0].slice(0, maxChars)
  const omitted = lines.length - out.length
  return omitted > 0 ? [...out, `… ${omitted} lines omitted`].join('\n') : out.join('\n')
}
