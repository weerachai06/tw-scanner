import type { Violation } from './types.js'

const IO = 'Do not do I/O here. Return data or a description of the effect and let the caller (the shell) perform it.'

// Keyed by the module or global that was found. `node:` and subpaths are stripped first.
const HINTS: Record<string, string> = {
  fs: `${IO} Take file contents as an argument instead of reading the file.`,
  child_process: `${IO} Return the argv to run instead of spawning it.`,
  net: `${IO} Let the shell open the connection and pass the result in.`,
  http: `${IO} Let the shell make the request and pass the response in.`,
  https: `${IO} Let the shell make the request and pass the response in.`,
  fetch: `${IO} Let the shell make the request and pass the response in.`,
  process: `${IO} Let the shell read env, argv or cwd and pass them in as arguments.`,
}

const REACT_HOOK = 'Hooks belong in a component, not in this file. Pass the value in as an argument.'

export function hintFor(v: Violation): string | undefined {
  if (v.kind === 'import-name') return /^use\w* from "react/.test(v.found) ? REACT_HOOK : undefined
  if (v.kind !== 'import' && v.kind !== 'global') return undefined
  const name = v.found.replace(/^node:/, '').split('/')[0]!
  return HINTS[name]
}
