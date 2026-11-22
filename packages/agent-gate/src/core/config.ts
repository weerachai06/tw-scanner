import type { CommandSpec, Config, Rule } from './types.js'

export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: string[] }

const DEFAULT_MAX_OUTPUT_CHARS = 4000

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

const isPositive = (v: unknown): v is number => typeof v === 'number' && v > 0

function validateRule(raw: any, i: number): string[] {
  if (!raw || typeof raw !== 'object') return [`rules[${i}]: must be an object`]
  const at = isNonEmptyString(raw.id) ? `rules[${i}] (${raw.id})` : `rules[${i}]`
  const errors: string[] = []
  if (!isNonEmptyString(raw.id)) errors.push(`${at}: "id" must be a non-empty string`)
  if (!isNonEmptyString(raw.message)) errors.push(`${at}: "message" must be a non-empty string`)
  if (raw.fix !== undefined && !isNonEmptyString(raw.fix))
    errors.push(`${at}: "fix" must be a non-empty string`)
  if (!isStringArray(raw.files) || raw.files.length === 0)
    errors.push(`${at}: "files" must be a non-empty array of strings`)
  if (raw.ignore !== undefined && !isStringArray(raw.ignore))
    errors.push(`${at}: "ignore" must be an array of strings`)
  if (raw.forbidImports !== undefined && !isStringArray(raw.forbidImports))
    errors.push(`${at}: "forbidImports" must be an array of strings`)
  if (raw.forbidImportNames !== undefined) errors.push(...validateImportNames(raw.forbidImportNames, at))
  if (raw.forbidGlobals !== undefined && !isStringArray(raw.forbidGlobals))
    errors.push(`${at}: "forbidGlobals" must be an array of strings`)
  return errors
}

function validateImportNames(raw: unknown, at: string): string[] {
  if (!Array.isArray(raw)) return [`${at}: "forbidImportNames" must be an array`]
  return raw.flatMap((entry: any, i: number) => {
    const name = `"forbidImportNames[${i}]`
    if (!entry || typeof entry !== 'object') return [`${at}: ${name}" must be an object`]
    const errors: string[] = []
    if (!isNonEmptyString(entry.from)) errors.push(`${at}: ${name}.from" must be a non-empty string`)
    if (!isStringArray(entry.names) || entry.names.length === 0)
      errors.push(`${at}: ${name}.names" must be a non-empty array of strings`)
    return errors
  })
}

function validateCommand(raw: any, i: number): string[] {
  if (!raw || typeof raw !== 'object') return [`commands[${i}]: must be an object`]
  const at = isNonEmptyString(raw.name) ? `commands[${i}] (${raw.name})` : `commands[${i}]`
  const errors: string[] = []
  if (!isNonEmptyString(raw.name)) errors.push(`${at}: "name" must be a non-empty string`)
  if (!isStringArray(raw.run) || raw.run.length === 0)
    errors.push(`${at}: "run" must be a non-empty array of strings`)
  if (raw.files !== undefined && !isStringArray(raw.files))
    errors.push(`${at}: "files" must be an array of strings`)
  if (raw.timeoutSec !== undefined && !isPositive(raw.timeoutSec))
    errors.push(`${at}: "timeoutSec" must be a positive number`)
  return errors
}

export function parseConfig(raw: string): ConfigResult {
  let data: any
  try {
    data = JSON.parse(raw)
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { ok: false, errors: ['config must be an object'] }

  // Only a missing field falls back to its default; null is a mistake, not "missing".
  const rules = data.rules === undefined ? [] : data.rules
  const commands = data.commands === undefined ? [] : data.commands
  const maxOutputChars = data.maxOutputChars === undefined ? DEFAULT_MAX_OUTPUT_CHARS : data.maxOutputChars

  if (!Array.isArray(rules)) return { ok: false, errors: ['"rules" must be an array'] }
  if (!Array.isArray(commands)) return { ok: false, errors: ['"commands" must be an array'] }
  if (!isPositive(maxOutputChars))
    return { ok: false, errors: ['"maxOutputChars" must be a positive number'] }
  if (data.base !== undefined && !isNonEmptyString(data.base))
    return { ok: false, errors: ['"base" must be a non-empty string'] }

  const errors = [
    ...rules.flatMap((r: unknown, i: number) => validateRule(r, i)),
    ...commands.flatMap((c: unknown, i: number) => validateCommand(c, i)),
  ]
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    config: {
      rules: rules as Rule[],
      commands: commands as CommandSpec[],
      maxOutputChars,
      ...(data.base !== undefined && { base: data.base as string }),
    },
  }
}
