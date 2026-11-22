import { parseSource, walk, type Node } from './ast.js'

/**
 * `module` is null when the specifier is not a string literal (cannot be checked).
 * `names` are the names taken from the module: 'default' and '*' for default and namespace imports.
 */
export interface ImportRef {
  module: string | null
  names: string[]
  line: number
  col: number
}

type Specifier = { type: string; importKind?: string; exportKind?: string; imported?: any; local?: any }

function nameOf(s: Specifier): string[] {
  if (s.type === 'ImportDefaultSpecifier') return ['default']
  if (s.type === 'ImportNamespaceSpecifier') return ['*']
  if (s.importKind === 'type' || s.exportKind === 'type') return []
  // ImportSpecifier has `imported`; ExportSpecifier has `local` (the name in the source module).
  const id = s.imported ?? s.local
  return [id.type === 'Identifier' ? id.name : String(id.value)]
}

function ref(node: Node, arg: Node | undefined | null, names: string[] = []): ImportRef {
  const module = arg?.type === 'Literal' && typeof arg.value === 'string' ? arg.value : null
  return { module, names, line: node.loc.start.line, col: node.loc.start.column }
}

/** Throws if `source` does not parse. */
export function extractImports(source: string, file: string): ImportRef[] {
  const out: ImportRef[] = []

  walk(parseSource(source, file), (node) => {
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type') {
      out.push(ref(node, node.source, node.specifiers.flatMap(nameOf)))
    } else if (node.type === 'ExportAllDeclaration' && node.source && node.exportKind !== 'type') {
      out.push(ref(node, node.source, ['*']))
    } else if (node.type === 'ExportNamedDeclaration' && node.source && node.exportKind !== 'type') {
      out.push(ref(node, node.source, node.specifiers.flatMap(nameOf)))
    } else if (node.type === 'ImportExpression') {
      out.push(ref(node, node.source))
    } else if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require'
    ) {
      out.push(ref(node, node.arguments[0]))
    }
  })

  return out
}
