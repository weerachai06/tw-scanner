import { globSync } from 'glob'
import * as path from 'path'
import { extractClassesFromFile, extractClassesFromCss } from './extractor.js'
import { loadTailwindContext, validateBatch } from './validator.js'
import { ScanResult, ExtractedClass, ValidationResult } from './types.js'

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
      invalid.push({ cls, valid })
    }
  }

  return {
    invalid,
    dynamic: dynamicClasses,
    totalClasses: allExtracted.length,
    totalFiles: files.length,
    durationMs: Date.now() - start,
  }
}
