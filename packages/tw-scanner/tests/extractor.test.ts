import { describe, it, expect } from 'bun:test'
import * as fs from 'fs'
import path from 'path'
import { parseClassesFromSource, parseCssApply, parseCssModuleUsages, parseCssModuleClasses } from '../src/extractor.js'

const fixture = path.resolve(import.meta.dir, 'fixtures/sample.tsx')
const cssFixture = path.resolve(import.meta.dir, 'fixtures/styles.css')
const moduleFixture = path.resolve(import.meta.dir, 'fixtures/Button.tsx')
const moduleCssFixture = path.resolve(import.meta.dir, 'fixtures/button.module.css')

const sampleSource = fs.readFileSync(fixture, 'utf8')
const cssSource = fs.readFileSync(cssFixture, 'utf8')
const moduleSource = fs.readFileSync(moduleFixture, 'utf8')
const moduleCssSource = fs.readFileSync(moduleCssFixture, 'utf8')

describe('parseClassesFromSource', () => {
  it('extracts classes from className prop', () => {
    const { classes } = parseClassesFromSource(sampleSource, fixture, true)
    const values = classes.map((c) => c.value)

    expect(values).toContain('flex')
    expect(values).toContain('items-center')
    expect(values).toContain('bg-blue-500')
    expect(values).toContain('text-white')
    expect(values).toContain('px-4')
    expect(values).toContain('py-2')
  })

  it('extracts classes from clsx() call', () => {
    const { classes } = parseClassesFromSource(sampleSource, fixture, true)
    const values = classes.map((c) => c.value)

    expect(values).toContain('rounded-lg')
    expect(values).toContain('p-4')
    expect(values).toContain('ring-2')
    expect(values).toContain('ring-blue-500')
  })

  it('extracts classes from cva() variants (not defaultVariants)', () => {
    const { classes } = parseClassesFromSource(sampleSource, fixture, true)
    const values = classes.map((c) => c.value)

    expect(values).toContain('inline-flex')
    expect(values).toContain('rounded')
    expect(values).toContain('bg-green-100')
    expect(values).toContain('text-green-800')
    expect(values).toContain('bg-red-100')
    expect(values).toContain('text-red-800')

    const staticClasses = classes.filter((c) => !c.isDynamic)
    expect(staticClasses.map((c) => c.value)).not.toContain('green')
  })

  it('flags template literals with expressions as dynamic', () => {
    const { classes } = parseClassesFromSource(sampleSource, fixture, true)
    const dynamic = classes.filter((c) => c.isDynamic)

    expect(dynamic.length).toBeGreaterThan(0)
    expect(dynamic.some((c) => c.value.includes('text-'))).toBe(true)
  })

  it('attaches file, line, and col to every extracted class', () => {
    const { classes } = parseClassesFromSource(sampleSource, fixture, true)

    for (const cls of classes) {
      expect(cls.file).toBe(fixture)
      expect(cls.line).toBeGreaterThan(0)
      expect(cls.col).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns an error (not a throw) when source is unparseable', () => {
    const { classes, error } = parseClassesFromSource('const x = {{{', fixture, false)
    expect(classes).toEqual([])
    expect(error).toBeInstanceOf(Error)
  })
})

describe('parseCssApply', () => {
  it('extracts classes from @apply rules', () => {
    const classes = parseCssApply(cssSource, cssFixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('bg-blue-500')
    expect(values).toContain('text-white')
    expect(values).toContain('px-4')
    expect(values).toContain('py-2')
    expect(values).toContain('rounded')
  })

  it('extracts classes from multiple @apply rules in the same block', () => {
    const classes = parseCssApply(cssSource, cssFixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('w-full')
    expect(values).toContain('max-w-screen-lg')
    expect(values).toContain('mx-auto')
    expect(values).toContain('px-4')
    expect(values).toContain('md:px-8')
  })

  it('extracts classes with responsive and state variants', () => {
    const classes = parseCssApply(cssSource, cssFixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('md:text-4xl')
    expect(values).toContain('hover:underline')
  })

  it('also extracts invalid classes (validation is separate)', () => {
    const classes = parseCssApply(cssSource, cssFixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('bg-fake-999')
    expect(values).toContain('text-nonexistent')
  })

  it('marks all extracted CSS classes as non-dynamic', () => {
    const classes = parseCssApply(cssSource, cssFixture)
    expect(classes.every((c) => c.isDynamic === false)).toBe(true)
  })

  it('attaches correct file, line, and col to every class', () => {
    const classes = parseCssApply(cssSource, cssFixture)

    for (const cls of classes) {
      expect(cls.file).toBe(cssFixture)
      expect(cls.line).toBeGreaterThan(0)
      expect(cls.col).toBeGreaterThanOrEqual(0)
    }
  })

  it('sets context to the @apply line', () => {
    const classes = parseCssApply(cssSource, cssFixture)
    const btnClass = classes.find((c) => c.value === 'bg-blue-500')

    expect(btnClass?.context).toContain('@apply')
    expect(btnClass?.context).toContain('bg-blue-500')
  })
})

describe('parseCssModuleClasses', () => {
  it('extracts class names defined in the CSS module', () => {
    const classes = parseCssModuleClasses(moduleCssSource)

    expect(classes.has('btn')).toBe(true)
    expect(classes.has('btnPrimary')).toBe(true)
    expect(classes.has('btnDisabled')).toBe(true)
  })

  it('does not include Tailwind classes from @apply lines', () => {
    const classes = parseCssModuleClasses(moduleCssSource)

    expect(classes.has('bg-blue-500')).toBe(false)
    expect(classes.has('text-white')).toBe(false)
    expect(classes.has('px-4')).toBe(false)
  })

  it('returns empty set for empty source', () => {
    expect(parseCssModuleClasses('').size).toBe(0)
  })
})

describe('parseClassesFromSource — expression patterns', () => {
  const f = '/fake/component.tsx'

  it('static template literal (no expressions) extracts all classes', () => {
    const { classes } = parseClassesFromSource(
      "export const x = clsx(`flex items-center bg-white`)",
      f, false,
    )
    const values = classes.map((c) => c.value)
    expect(values).toContain('flex')
    expect(values).toContain('items-center')
    expect(values).toContain('bg-white')
    expect(classes.every((c) => !c.isDynamic)).toBe(true)
  })

  it('array argument in clsx extracts each element', () => {
    const { classes } = parseClassesFromSource(
      "export const x = clsx(['bg-red-500', 'text-white'])",
      f, false,
    )
    const values = classes.map((c) => c.value)
    expect(values).toContain('bg-red-500')
    expect(values).toContain('text-white')
  })

  it('object with string-literal key extracts the key as a class', () => {
    const { classes } = parseClassesFromSource(
      "export const x = clsx({ 'bg-red-500': cond, 'text-white': true })",
      f, false,
    )
    const values = classes.map((c) => c.value)
    expect(values).toContain('bg-red-500')
    expect(values).toContain('text-white')
  })

  it('spread element inside object does not throw', () => {
    const { classes, error } = parseClassesFromSource(
      "export const x = clsx({ ...obj, 'p-4': true })",
      f, false,
    )
    expect(error).toBeUndefined()
    expect(classes.map((c) => c.value)).toContain('p-4')
  })

  it('conditional expression extracts both branches', () => {
    const { classes } = parseClassesFromSource(
      "export const x = clsx(cond ? 'bg-red-500' : 'bg-blue-500')",
      f, false,
    )
    const values = classes.map((c) => c.value)
    expect(values).toContain('bg-red-500')
    expect(values).toContain('bg-blue-500')
  })

  it('member-expression callee (utils.cn) at top level extracts arguments', () => {
    const { classes } = parseClassesFromSource(
      "export const x = utils.cn('flex', 'items-center')",
      f, false,
    )
    const values = classes.map((c) => c.value)
    expect(values).toContain('flex')
    expect(values).toContain('items-center')
  })

  it('member-expression callee nested inside clsx (visitExpression path) extracts arguments', () => {
    // nested call goes through visitExpression's CallExpression case, not walk's
    const { classes } = parseClassesFromSource(
      "export const x = clsx(utils.cn('flex', 'items-center'))",
      f, false,
    )
    const values = classes.map((c) => c.value)
    expect(values).toContain('flex')
    expect(values).toContain('items-center')
  })

  it('computed member-expression callee nested in clsx does not throw', () => {
    // utils['cn'](...) — computed callee → null → skipped, no crash
    const { classes, error } = parseClassesFromSource(
      "export const x = clsx(utils['cn']('flex'), 'text-white')",
      f, false,
    )
    expect(error).toBeUndefined()
    expect(classes.map((c) => c.value)).toContain('text-white')
  })

  it('spread argument in clsx does not throw and extracts sibling literals', () => {
    const { classes, error } = parseClassesFromSource(
      "export const x = clsx(...args, 'text-white')",
      f, false,
    )
    expect(error).toBeUndefined()
    expect(classes.map((c) => c.value)).toContain('text-white')
  })

  it('JSX namespaced attribute (xml:lang) does not throw', () => {
    const { classes, error } = parseClassesFromSource(
      'const C = () => <div xml:lang="en" className="flex" />',
      f, true,
    )
    expect(error).toBeUndefined()
    expect(classes.map((c) => c.value)).toContain('flex')
  })
})

describe('parseCssModuleUsages', () => {
  it('extracts static property access (styles.btn)', () => {
    const { usages } = parseCssModuleUsages(moduleSource, moduleFixture)
    const names = usages.map((u) => u.className)

    expect(names).toContain('btn')
  })

  it('extracts bracket notation with string literal (styles["btnPrimary"])', () => {
    const { usages } = parseCssModuleUsages(moduleSource, moduleFixture)
    const names = usages.map((u) => u.className)

    expect(names).toContain('btnPrimary')
  })

  it('flags dynamic access (styles[variable]) as isDynamic', () => {
    const { usages } = parseCssModuleUsages(moduleSource, moduleFixture)
    const dynamic = usages.filter((u) => u.isDynamic)

    expect(dynamic.length).toBeGreaterThan(0)
  })

  it('resolves modulePath to an absolute path', () => {
    const { usages } = parseCssModuleUsages(moduleSource, moduleFixture)

    for (const u of usages) {
      expect(path.isAbsolute(u.modulePath)).toBe(true)
      expect(u.modulePath).toContain('button.module.css')
    }
  })

  it('attaches file, line, col to every usage', () => {
    const { usages } = parseCssModuleUsages(moduleSource, moduleFixture)

    for (const u of usages) {
      expect(u.file).toBe(moduleFixture)
      expect(u.line).toBeGreaterThan(0)
      expect(u.col).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns empty usages for source with no CSS module imports', () => {
    const { usages } = parseCssModuleUsages(sampleSource, fixture)
    expect(usages).toEqual([])
  })

  it('returns an error (not a throw) when source is unparseable', () => {
    const { usages, error } = parseCssModuleUsages('const x = {{{', fixture)
    expect(usages).toEqual([])
    expect(error).toBeInstanceOf(Error)
  })
})
