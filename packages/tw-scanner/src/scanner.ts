import { globSync } from 'glob'
import * as fs from 'fs'
import * as path from 'path'
import { parseClassesFromSource, parseCssApply, parseCssModuleUsages, parseCssModuleClasses } from './extractor.js'
import { loadTailwindContext, validateBatch } from './validator.js'
import { ScanResult, ExtractedClass, ValidationResult, CssModuleUsage, CssModuleViolation } from './types.js'

export interface ScanOptions {
  /** Root directory to scan */
  src: string
  /** Path to the Tailwind CSS entry file (with @import tailwindcss + @theme) */
  css: string
  /** Glob patterns to include (default: **\/*.{ts,tsx,js,jsx}) */
  include?: string[]
  /** Glob patterns to exclude (default: node_modules, dist, .next, build) */
  exclude?: string[]
}

const DEFAULT_INCLUDE = ['**/*.{ts,tsx,js,jsx,css}']
const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/build/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.d.ts',
]

export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const start = Date.now()

  // ── 1. Find files ──────────────────────────────────────────────────────────
  const include = opts.include ?? DEFAULT_INCLUDE
  const exclude = opts.exclude ?? DEFAULT_EXCLUDE

  const files = include.flatMap((pattern) =>
    globSync(pattern, {
      cwd: path.resolve(opts.src),
      absolute: true,
      ignore: exclude,
      nodir: true,
    })
  )

  if (files.length === 0) {
    console.warn(`⚠  No files found in: ${opts.src}`)
  }

  // ── 2. Load Tailwind context ───────────────────────────────────────────────
  const twContext = await loadTailwindContext(opts.css)

  // ── 3. Read each file once — extract classes and CSS module usages ─────────
  const allExtracted: ExtractedClass[] = []
  const allUsages: CssModuleUsage[] = []

  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const source = fs.readFileSync(file, 'utf8')

    if (file.endsWith('.css')) {
      allExtracted.push(...parseCssApply(source, file))
    } else {
      const isJSX = /\.(tsx|jsx)$/.test(file)

      const { classes, error: parseError } = parseClassesFromSource(source, file, isJSX)
      if (parseError) console.warn(`⚠  Parse error in ${file}: ${parseError.message}`)
      allExtracted.push(...classes)

      const { usages } = parseCssModuleUsages(source, file)
      allUsages.push(...usages)
    }
  }

  // ── 4. Separate static vs dynamic ─────────────────────────────────────────
  const staticClasses = allExtracted.filter((c) => !c.isDynamic)
  const dynamicClasses = allExtracted.filter((c) => c.isDynamic)

  // ── 5. Batch validate static classes ──────────────────────────────────────
  const uniqueValues = [...new Set(staticClasses.map((c) => c.value))]
  const validityMap = validateBatch(uniqueValues, twContext)

  // ── 6. Build results ───────────────────────────────────────────────────────
  const invalid: ValidationResult[] = []

  for (const cls of staticClasses) {
    const valid = validityMap.get(cls.value) ?? false
    if (!valid) {
      invalid.push({ cls, valid })
    }
  }

  // ── 7. CSS Module cross-reference ─────────────────────────────────────────
  const cssModuleViolations: CssModuleViolation[] = []
  const staticUsages = allUsages.filter((u) => !u.isDynamic)

  const moduleClassesCache = new Map<string, Set<string>>()
  for (const usage of staticUsages) {
    if (!moduleClassesCache.has(usage.modulePath)) {
      if (fs.existsSync(usage.modulePath)) {
        const cssSource = fs.readFileSync(usage.modulePath, 'utf8')
        moduleClassesCache.set(usage.modulePath, parseCssModuleClasses(cssSource))
      } else {
        moduleClassesCache.set(usage.modulePath, new Set())
      }
    }
    const defined = moduleClassesCache.get(usage.modulePath)!
    if (!defined.has(usage.className)) {
      cssModuleViolations.push({
        file: usage.file,
        line: usage.line,
        col: usage.col,
        className: usage.className,
        modulePath: usage.modulePath,
        context: usage.context,
      })
    }
  }

  return {
    invalid,
    dynamic: dynamicClasses,
    cssModuleViolations,
    totalClasses: allExtracted.length,
    totalFiles: files.length,
    durationMs: Date.now() - start,
  }
}
