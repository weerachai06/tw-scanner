import { describe, it, expect } from 'bun:test'
import path from 'path'
import { extractClassesFromFile, extractClassesFromCss } from '../src/extractor.js'

const fixture = path.resolve(import.meta.dir, 'fixtures/sample.tsx')
const cssFixture = path.resolve(import.meta.dir, 'fixtures/styles.css')

describe('extractClassesFromFile', () => {
  it('extracts classes from className prop', () => {
    const classes = extractClassesFromFile(fixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('flex')
    expect(values).toContain('items-center')
    expect(values).toContain('bg-blue-500')
    expect(values).toContain('text-white')
    expect(values).toContain('px-4')
    expect(values).toContain('py-2')
  })

  it('extracts classes from clsx() call', () => {
    const classes = extractClassesFromFile(fixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('rounded-lg')
    expect(values).toContain('p-4')
    expect(values).toContain('ring-2')
    expect(values).toContain('ring-blue-500')
  })

  it('extracts classes from cva() variants (not defaultVariants)', () => {
    const classes = extractClassesFromFile(fixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('inline-flex')
    expect(values).toContain('rounded')
    expect(values).toContain('bg-green-100')
    expect(values).toContain('text-green-800')
    expect(values).toContain('bg-red-100')
    expect(values).toContain('text-red-800')

    // defaultVariants values ('green') should NOT be extracted as class names
    const staticClasses = classes.filter((c) => !c.isDynamic)
    expect(staticClasses.map((c) => c.value)).not.toContain('green')
  })

  it('flags template literals with expressions as dynamic', () => {
    const classes = extractClassesFromFile(fixture)
    const dynamic = classes.filter((c) => c.isDynamic)

    expect(dynamic.length).toBeGreaterThan(0)
    expect(dynamic.some((c) => c.value.includes('text-'))).toBe(true)
  })

  it('attaches file, line, and col to every extracted class', () => {
    const classes = extractClassesFromFile(fixture)

    for (const cls of classes) {
      expect(cls.file).toBe(fixture)
      expect(cls.line).toBeGreaterThan(0)
      expect(cls.col).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns empty array for a file that does not exist', () => {
    const classes = extractClassesFromFile('/nonexistent/file.tsx')
    expect(classes).toEqual([])
  })
})

describe('extractClassesFromCss', () => {
  it('extracts classes from @apply rules', () => {
    const classes = extractClassesFromCss(cssFixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('bg-blue-500')
    expect(values).toContain('text-white')
    expect(values).toContain('px-4')
    expect(values).toContain('py-2')
    expect(values).toContain('rounded')
  })

  it('extracts classes from multiple @apply rules in the same block', () => {
    const classes = extractClassesFromCss(cssFixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('w-full')
    expect(values).toContain('max-w-screen-lg')
    expect(values).toContain('mx-auto')
    expect(values).toContain('px-4')
    expect(values).toContain('md:px-8')
  })

  it('extracts classes with responsive and state variants', () => {
    const classes = extractClassesFromCss(cssFixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('md:text-4xl')
    expect(values).toContain('hover:underline')
  })

  it('also extracts invalid classes (validation is separate)', () => {
    const classes = extractClassesFromCss(cssFixture)
    const values = classes.map((c) => c.value)

    expect(values).toContain('bg-fake-999')
    expect(values).toContain('text-nonexistent')
  })

  it('marks all extracted CSS classes as non-dynamic', () => {
    const classes = extractClassesFromCss(cssFixture)
    expect(classes.every((c) => c.isDynamic === false)).toBe(true)
  })

  it('attaches correct file, line, and col to every class', () => {
    const classes = extractClassesFromCss(cssFixture)

    for (const cls of classes) {
      expect(cls.file).toBe(cssFixture)
      expect(cls.line).toBeGreaterThan(0)
      expect(cls.col).toBeGreaterThanOrEqual(0)
    }
  })

  it('sets context to the @apply line', () => {
    const classes = extractClassesFromCss(cssFixture)
    const btnClass = classes.find((c) => c.value === 'bg-blue-500')

    expect(btnClass?.context).toContain('@apply')
    expect(btnClass?.context).toContain('bg-blue-500')
  })

  it('returns empty array for a file that does not exist', () => {
    expect(extractClassesFromCss('/nonexistent/styles.css')).toEqual([])
  })
})
