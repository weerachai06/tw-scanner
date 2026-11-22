import { describe, it, expect } from 'bun:test'
import { checkFiles } from '../src/core/rules.js'
import type { Rule } from '../src/core/types.js'

const rule: Rule = {
  id: 'fcis-core-pure',
  files: ['src/core/**/*.ts'],
  ignore: ['**/*.test.ts'],
  message: 'Core must be pure',
  forbidImports: ['fs', 'child_process'],
}

describe('checkFiles', () => {
  it('flags a forbidden import in a matching file', () => {
    const violations = checkFiles(
      [{ path: 'src/core/x.ts', source: "import { readFile } from 'fs/promises'" }],
      [rule],
    )
    expect(violations).toEqual([
      {
        ruleId: 'fcis-core-pure',
        kind: 'import',
        file: 'src/core/x.ts',
        line: 1,
        col: 0,
        found: 'fs/promises',
        message: 'Core must be pure',
      },
    ])
  })

  it('treats node: prefixed modules as the same module', () => {
    const violations = checkFiles(
      [{ path: 'src/core/x.ts', source: "import fs from 'node:fs'" }],
      [rule],
    )
    expect(violations.map((v) => v.found)).toEqual(['node:fs'])
  })

  it('does not match a module that only shares a prefix', () => {
    const violations = checkFiles(
      [{ path: 'src/core/x.ts', source: "import x from 'fsevents'" }],
      [rule],
    )
    expect(violations).toEqual([])
  })

  it('skips files outside the rule globs', () => {
    const violations = checkFiles(
      [{ path: 'src/shell/x.ts', source: "import fs from 'fs'" }],
      [rule],
    )
    expect(violations).toEqual([])
  })

  it('skips files matching ignore', () => {
    const violations = checkFiles(
      [{ path: 'src/core/x.test.ts', source: "import fs from 'fs'" }],
      [rule],
    )
    expect(violations).toEqual([])
  })

  it('does not flag unverifiable dynamic imports', () => {
    const violations = checkFiles(
      [{ path: 'src/core/x.ts', source: 'await import(name)' }],
      [rule],
    )
    expect(violations).toEqual([])
  })

  it('reports a file that does not parse as a violation', () => {
    const second: Rule = { ...rule, id: 'other' }
    const violations = checkFiles([{ path: 'src/core/x.ts', source: 'import {' }], [rule, second])
    expect(violations).toHaveLength(1)
    expect(violations[0].ruleId).toBe('parse-error')
    expect(violations[0].kind).toBe('parse-error')
    expect(violations[0].found).toBe('parse error')
    expect(violations[0].file).toBe('src/core/x.ts')
  })

  it('applies every matching rule', () => {
    const second: Rule = { ...rule, id: 'no-cp', forbidImports: ['child_process'], message: 'no cp' }
    const violations = checkFiles(
      [{ path: 'src/core/x.ts', source: "import fs from 'fs'\nimport cp from 'child_process'" }],
      [rule, second],
    )
    expect(violations.map((v) => `${v.ruleId}:${v.found}`).sort()).toEqual([
      'fcis-core-pure:child_process',
      'fcis-core-pure:fs',
      'no-cp:child_process',
    ])
  })

  it('returns nothing when there are no rules', () => {
    expect(checkFiles([{ path: 'a.ts', source: "import fs from 'fs'" }], [])).toEqual([])
  })
})

describe('checkFiles — forbidImportNames', () => {
  const hooks: Rule = {
    id: 'no-hooks-in-core',
    files: ['src/core/**/*.ts'],
    message: 'No React hooks in core',
    forbidImportNames: [{ from: 'react', names: ['use*'] }],
  }
  const check = (source: string) => checkFiles([{ path: 'src/core/x.ts', source }], [hooks])

  it('flags a name matching a glob, using the original name', () => {
    const [v] = check("import { useState as s, memo } from 'react'")
    expect(v).toEqual({
      ruleId: 'no-hooks-in-core',
      kind: 'import-name',
      file: 'src/core/x.ts',
      line: 1,
      col: 0,
      found: 'useState from "react"',
      message: 'No React hooks in core',
    })
  })

  it('reports each matching name', () => {
    expect(check("import { useState, useEffect } from 'react'").map((v) => v.found)).toEqual([
      'useState from "react"',
      'useEffect from "react"',
    ])
  })

  it('ignores other names and other modules', () => {
    expect(check("import { memo } from 'react'")).toEqual([])
    expect(check("import { useState } from 'preact'")).toEqual([])
  })

  it('matches subpaths of the module', () => {
    expect(check("import { useThing } from 'react/x'")).toHaveLength(1)
  })

  it('supports exact names including default and namespace', () => {
    const rule: Rule = { ...hooks, forbidImportNames: [{ from: 'lodash', names: ['default', '*'] }] }
    const v = checkFiles(
      [{ path: 'src/core/x.ts', source: "import _ from 'lodash'\nimport * as L from 'lodash'" }],
      [rule],
    )
    expect(v).toHaveLength(2)
  })
})

describe('checkFiles — forbidGlobals', () => {
  const globals: Rule = {
    id: 'no-io-globals',
    files: ['src/core/**/*.ts'],
    message: 'No I/O globals in core',
    forbidGlobals: ['fetch', 'process'],
  }
  const check = (source: string) => checkFiles([{ path: 'src/core/x.ts', source }], [globals])

  it('flags a used global with its position', () => {
    expect(check("const a = 1\nawait fetch('/x')")).toEqual([
      {
        ruleId: 'no-io-globals',
        kind: 'global',
        file: 'src/core/x.ts',
        line: 2,
        col: 6,
        found: 'fetch',
        message: 'No I/O globals in core',
      },
    ])
  })

  it('flags process.env but not obj.fetch', () => {
    expect(check('const k = process.env.K; obj.fetch(1)').map((v) => v.found)).toEqual(['process'])
  })

  it('reports a parse error once, for a rule that only forbids globals', () => {
    expect(check('const =').map((v) => v.kind)).toEqual(['parse-error'])
  })

  it('does not parse a file when the rule forbids no globals', () => {
    // forbidImports-only rule: a global use is none of its business
    const rule: Rule = { ...globals, forbidGlobals: undefined, forbidImports: ['fs'] }
    expect(checkFiles([{ path: 'src/core/x.ts', source: 'fetch(1)' }], [rule])).toEqual([])
  })
})
