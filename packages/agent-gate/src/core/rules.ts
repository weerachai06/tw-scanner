import { minimatch } from 'minimatch'
import { extractGlobals } from './globals.js'
import { extractImports } from './imports.js'
import type { Rule, Violation } from './types.js'

export interface SourceFile {
  /** Path relative to the repo root, forward slashes. */
  path: string
  source: string
}

const normalize = (mod: string) => mod.replace(/^node:/, '')

/** `fs` matches `fs`, `node:fs` and `fs/promises`, but not `fsevents`. */
function isForbidden(mod: string, forbidden: string[]): boolean {
  const name = normalize(mod)
  return forbidden.some((f) => name === f || name.startsWith(`${f}/`))
}

const appliesTo = (rule: Rule, path: string) =>
  rule.files.some((g) => minimatch(path, g, { dot: true })) &&
  !(rule.ignore ?? []).some((g) => minimatch(path, g, { dot: true }))

function checkFile(file: SourceFile, rules: Rule[]): Violation[] {
  const at = (rule: Rule, kind: Violation['kind'], line: number, col: number, found: string): Violation => ({
    ruleId: rule.id,
    kind,
    file: file.path,
    line,
    col,
    found,
    message: rule.message,
  })

  const imports = extractImports(file.source, file.path)
  // Parsing again is only worth it for a rule that needs identifiers.
  const globals = rules.some((r) => r.forbidGlobals?.length)
    ? extractGlobals(file.source, file.path)
    : []

  return rules.flatMap((rule) => [
    ...imports.flatMap((imp) => {
      if (imp.module === null) return []
      const mod = imp.module
      const whole = isForbidden(mod, rule.forbidImports ?? [])
        ? [at(rule, 'import', imp.line, imp.col, mod)]
        : []
      const named = (rule.forbidImportNames ?? [])
        .filter((f) => isForbidden(mod, [f.from]))
        .flatMap((f) =>
          imp.names
            .filter((n) => f.names.some((g) => minimatch(n, g)))
            .map((n) => at(rule, 'import-name', imp.line, imp.col, `${n} from "${mod}"`)),
        )
      return [...whole, ...named]
    }),
    ...globals
      .filter((g) => (rule.forbidGlobals ?? []).includes(g.name))
      .map((g) => at(rule, 'global', g.line, g.col, g.name)),
  ])
}

export function checkFiles(files: SourceFile[], rules: Rule[]): Violation[] {
  return files.flatMap((file) => {
    const matching = rules.filter((r) => appliesTo(r, file.path))
    if (matching.length === 0) return []
    try {
      return checkFile(file, matching)
    } catch (e) {
      return [
        {
          ruleId: 'parse-error',
          kind: 'parse-error' as const,
          file: file.path,
          line: 1,
          col: 0,
          found: 'parse error',
          message: `file does not parse: ${(e as Error).message}`,
        },
      ]
    }
  })
}
