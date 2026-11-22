import { describe, it, expect } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'
import Ajv from 'ajv'
import { parseConfig } from '../src/core/config.js'

const schema = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, '../schema.json'), 'utf8'))
const validate = new Ajv({ strict: true }).compile(schema)

const rule = { id: 'r', files: ['src/**'], message: 'm' }
const command = { name: 'c', run: ['bun', 'test'] }

/** The schema and the parser say the same thing twice. Every case must get the same verdict from both. */
const valid: [string, unknown][] = [
  ['empty object', {}],
  ['empty rules', { rules: [] }],
  ['minimal rule', { rules: [rule] }],
  ['rule with fix', { rules: [{ ...rule, fix: 'move I/O to the shell' }] }],
  ['minimal command', { commands: [command] }],
  [
    'every field',
    {
      $schema: 'https://example.com/schema.json',
      base: 'origin/main',
      maxOutputChars: 4000,
      rules: [
        {
          ...rule,
          ignore: ['**/*.test.ts'],
          forbidImports: ['fs'],
          forbidImportNames: [{ from: 'react', names: ['use*'] }],
          forbidGlobals: ['fetch'],
        },
      ],
      commands: [{ ...command, files: ['**/*.ts'], timeoutSec: 30 }],
    },
  ],
  ['empty ignore and forbid lists', { rules: [{ ...rule, ignore: [], forbidImports: [], forbidGlobals: [] }] }],
  ['non-integer maxOutputChars', { maxOutputChars: 1.5 }],
  ['non-integer timeoutSec', { commands: [{ ...command, timeoutSec: 0.5 }] }],
]

const invalid: [string, unknown][] = [
  ['an array at the top level', []],
  ['rules that is not an array', { rules: 'x' }],
  ['rules that is null', { rules: null }],
  ['commands that is not an array', { commands: {} }],
  ['commands that is null', { commands: null }],
  ['a rule that is not an object', { rules: [1] }],
  ['a rule with an empty fix', { rules: [{ ...rule, fix: '' }] }],
  ['a rule that is null', { rules: [null] }],
  ['a rule without id', { rules: [{ files: ['a'], message: 'm' }] }],
  ['a rule with an empty id', { rules: [{ ...rule, id: '' }] }],
  ['a rule without message', { rules: [{ id: 'r', files: ['a'] }] }],
  ['a rule with an empty message', { rules: [{ ...rule, message: '' }] }],
  ['a rule without files', { rules: [{ id: 'r', message: 'm' }] }],
  ['a rule with empty files', { rules: [{ ...rule, files: [] }] }],
  ['a rule with non-string files', { rules: [{ ...rule, files: [1] }] }],
  ['ignore that is a string', { rules: [{ ...rule, ignore: '**' }] }],
  ['forbidImports that is a string', { rules: [{ ...rule, forbidImports: 'fs' }] }],
  ['forbidGlobals that is a string', { rules: [{ ...rule, forbidGlobals: 'fetch' }] }],
  ['forbidImportNames that is not an array', { rules: [{ ...rule, forbidImportNames: {} }] }],
  ['a forbidImportNames entry that is a string', { rules: [{ ...rule, forbidImportNames: ['x'] }] }],
  ['a forbidImportNames entry without from', { rules: [{ ...rule, forbidImportNames: [{ names: ['a'] }] }] }],
  ['a forbidImportNames entry with an empty from', { rules: [{ ...rule, forbidImportNames: [{ from: '', names: ['a'] }] }] }],
  ['a forbidImportNames entry with empty names', { rules: [{ ...rule, forbidImportNames: [{ from: 'react', names: [] }] }] }],
  ['a forbidImportNames entry without names', { rules: [{ ...rule, forbidImportNames: [{ from: 'react' }] }] }],
  ['a command that is not an object', { commands: [1] }],
  ['a command without name', { commands: [{ run: ['x'] }] }],
  ['a command with an empty name', { commands: [{ ...command, name: '' }] }],
  ['a command without run', { commands: [{ name: 'c' }] }],
  ['a command with empty run', { commands: [{ ...command, run: [] }] }],
  ['a command with non-string run', { commands: [{ ...command, run: [1] }] }],
  ['a command with files that is a string', { commands: [{ ...command, files: '**' }] }],
  ['timeoutSec 0', { commands: [{ ...command, timeoutSec: 0 }] }],
  ['negative timeoutSec', { commands: [{ ...command, timeoutSec: -1 }] }],
  ['timeoutSec that is a string', { commands: [{ ...command, timeoutSec: '5' }] }],
  ['maxOutputChars 0', { maxOutputChars: 0 }],
  ['negative maxOutputChars', { maxOutputChars: -1 }],
  ['maxOutputChars that is a string', { maxOutputChars: '4000' }],
  ['maxOutputChars that is null', { maxOutputChars: null }],
  ['an empty base', { base: '' }],
  ['a base that is a number', { base: 3 }],
  ['a base that is null', { base: null }],
]

describe('schema.json agrees with parseConfig', () => {
  it.each(valid)('both accept %s', (_name, config) => {
    expect(validate(config)).toBe(true)
    expect(parseConfig(JSON.stringify(config)).ok).toBe(true)
  })

  it.each(invalid)('both reject %s', (_name, config) => {
    expect(validate(config)).toBe(false)
    expect(parseConfig(JSON.stringify(config)).ok).toBe(false)
  })
})

describe('schema.json is stricter than the parser on purpose', () => {
  // The parser ignores keys it does not know. The schema rejects them so an editor flags a typo.
  it.each([
    ['an unknown top-level key', { rulez: [] }],
    ['an unknown rule key', { rules: [{ ...rule, forbidImport: ['fs'] }] }],
    ['an unknown command key', { commands: [{ ...command, timeout: 5 }] }],
    ['an unknown forbidImportNames key', { rules: [{ ...rule, forbidImportNames: [{ from: 'a', names: ['b'], extra: 1 }] }] }],
  ])('rejects %s, which the parser ignores', (_name, config) => {
    expect(validate(config)).toBe(false)
    expect(parseConfig(JSON.stringify(config)).ok).toBe(true)
  })
})

describe('schema.json as a document', () => {
  it('declares the draft it is written in and a title', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
    expect(schema.title).toBeTruthy()
  })

  it('lets a config point at the schema with $schema', () => {
    expect(schema.properties.$schema.type).toBe('string')
  })

  it('describes every property, so editors can show a tooltip', () => {
    const missing: string[] = []
    const walk = (node: any, where: string) => {
      for (const [key, prop] of Object.entries<any>(node.properties ?? {})) {
        if (!prop.description) missing.push(`${where}.${key}`)
        walk(prop.items ?? prop, `${where}.${key}`)
      }
    }
    walk(schema, '$')
    expect(missing).toEqual([])
  })

  it('is listed in the published files', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, '../package.json'), 'utf8'))
    expect(pkg.files).toContain('schema.json')
  })
})
