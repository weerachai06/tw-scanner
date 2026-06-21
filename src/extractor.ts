import { parse, TSESTree } from '@typescript-eslint/typescript-estree'
import * as fs from 'fs'
import { ExtractedClass } from './types.js'

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

// Escape regex special chars
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Node visitors ────────────────────────────────────────────────────────────

/**
 * Extract classes from a Literal (plain string)
 */
function visitLiteral(
  node: TSESTree.Literal,
  file: string,
  source: string,
): ExtractedClass[] {
  if (typeof node.value !== 'string' || !node.value.trim()) return []
  return makeExtracted(node.value, node, file, source, false)
}

/**
 * Extract classes from a TemplateLiteral.
 * Quasis (static parts) are extracted normally.
 * If there are expressions, we flag the whole thing as dynamic.
 */
function visitTemplateLiteral(
  node: TSESTree.TemplateLiteral,
  file: string,
  source: string,
): ExtractedClass[] {
  const results: ExtractedClass[] = []
  const hasDynamic = node.expressions.length > 0

  if (hasDynamic) {
    // Extract static quasis individually — they may be valid standalone classes
    for (const quasi of node.quasis) {
      const raw = quasi.value.cooked ?? quasi.value.raw
      const staticParts = raw.split(/\s+/).filter(Boolean)
      for (const part of staticParts) {
        // Skip parts that look like incomplete prefixes (e.g. "text-", "bg-")
        // These are the left/right edges of a dynamic expression: `text-${x}`
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

    // Also record the whole template as dynamic for the warning report
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
    // Fully static template — treat like a plain string
    const cooked = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('')
    results.push(...makeExtracted(cooked, node, file, source, false))
  }

  return results
}

/**
 * Extract classes from an ArrayExpression (clsx(['a', 'b', cond && 'c']))
 */
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

          // Pattern 1: { 'bg-red-500': condition } — key is the class name
          if (key.type === 'Literal' && typeof key.value === 'string') {
            results.push(...makeExtracted(key.value, key, file, source, false))
          }

          // Pattern 2: cva({ variants: { size: { sm: 'text-sm', lg: 'text-lg' } } })
          // Key is an Identifier (e.g. "sm", "danger") and VALUE is the class string
          if (key.type === 'Identifier') {
            // Skip cva's `defaultVariants` key — values are variant names, not class strings
            // e.g. defaultVariants: { variant: 'default', size: 'md' }
            if (key.name === 'defaultVariants') continue

            // Recurse into the value — it could be a string, nested object, etc.
            results.push(...visitExpression(val, file, source))
          }
        } else if (prop.type === 'SpreadElement') {
          results.push(...visitExpression(prop.argument, file, source))
        }
      }
      break

    case 'ConditionalExpression':
      // cond ? 'a' : 'b'
      results.push(...visitExpression(node.consequent, file, source))
      results.push(...visitExpression(node.alternate, file, source))
      break

    case 'LogicalExpression':
      // cond && 'a'  |  cond || 'b'  |  cond ?? 'c'
      results.push(...visitExpression(node.left, file, source))
      results.push(...visitExpression(node.right, file, source))
      break

    case 'CallExpression': {
      // nested clsx / cn / cva calls
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

  // ── JSX className="..." ──
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

  // ── clsx(...) / cn(...) / cva(...) calls ──
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

    // cva('base', { variants: { size: { sm: 'text-sm' } } })
    // Already handled by nested visitExpression calls above
  }

  // ── Recurse into children ──
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

// ─── CSS @apply extractor ─────────────────────────────────────────────────────

export function extractClassesFromCss(file: string): ExtractedClass[] {
  if (!fs.existsSync(file)) return []
  const source = fs.readFileSync(file, 'utf8')
  const results: ExtractedClass[] = []

  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^\s*@apply\s+(.+?)\s*;/)
    if (!match) continue

    const classStr = match[1]
    const col = line.indexOf('@apply')
    classStr.split(/\s+/).filter(Boolean).forEach((cls) => {
      results.push({
        value: cls,
        file,
        line: i + 1,
        col,
        isDynamic: false,
        context: line.trim(),
      })
    })
  }

  return results
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function extractClassesFromFile(file: string): ExtractedClass[] {
  if (!fs.existsSync(file)) return []
  const source = fs.readFileSync(file, 'utf8')
  const isJSX = /\.(tsx|jsx)$/.test(file)

  let ast: TSESTree.Program
  try {
    ast = parse(source, {
      jsx: isJSX,
      loc: true,
      range: true,
      tolerant: true,
    })
  } catch (err) {
    console.warn(`⚠  Parse error in ${file}: ${(err as Error).message}`)
    return []
  }

  const results: ExtractedClass[] = []
  walk(ast, file, source, results)

  // Deduplicate by value+line+col
  const seen = new Set<string>()
  return results.filter((r) => {
    const key = `${r.value}:${r.line}:${r.col}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
