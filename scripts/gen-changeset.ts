#!/usr/bin/env bun
/**
 * Generates a changeset file from git commits since the last tag.
 *
 * Usage:
 *   bun scripts/gen-changeset.ts [--bump patch|minor|major]
 *
 * Bump type is inferred from conventional commit prefixes unless overridden:
 *   feat:     → minor
 *   fix:      → patch
 *   refactor/test/chore/ci: → patch
 *   feat!: or BREAKING CHANGE: → major
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const PACKAGE = '@weerachai06/tw-scanner'
const CHANGESET_DIR = path.resolve(import.meta.dir, '../.changeset')

// ── Git helpers ───────────────────────────────────────────────────────────────

function lastTag(): string | null {
  try {
    return Bun.spawnSync(['git', 'describe', '--tags', '--abbrev=0'])
      .stdout.toString().trim() || null
  } catch {
    return null
  }
}

function commitsSince(tag: string | null): string[] {
  const range = tag ? `${tag}..HEAD` : 'HEAD'
  const out = Bun.spawnSync(['git', 'log', range, '--pretty=format:%s', '--no-merges'])
    .stdout.toString().trim()
  return out ? out.split('\n').filter(Boolean) : []
}

// ── Conventional commit parsing ───────────────────────────────────────────────

type BumpType = 'major' | 'minor' | 'patch'

const SKIP_PREFIXES = ['chore', 'ci', 'docs', 'style']

function inferBump(commits: string[]): BumpType {
  for (const c of commits) {
    if (/^[a-z]+!:/.test(c) || c.includes('BREAKING CHANGE')) return 'major'
  }
  for (const c of commits) {
    if (/^feat(\([^)]+\))?:/.test(c)) return 'minor'
  }
  return 'patch'
}

function parseCommit(msg: string): { prefix: string; scope: string | null; body: string } {
  const m = msg.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)/)
  if (!m) return { prefix: '', scope: null, body: msg }
  return { prefix: m[1], scope: m[2] ?? null, body: m[3] }
}

function formatChangelog(commits: string[]): string {
  const visible = commits.filter((c) => {
    const { prefix } = parseCommit(c)
    return !SKIP_PREFIXES.includes(prefix)
  })

  if (visible.length === 0) {
    // Fall back to all commits if everything was filtered
    return commits.map((c) => `- ${parseCommit(c).body}`).join('\n')
  }

  const features = visible.filter((c) => parseCommit(c).prefix === 'feat')
  const fixes    = visible.filter((c) => parseCommit(c).prefix === 'fix')
  const rest     = visible.filter((c) => !['feat', 'fix'].includes(parseCommit(c).prefix))

  const lines: string[] = []

  if (features.length) {
    lines.push('### Features')
    features.forEach((c) => {
      const { scope, body } = parseCommit(c)
      lines.push(`- ${scope ? `**${scope}:** ` : ''}${body}`)
    })
  }

  if (fixes.length) {
    lines.push('### Bug Fixes')
    fixes.forEach((c) => {
      const { scope, body } = parseCommit(c)
      lines.push(`- ${scope ? `**${scope}:** ` : ''}${body}`)
    })
  }

  if (rest.length) {
    lines.push('### Changes')
    rest.forEach((c) => lines.push(`- ${parseCommit(c).body}`))
  }

  return lines.join('\n')
}

// ── CLI arg: --bump override ──────────────────────────────────────────────────

function argBump(): BumpType | null {
  const i = process.argv.indexOf('--bump')
  if (i === -1) return null
  const val = process.argv[i + 1]
  if (val === 'major' || val === 'minor' || val === 'patch') return val
  console.error(`Invalid --bump value: ${val}. Use patch, minor, or major.`)
  process.exit(1)
}

// ── Main ──────────────────────────────────────────────────────────────────────

const tag = lastTag()
const commits = commitsSince(tag)

if (commits.length === 0) {
  console.log('No commits since last tag — nothing to generate.')
  process.exit(0)
}

const bump: BumpType = argBump() ?? inferBump(commits)
const changelog = formatChangelog(commits)
const id = crypto.randomBytes(4).toString('hex')
const filename = `auto-${id}.md`
const filepath = path.join(CHANGESET_DIR, filename)

const content = `---
"${PACKAGE}": ${bump}
---

${changelog}
`

fs.writeFileSync(filepath, content)

console.log(`✓  .changeset/${filename}`)
console.log(`   bump : ${bump}`)
console.log(`   since: ${tag ?? '(beginning)'}`)
console.log(`   commits: ${commits.length}`)
console.log()
console.log('Review the file, then:')
console.log('  git add .changeset && git commit -m "chore: add changeset"')
