import { describe, it, expect } from 'bun:test'
import { parseConfig } from '../src/core/config.js'

const rule = { id: 'r1', files: ['src/core/**'], message: 'keep core pure', forbidImports: ['fs'] }

describe('parseConfig', () => {
  it('accepts a valid config', () => {
    const result = parseConfig(JSON.stringify({ rules: [rule] }))
    expect(result).toEqual({
      ok: true,
      config: { rules: [rule], commands: [], maxOutputChars: 4000 },
    })
  })

  it('accepts an empty rules list', () => {
    expect(parseConfig('{"rules":[]}')).toEqual({
      ok: true,
      config: { rules: [], commands: [], maxOutputChars: 4000 },
    })
  })

  it('reports invalid JSON', () => {
    const result = parseConfig('{')
    expect(result.ok).toBe(false)
  })

  it('allows a config with only commands', () => {
    const result = parseConfig('{"commands":[{"name":"t","run":["bun","test"]}]}')
    expect(result.ok).toBe(true)
  })

  it('reports rules that is not an array', () => {
    const result = parseConfig('{"rules":"x"}')
    expect(result).toEqual({ ok: false, errors: ['"rules" must be an array'] })
  })

  it('reports a rule without files', () => {
    const { files, ...noFiles } = rule
    const result = parseConfig(JSON.stringify({ rules: [noFiles] }))
    expect(result).toEqual({
      ok: false,
      errors: ['rules[0] (r1): "files" must be a non-empty array of strings'],
    })
  })

  it('reports a rule without id or message', () => {
    const result = parseConfig(JSON.stringify({ rules: [{ files: ['a'] }] }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain('rules[0]: "id" must be a non-empty string')
      expect(result.errors).toContain('rules[0]: "message" must be a non-empty string')
    }
  })

  it('reports forbidImports that is not a string array', () => {
    const result = parseConfig(JSON.stringify({ rules: [{ ...rule, forbidImports: 'fs' }] }))
    expect(result.ok).toBe(false)
  })

  it('accepts commands and maxOutputChars', () => {
    const cmd = { name: 'typecheck', run: ['bun', 'run', 'typecheck'], files: ['**/*.ts'], timeoutSec: 30 }
    const result = parseConfig(JSON.stringify({ commands: [cmd], maxOutputChars: 100 }))
    expect(result).toEqual({ ok: true, config: { rules: [], commands: [cmd], maxOutputChars: 100 } })
  })

  it('reports a bad command', () => {
    const result = parseConfig(
      JSON.stringify({ commands: [{ name: 't', run: [] }, { run: ['x'] }, { name: 'u', run: ['x'], timeoutSec: 0 }] }),
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        'commands[0] (t): "run" must be a non-empty array of strings',
        'commands[1]: "name" must be a non-empty string',
        'commands[2] (u): "timeoutSec" must be a positive number',
      ],
    })
  })

  it('reports commands that is not an array and a bad maxOutputChars', () => {
    expect(parseConfig('{"commands":{}}')).toEqual({ ok: false, errors: ['"commands" must be an array'] })
    expect(parseConfig('{"maxOutputChars":-1}')).toEqual({
      ok: false,
      errors: ['"maxOutputChars" must be a positive number'],
    })
  })

  it('accepts forbidImportNames and forbidGlobals', () => {
    const full = {
      ...rule,
      forbidImportNames: [{ from: 'react', names: ['use*'] }],
      forbidGlobals: ['fetch'],
    }
    const result = parseConfig(JSON.stringify({ rules: [full] }))
    expect(result).toEqual({ ok: true, config: { rules: [full], commands: [], maxOutputChars: 4000 } })
  })

  it('reports bad forbidImportNames and forbidGlobals', () => {
    const bad = {
      ...rule,
      forbidImportNames: [{ from: '', names: ['a'] }, { from: 'react', names: [] }, 'x'],
      forbidGlobals: 'fetch',
    }
    const result = parseConfig(JSON.stringify({ rules: [bad] }))
    expect(result).toEqual({
      ok: false,
      errors: [
        'rules[0] (r1): "forbidImportNames[0].from" must be a non-empty string',
        'rules[0] (r1): "forbidImportNames[1].names" must be a non-empty array of strings',
        'rules[0] (r1): "forbidImportNames[2]" must be an object',
        'rules[0] (r1): "forbidGlobals" must be an array of strings',
      ],
    })
  })

  it('reports forbidImportNames that is not an array', () => {
    const result = parseConfig(JSON.stringify({ rules: [{ ...rule, forbidImportNames: {} }] }))
    expect(result.ok).toBe(false)
  })

  it('accepts a base ref', () => {
    const result = parseConfig('{"base":"origin/develop"}')
    expect(result).toEqual({
      ok: true,
      config: { rules: [], commands: [], maxOutputChars: 4000, base: 'origin/develop' },
    })
  })

  it('reports a base that is not a non-empty string', () => {
    expect(parseConfig('{"base":""}')).toEqual({ ok: false, errors: ['"base" must be a non-empty string'] })
    expect(parseConfig('{"base":3}')).toEqual({ ok: false, errors: ['"base" must be a non-empty string'] })
  })

  it('rejects an array, a string, and null as the config', () => {
    for (const raw of ['[]', '[1]', '"x"', 'null', '3']) {
      expect(parseConfig(raw)).toEqual({ ok: false, errors: ['config must be an object'] })
    }
  })

  it('does not treat null as a missing field', () => {
    expect(parseConfig('{"rules":null}')).toEqual({ ok: false, errors: ['"rules" must be an array'] })
    expect(parseConfig('{"commands":null}')).toEqual({ ok: false, errors: ['"commands" must be an array'] })
    expect(parseConfig('{"maxOutputChars":null}')).toEqual({
      ok: false,
      errors: ['"maxOutputChars" must be a positive number'],
    })
  })

  it('ignores $schema and other keys it does not know', () => {
    const result = parseConfig('{"$schema":"https://example.com/s.json","whatever":1}')
    expect(result).toEqual({ ok: true, config: { rules: [], commands: [], maxOutputChars: 4000 } })
  })
})
