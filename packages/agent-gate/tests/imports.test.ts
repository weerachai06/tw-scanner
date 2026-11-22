import { describe, it, expect } from 'bun:test'
import { extractImports } from '../src/core/imports.js'

const modules = (source: string, file = 'a.ts') =>
  extractImports(source, file).map((i) => i.module)

describe('extractImports', () => {
  it('finds a default import with line and column', () => {
    const [ref] = extractImports("const x = 1\nimport fs from 'node:fs'\n", 'a.ts')
    expect(ref).toEqual({ module: 'node:fs', names: ['default'], line: 2, col: 0 })
  })

  it('ignores type-only imports', () => {
    expect(modules("import type { X } from 'fs'")).toEqual([])
  })

  it('finds require() calls', () => {
    expect(modules("const fs = require('fs')")).toEqual(['fs'])
  })

  it('finds re-exports', () => {
    expect(modules("export * from 'fs'\nexport { a } from 'path'")).toEqual(['fs', 'path'])
  })

  it('ignores exports without a source', () => {
    expect(modules('const a = 1\nexport { a }')).toEqual([])
  })

  it('finds dynamic import() with a string literal', () => {
    expect(modules("const m = await import('fs')")).toEqual(['fs'])
  })

  it('marks a non-literal dynamic import as unverifiable', () => {
    const refs = extractImports('const m = await import(`./${x}`)', 'a.ts')
    expect(refs.map((r) => r.module)).toEqual([null])
  })

  it('marks a non-literal require as unverifiable', () => {
    expect(extractImports('require(name)', 'a.ts').map((r) => r.module)).toEqual([null])
  })

  it('parses JSX in .tsx files', () => {
    expect(modules("import React from 'react'\nconst a = <div />", 'a.tsx')).toEqual(['react'])
  })

  it('throws on a file that does not parse', () => {
    expect(() => extractImports('import {', 'a.ts')).toThrow()
  })

  const names = (source: string) => extractImports(source, 'a.ts')[0].names

  it('lists named imports by their original name, not the alias', () => {
    expect(names("import { useState as s, useEffect } from 'react'")).toEqual(['useState', 'useEffect'])
  })

  it('lists default and namespace imports', () => {
    expect(names("import React, * as All from 'react'")).toEqual(['default', '*'])
  })

  it('skips inline type specifiers', () => {
    expect(names("import { type A, b } from 'x'")).toEqual(['b'])
  })

  it('has no names for a side-effect import, require, and dynamic import', () => {
    expect(names("import 'x'")).toEqual([])
    expect(names("require('x')")).toEqual([])
    expect(names("import('x')")).toEqual([])
  })

  it('lists re-exported names', () => {
    expect(names("export { a, b as c } from 'x'")).toEqual(['a', 'b'])
    expect(names("export * from 'x'")).toEqual(['*'])
  })
})
