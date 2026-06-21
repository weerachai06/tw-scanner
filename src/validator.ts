import * as fs from 'fs'
import * as path from 'path'
import { compile } from '@tailwindcss/node'

type TailwindCompileResult = Awaited<ReturnType<typeof compile>>

// ─── Cache: compile result per CSS file ──────────────────────────────────────
const compileCache = new Map<string, TailwindCompileResult>()

export async function loadTailwindContext(cssFile: string): Promise<TailwindCompileResult> {
  const abs = path.resolve(cssFile)
  if (compileCache.has(abs)) return compileCache.get(abs)!

  if (!fs.existsSync(abs)) {
    throw new Error(`Tailwind CSS file not found: ${abs}`)
  }

  const css = fs.readFileSync(abs, 'utf8')

  const result = await compile(css, {
    base: path.dirname(abs),
    onDependency: () => {},
  })

  compileCache.set(abs, result)
  return result
}

// ─── Build CSS selector for string matching ──────────────────────────────────
function cssSelector(cls: string): string {
  // Produces the escaped selector as it appears in Tailwind's CSS output
  return '.' + cls
    .replace(/\//g, '\\/')
    .replace(/\./g, '\\.')
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/#/g, '\\#')
    .replace(/%/g, '\\%')
    .replace(/!/g, '\\!')
}

function selectorInOutput(selector: string, output: string): boolean {
  const idx = output.indexOf(selector)
  if (idx === -1) return false
  const next = output[idx + selector.length]
  return next === '{' || next === ' ' || next === ':' || next === '[' || next === ','
}

// ─── Validation cache: per-context ───────────────────────────────────────────
const validityCache = new Map<TailwindCompileResult, Map<string, boolean>>()

export function isValidClass(cls: string, context: TailwindCompileResult): boolean {
  if (!validityCache.has(context)) validityCache.set(context, new Map())
  const cache = validityCache.get(context)!

  if (cache.has(cls)) return cache.get(cls)!

  // Build CSS with this single candidate
  const output = context.build([cls])

  const valid = selectorInOutput(cssSelector(cls), output)

  cache.set(cls, valid)
  return valid
}

// ─── Batch validate (more efficient: one build call per batch) ────────────────
export function validateBatch(
  classes: string[],
  context: TailwindCompileResult,
): Map<string, boolean> {
  const result = new Map<string, boolean>()
  const toCheck: string[] = []
  const cache = validityCache.get(context) ?? new Map<string, boolean>()
  if (!validityCache.has(context)) validityCache.set(context, cache)

  // Use cache first
  for (const cls of classes) {
    if (cache.has(cls)) {
      result.set(cls, cache.get(cls)!)
    } else {
      toCheck.push(cls)
    }
  }

  if (toCheck.length === 0) return result

  // Build all candidates at once
  const output = context.build(toCheck)

  for (const cls of toCheck) {
    const valid = selectorInOutput(cssSelector(cls), output)
    result.set(cls, valid)
    cache.set(cls, valid)
  }

  return result
}
