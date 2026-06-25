import { globSync } from 'glob'
import * as path from 'path'
import { extractClassesFromFile, extractClassesFromCss, extractCssModuleUsages, extractDefinedCssModuleClasses } from './extractor.js'
import { loadTailwindContext, validateBatch, looksLikeUtility } from './validator.js'
import { ScanResult, ExtractedClass, ValidationResult, CssModuleViolation } from './types.js'

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

  // ── 3. Extract classes from all files ─────────────────────────────────────
  const allExtracted: ExtractedClass[] = []
  for (const file of files) {
    const extracted = file.endsWith('.css')
      ? extractClassesFromCss(file)
      : extractClassesFromFile(file)
    allExtracted.push(...extracted)
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
      invalid.push({ cls, valid, isLikelyUtility: looksLikeUtility(cls.value) })
    }
  }

  // ── 7. CSS Module cross-reference ────────────────────────────────────────────
  const cssModuleViolations: CssModuleViolation[] = []
  const jsFiles = files.filter((f) => !f.endsWith('.css'))

  // Collect all usages across JS/TS files
  const allUsages = jsFiles.flatMap((f) => extractCssModuleUsages(f))
  const staticUsages = allUsages.filter((u) => !u.isDynamic)

  // Load defined classes per unique module path (cached)
  const moduleClassesCache = new Map<string, Set<string>>()
  for (const usage of staticUsages) {
    if (!moduleClassesCache.has(usage.modulePath)) {
      moduleClassesCache.set(usage.modulePath, extractDefinedCssModuleClasses(usage.modulePath))
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
