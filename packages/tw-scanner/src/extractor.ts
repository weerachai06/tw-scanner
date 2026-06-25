import { parse, TSESTree } from '@typescript-eslint/typescript-estree'
import * as path from 'path'
import { ExtractedClass, CssModuleUsage } from './types.js'

// ─── Class utility function names to detect ──────────────────────────────────
const CLASS_UTIL_NAMES = new Set(['clsx', 'cn', 'cx', 'classnames', 'cva', 'tv'])

// JSX props that contain class strings
const CLASS_PROPS = new Set(['className', 'class'])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeExtracted(
  value: string,
  node: TSESTree.Node,
  file: string,
  source: string,
  isDynamic = false,
): ExtractedClass[] {
  const classes = isDynamic
    ? [value] // keep raw template for dynamic
    : value.split(/\s+/).filter(Boolean)

  return classes.map((cls) => ({
    value: cls,
    file,
    line: node.loc.start.line,
    col: node.loc.start.column,
    isDynamic,
    context: source.slice(
      Math.max(0, (node.range?.[0] ?? 0) - 30),
      Math.min(source.length, (node.range?.[1] ?? 0) + 30),
    ).replace(/\n/g, ' ').trim(),
  }))
}

// ─── Node visitors ────────────────────────────────────────────────────────────

function visitLiteral(
  node: TSESTree.Literal,
  file: string,
  source: string,
): ExtractedClass[] {
  if (typeof node.value !== 'string' || !node.value.trim()) return []
  return makeExtracted(node.value, node, file, source, false)
}

function visitTemplateLiteral(
  node: TSESTree.TemplateLiteral,
  file: string,
  source: string,
): ExtractedClass[] {
  const results: ExtractedClass[] = []
  const hasDynamic = node.expressions.length > 0

  if (hasDynamic) {
    for (const quasi of node.quasis) {
      const raw = quasi.value.cooked ?? quasi.value.raw
      const staticParts = raw.split(/\s+/).filter(Boolean)
      for (const part of staticParts) {
        if (part && !part.endsWith('-') && !part.endsWith(':')) {
          results.push({
            value: part,
            file,
            line: quasi.loc.start.line,
            col: quasi.loc.start.column,
            isDynamic: false,
            context: source.slice(
              Math.max(0, (node.range?.[0] ?? 0) - 20),
              Math.min(source.length, (node.range?.[1] ?? 0) + 20),
            ).replace(/\n/g, ' ').trim(),
          })
        }
      }
    }

    const rawTemplate = source.slice(node.range?.[0] ?? 0, node.range?.[1] ?? 0)
    results.push({
      value: rawTemplate,
      file,
      line: node.loc.start.line,
      col: node.loc.start.column,
      isDynamic: true,
      context: rawTemplate.replace(/\n/g, ' ').trim(),
    })
  } else {
    const cooked = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('')
    results.push(...makeExtracted(cooked, node, file, source, false))
  }

  return results
}

function visitExpression(
  node: TSESTree.Expression | TSESTree.SpreadElement,
  file: string,
  source: string,
): ExtractedClass[] {
  const results: ExtractedClass[] = []

  switch (node.type) {
    case 'Literal':
      results.push(...visitLiteral(node, file, source))
      break

    case 'TemplateLiteral':
      results.push(...visitTemplateLiteral(node, file, source))
      break

    case 'ArrayExpression':
      for (const el of node.elements) {
        if (el) results.push(...visitExpression(el, file, source))
      }
      break

    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (prop.type === 'Property') {
          const key = prop.key
          const val = prop.value as TSESTree.Expression

          if (key.type === 'Literal' && typeof key.value === 'string') {
            results.push(...makeExtracted(key.value, key, file, source, false))
          }

          if (key.type === 'Identifier') {
            if (key.name === 'defaultVariants') continue
            results.push(...visitExpression(val, file, source))
          }
        } else if (prop.type === 'SpreadElement') {
          results.push(...visitExpression(prop.argument, file, source))
        }
      }
      break

    case 'ConditionalExpression':
      results.push(...visitExpression(node.consequent, file, source))
      results.push(...visitExpression(node.alternate, file, source))
      break

    case 'LogicalExpression':
      results.push(...visitExpression(node.left, file, source))
      results.push(...visitExpression(node.right, file, source))
      break

    case 'CallExpression': {
      const callee = node.callee
      const name =
        callee.type === 'Identifier'
          ? callee.name
          : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
          ? callee.property.name
          : null
      if (name && CLASS_UTIL_NAMES.has(name)) {
        for (const arg of node.arguments) {
          results.push(...visitExpression(arg, file, source))
        }
      }
      break
    }

    case 'SpreadElement':
      results.push(...visitExpression(node.argument, file, source))
      break
  }

  return results
}

// ─── Walk entire AST ──────────────────────────────────────────────────────────

