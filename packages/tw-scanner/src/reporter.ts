import pc from 'picocolors'
import * as fs from 'fs'
import * as path from 'path'
import { ScanResult, ValidationResult, ExtractedClass, CssModuleViolation } from './types.js'

function relativePath(file: string, cwd = process.cwd()) {
  return path.relative(cwd, file)
}

function pluralize(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Group by file
function groupByFile<T extends { file: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const list = map.get(item.file) ?? []
    list.push(item)
    map.set(item.file, list)
  }
  return map
}

export function printReport(result: ScanResult, opts: { json?: boolean; verbose?: boolean } = {}) {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const { invalid, dynamic, cssModuleViolations, totalClasses, totalFiles, durationMs } = result

  console.log('')
  console.log(pc.bold('─── Tailwind v4 Class Scanner ───────────────────────────────'))
  console.log(
    `  Scanned ${pc.cyan(pluralize(totalFiles, 'file'))} · ` +
    `${pc.cyan(String(totalClasses))} classes found · ` +
    `${pc.dim(`${durationMs}ms`)}`
  )
  console.log('')

  // ── Invalid classes ──
  if (invalid.length === 0) {
    console.log(pc.green('  ✓ No invalid Tailwind classes found'))
  } else {
    console.log(pc.red(pc.bold(`  ✗ ${pluralize(invalid.length, 'invalid class')} found`)))
    console.log('')

    const byFile = groupByFile(invalid.map((v) => ({ ...v.cls, _result: v })))

    for (const [file, items] of byFile) {
      console.log(`  ${pc.underline(relativePath(file))}`)
      for (const item of items) {
        const loc = pc.dim(`${item.line}:${item.col}`)
        const cls = pc.red(pc.bold(item.value))
        const ctx = pc.dim(`…${item.context}…`)
        console.log(`    ${loc}  ${cls}`)
        if (opts.verbose) {
          console.log(`         ${ctx}`)
        }
      }
      console.log('')
    }
  }

  // ── Dynamic (warnings) ──
  const dynamicOnly = dynamic.filter((d) => d.isDynamic)
  if (dynamicOnly.length > 0) {
    console.log(pc.yellow(pc.bold(`  ⚠  ${pluralize(dynamicOnly.length, 'dynamic class expression')} (cannot validate)`)))
    console.log('')

    const byFile = groupByFile(dynamicOnly)
    for (const [file, items] of byFile) {
      console.log(`  ${pc.underline(relativePath(file))}`)
      for (const item of items) {
        const loc = pc.dim(`${item.line}:${item.col}`)
        const val = pc.yellow(item.value.length > 60 ? item.value.slice(0, 60) + '…' : item.value)
        console.log(`    ${loc}  ${val}`)
      }
      console.log('')
    }
  }

  // ── CSS Module violations ──
  if (cssModuleViolations.length > 0) {
    console.log(pc.red(pc.bold(`  ✗ ${pluralize(cssModuleViolations.length, 'CSS Module class')} not found`)))
    console.log('')

    const byFile = groupByFile(cssModuleViolations)
    for (const [file, items] of byFile) {
      console.log(`  ${pc.underline(relativePath(file))}`)
      for (const item of items) {
        const loc = pc.dim(`${item.line}:${item.col}`)
        const cls = pc.red(pc.bold(item.className))
        const mod = pc.dim(`(${relativePath(item.modulePath)})`)
        console.log(`    ${loc}  ${cls}  ${mod}`)
        if (opts.verbose) {
          console.log(`         ${pc.dim(`…${item.context}…`)}`)
        }
      }
      console.log('')
    }
  }

  // ── Summary ──
  console.log('─────────────────────────────────────────────────────────────')
  const hasErrors = invalid.length > 0 || cssModuleViolations.length > 0
  const status = hasErrors ? pc.red('FAIL') : pc.green('PASS')
  console.log(
    `  Status: ${status}  ·  ` +
    `${pc.red(String(invalid.length))} invalid  ·  ` +
    `${pc.red(String(cssModuleViolations.length))} CSS module  ·  ` +
    `${pc.yellow(String(dynamicOnly.length))} dynamic warnings`
  )
  console.log('')
}

export function writeJsonReport(result: ScanResult, outputPath: string) {
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2))
  console.log(pc.dim(`  Report saved → ${outputPath}`))
}
