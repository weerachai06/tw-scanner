import { describe, it, expect } from 'bun:test'
import { extractGlobals } from '../src/core/globals.js'

/** Only the names a rule would look for; other used identifiers (obj, o, …) are ignored. */
const names = (source: string, file = 'a.ts') =>
  extractGlobals(source, file)
    .map((g) => g.name)
    .filter((n) => n === 'fetch' || n === 'process')

describe('extractGlobals', () => {
  it('finds a call and reports line and column', () => {
    expect(extractGlobals("const x = 1\nfetch('/a')", 'a.ts')).toEqual([{ name: 'fetch', line: 2, col: 0 }])
  })

  it('finds a global used as the object of a member access', () => {
    expect(names('const k = process.env.KEY')).toEqual(['process'])
  })

  it('does not flag a property with the same name', () => {
    expect(names('obj.fetch(1); const o = { fetch: 1 }; o.process')).toEqual([])
  })

  it('flags a computed property key and computed member', () => {
    expect(names('const o = { [fetch]: 1 }; o[process]')).toEqual(['fetch', 'process'])
  })

  it('flags a shorthand property value', () => {
    expect(names('const o = { fetch }')).toEqual(['fetch'])
  })

  it('does not flag declarations', () => {
    expect(names('const fetch = 1')).toEqual([])
    expect(names('function fetch() {}')).toEqual([])
    expect(names('function f(fetch) {}')).toEqual([])
    expect(names('class process {}')).toEqual([])
  })

  it('does not flag class members', () => {
    expect(names('class A { fetch() {} process = 1 }')).toEqual([])
  })

  it('does not flag import or export specifier names', () => {
    expect(names("import { fetch } from 'x'")).toEqual([])
    expect(names("import fetch from 'x'")).toEqual([])
  })

  it('does not flag destructuring declarations', () => {
    expect(names('const { fetch } = obj; const [process] = arr')).toEqual([])
  })

  it('does not flag TypeScript types', () => {
    expect(names('type T = { fetch: number }; interface I { process: string }; let x: fetch')).toEqual([])
  })

  it('still finds a global inside a TS expression wrapper', () => {
    expect(names('const x = (fetch as any)(1)')).toEqual(['fetch'])
  })

  it('finds a global inside JSX expressions but not JSX tag names', () => {
    expect(names('const a = <div onClick={fetch}><process /></div>', 'a.tsx')).toEqual(['fetch'])
  })

  it('finds a global in a function body and an arrow default value position', () => {
    expect(names('const f = () => fetch(1)')).toEqual(['fetch'])
  })

  it('does not flag a label or a catch parameter', () => {
    expect(names('fetch: for (;;) { break fetch }')).toEqual([])
    expect(names('try {} catch (process) {}')).toEqual([])
  })

  it('throws on a file that does not parse', () => {
    expect(() => extractGlobals('const =', 'a.ts')).toThrow()
  })
})
