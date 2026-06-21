#!/usr/bin/env node
import * as path from 'path'
import { scan } from './scanner.js'
import { printReport, writeJsonReport } from './reporter.js'

// ─── Minimal arg parser ───────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const srcArg = (args['src'] as string) ?? './src'
  const cssArg = (args['css'] as string)
  const outputArg = args['output'] as string | undefined
  const jsonMode = Boolean(args['json'])
  const verbose = Boolean(args['verbose'])

  if (!cssArg) {
    console.error('Usage: tw-scanner --src <dir> --css <tailwind-entry.css> [--output report.json] [--verbose] [--json]')
    console.error('')
    console.error('  --src      Directory to scan (default: ./src)')
    console.error('  --css      Path to Tailwind CSS entry file with @import and @theme')
    console.error('  --output   Write JSON report to file')
    console.error('  --verbose  Show context snippets for each error')
    console.error('  --json     Print full JSON report to stdout')
    process.exit(1)
  }

  const src = path.resolve(srcArg)
  const css = path.resolve(cssArg)

  try {
    const result = await scan({ src, css })
    printReport(result, { json: jsonMode, verbose })

    if (outputArg) {
      writeJsonReport(result, path.resolve(outputArg))
    }

    process.exit(result.invalid.length > 0 || result.cssModuleViolations.length > 0 ? 1 : 0)
  } catch (err) {
    console.error('Fatal error:', (err as Error).message)
    process.exit(2)
  }
}

main()
