import { describe, it, expect, beforeAll } from 'bun:test'
import path from 'path'
import { loadTailwindContext, validateBatch, isValidClass } from '../src/validator.js'

const cssFile = path.resolve(import.meta.dir, 'fixtures/globals.css')

// compile takes a moment — load once for the whole suite
let context: Awaited<ReturnType<typeof loadTailwindContext>>

beforeAll(async () => {
  context = await loadTailwindContext(cssFile)
})

describe('loadTailwindContext', () => {
  it('loads without throwing', () => {
    expect(context).toBeDefined()
    expect(typeof context.build).toBe('function')
  })

  it('returns the same instance on repeated calls (cache)', async () => {
    const second = await loadTailwindContext(cssFile)
    expect(second).toBe(context)
  })

  it('throws when the CSS file does not exist', async () => {
    expect(loadTailwindContext('/nonexistent/tailwind.css')).rejects.toThrow()
  })
})

describe('isValidClass', () => {
  it('returns true for valid Tailwind classes', () => {
    expect(isValidClass('flex', context)).toBe(true)
    expect(isValidClass('text-white', context)).toBe(true)
    expect(isValidClass('bg-blue-500', context)).toBe(true)
    expect(isValidClass('px-4', context)).toBe(true)
    expect(isValidClass('rounded-lg', context)).toBe(true)
    expect(isValidClass('md:hidden', context)).toBe(true)
  })

  it('returns true for marker classes that generate no CSS', () => {
    expect(isValidClass('group', context)).toBe(true)
    expect(isValidClass('peer', context)).toBe(true)
    expect(isValidClass('group/sidebar', context)).toBe(true)
    expect(isValidClass('peer/input', context)).toBe(true)
  })

  it('returns false for invalid/nonexistent classes', () => {
    expect(isValidClass('bg-nonexistent-500', context)).toBe(false)
    expect(isValidClass('text-fake-color', context)).toBe(false)
    expect(isValidClass('not-a-class', context)).toBe(false)
  })

  describe('@theme custom tokens', () => {
    it('recognises custom color tokens', () => {
      expect(isValidClass('bg-brand-primary', context)).toBe(true)
      expect(isValidClass('bg-brand-secondary', context)).toBe(true)
      expect(isValidClass('text-brand-primary', context)).toBe(true)
      expect(isValidClass('bg-surface-muted', context)).toBe(true)
    })

    it('recognises custom spacing tokens', () => {
      expect(isValidClass('p-18', context)).toBe(true)
      expect(isValidClass('mt-22', context)).toBe(true)
      expect(isValidClass('w-18', context)).toBe(true)
    })

    it('recognises custom font-size token', () => {
      expect(isValidClass('text-display', context)).toBe(true)
    })

    it('rejects classes that look like custom tokens but are not defined', () => {
      expect(isValidClass('bg-brand-tertiary', context)).toBe(false)
      expect(isValidClass('text-headline', context)).toBe(false)
    })

    it('v4 open spacing scale: arbitrary numbers are always valid', () => {
      // Tailwind v4 generates calc(var(--spacing) * N) for any integer
      expect(isValidClass('p-99', context)).toBe(true)
      expect(isValidClass('mt-100', context)).toBe(true)
    })
  })
})

describe('validateBatch', () => {
  it('validates a mixed list correctly', () => {
    const result = validateBatch(
      ['flex', 'items-center', 'bg-fake-999', 'p-4', 'totally-invalid'],
      context,
    )

    expect(result.get('flex')).toBe(true)
    expect(result.get('items-center')).toBe(true)
    expect(result.get('p-4')).toBe(true)
    expect(result.get('bg-fake-999')).toBe(false)
    expect(result.get('totally-invalid')).toBe(false)
  })

  it('returns an entry for every input class', () => {
    const input = ['flex', 'fake-class', 'text-sm']
    const result = validateBatch(input, context)

    expect(result.size).toBe(input.length)
    for (const cls of input) {
      expect(result.has(cls)).toBe(true)
    }
  })

  it('handles an empty list', () => {
    const result = validateBatch([], context)
    expect(result.size).toBe(0)
  })
})
