import { parseSource, walk, type Node } from './ast.js'

export interface GlobalRef {
  name: string
  line: number
  col: number
}

// TS nodes that wrap a value expression; every other TS node is a type and is skipped.
const TS_EXPRESSIONS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
])

/** Identifier positions that name something rather than use it. */
function isReference(parent: Node, key: string): boolean {
  switch (parent.type) {
    case 'MemberExpression':
      return !(key === 'property' && !parent.computed)
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return !(key === 'key' && !parent.computed)
    case 'VariableDeclarator':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return key !== 'id'
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      return key !== 'id' && key !== 'params'
    case 'ArrowFunctionExpression':
      return key !== 'params'
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'CatchClause':
      return false
    case 'AssignmentPattern':
      return key !== 'left'
    default:
      return true
  }
}

/**
 * Every identifier that is used (not declared) in the file. There is no scope analysis,
 * so a local variable that shadows a global is reported too. Destructuring patterns are skipped.
 * Throws if `source` does not parse.
 */
export function extractGlobals(source: string, file: string): GlobalRef[] {
  const out: GlobalRef[] = []

  walk(parseSource(source, file), (node, parent, key) => {
    if (node.type.startsWith('TS') && !TS_EXPRESSIONS.has(node.type)) return false
    if (node.type === 'ObjectPattern' || node.type === 'ArrayPattern') return false
    if (node.type === 'Identifier' && parent && isReference(parent, key)) {
      out.push({ name: node.name, line: node.loc.start.line, col: node.loc.start.column })
    }
  })

  return out
}