function walk(
  node: TSESTree.Node,
  file: string,
  source: string,
  results: ExtractedClass[],
  visited = new WeakSet<TSESTree.Node>(),
) {
  if (!node || visited.has(node)) return
  visited.add(node)

  if (node.type === 'JSXAttribute') {
    const nameNode = node.name
    const attrName =
      nameNode.type === 'JSXIdentifier'
        ? nameNode.name
        : nameNode.type === 'JSXNamespacedName'
        ? nameNode.name.name
        : ''

    if (CLASS_PROPS.has(attrName) && node.value) {
      const val = node.value

      if (val.type === 'Literal') {
        results.push(...visitLiteral(val, file, source))
      } else if (val.type === 'JSXExpressionContainer') {
        const expr = val.expression
        if (expr.type !== 'JSXEmptyExpression') {
          results.push(...visitExpression(expr, file, source))
        }
      }
    }
  }

  if (node.type === 'CallExpression') {
    const callee = node.callee
    const calleeName =
      callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
        ? callee.property.name
        : null

    if (calleeName && CLASS_UTIL_NAMES.has(calleeName)) {
      for (const arg of node.arguments) {
        results.push(...visitExpression(arg, file, source))
      }
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'tokens' || key === 'comments') continue
    const child = (node as TSESTree.Node & Record<string, unknown>)[key]
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && 'type' in c) {
          walk(c as TSESTree.Node, file, source, results, visited)
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      walk(child as TSESTree.Node, file, source, results, visited)
    }
  }
}

// ─── Public API (pure — no file I/O) ─────────────────────────────────────────

/**
 * Parse Tailwind classes from JS/TS/JSX/TSX source.
 * Returns classes found, plus an error if the AST parse failed.
 */
export function parseClassesFromSource(
  source: string,
  file: string,
  isJSX: boolean,
): { classes: ExtractedClass[]; error?: Error } {
  let ast: TSESTree.Program
  try {
    ast = parse(source, { jsx: isJSX, loc: true, range: true, tolerant: true })
  } catch (err) {
    return { classes: [], error: err as Error }
  }

  const results: ExtractedClass[] = []
  walk(ast, file, source, results)

  const seen = new Set<string>()
  const classes = results.filter((r) => {
    const key = `${r.value}:${r.line}:${r.col}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { classes }
}

/**
 * Parse Tailwind classes from CSS @apply directives.
 */
export function parseCssApply(source: string, file: string): ExtractedClass[] {
  const results: ExtractedClass[] = []
  const lines = source.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^\s*@apply\s+(.+?)\s*;/)
    if (!match) continue

    const classStr = match[1]
    const col = line.indexOf('@apply')
    classStr.split(/\s+/).filter(Boolean).forEach((cls) => {
      results.push({ value: cls, file, line: i + 1, col, isDynamic: false, context: line.trim() })
    })
  }

  return results
}

/**
 * Parse CSS module usages (styles.foo / styles['foo']) from JS/TS source.
 * Resolves module paths relative to `file`. Returns an error if AST parse failed.
 */
export function parseCssModuleUsages(
  source: string,
  file: string,
): { usages: CssModuleUsage[]; error?: Error } {
  const isJSX = /\.(tsx|jsx)$/.test(file)

  let ast: TSESTree.Program
  try {
    ast = parse(source, { jsx: isJSX, loc: true, range: true, tolerant: true })
  } catch (err) {
    return { usages: [], error: err as Error }
  }

  // Pass 1: collect `import styles from './foo.module.css'` → binding → resolved path
  const imports = new Map<string, string>()
  for (const node of ast.body) {
    if (
      node.type === 'ImportDeclaration' &&
      typeof node.source.value === 'string' &&
      node.source.value.endsWith('.module.css')
    ) {
      const resolvedPath = path.resolve(path.dirname(file), node.source.value)
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          imports.set(specifier.local.name, resolvedPath)
        }
      }
    }
  }

  if (imports.size === 0) return { usages: [] }

  // Pass 2: collect `styles.btn` / `styles['btn']` / `styles[expr]` usages
  const usages: CssModuleUsage[] = []

  function walkForUsages(node: TSESTree.Node) {
    if (!node) return

    if (node.type === 'MemberExpression') {
      const obj = node.object
      if (obj.type === 'Identifier' && imports.has(obj.name)) {
        const modulePath = imports.get(obj.name)!
        const prop = node.property
        const snippet = source.slice(
          Math.max(0, (node.range?.[0] ?? 0) - 20),
          Math.min(source.length, (node.range?.[1] ?? 0) + 20),
        ).replace(/\n/g, ' ').trim()

        if (!node.computed && prop.type === 'Identifier') {
          usages.push({ file, line: node.loc!.start.line, col: node.loc!.start.column, className: prop.name, modulePath, context: snippet, isDynamic: false })
        } else if (node.computed && prop.type === 'Literal' && typeof prop.value === 'string') {
          usages.push({ file, line: node.loc!.start.line, col: node.loc!.start.column, className: prop.value, modulePath, context: snippet, isDynamic: false })
        } else if (node.computed) {
          usages.push({ file, line: node.loc!.start.line, col: node.loc!.start.column, className: source.slice(node.range?.[0] ?? 0, node.range?.[1] ?? 0), modulePath, context: snippet, isDynamic: true })
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'tokens' || key === 'comments') continue
      const child = (node as TSESTree.Node & Record<string, unknown>)[key]
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && 'type' in c) walkForUsages(c as TSESTree.Node)
        }
      } else if (child && typeof child === 'object' && 'type' in child) {
        walkForUsages(child as TSESTree.Node)
      }
    }
  }

  walkForUsages(ast)
  return { usages }
}

/**
 * Parse class names defined in a CSS module file.
 * Returns all `.className` selectors, excluding @apply lines.
 */
export function parseCssModuleClasses(source: string): Set<string> {
  const classes = new Set<string>()
  const lines = source.split('\n')

  for (const line of lines) {
    if (line.trimStart().startsWith('@apply')) continue
    const regex = /\.([a-zA-Z_][a-zA-Z0-9_-]*)\b/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(line)) !== null) {
      classes.add(m[1])
    }
  }

  return classes
}
