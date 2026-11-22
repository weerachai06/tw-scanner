import { parse, TSESTree } from '@typescript-eslint/typescript-estree'

export type Node = TSESTree.Node

/** Throws if `source` does not parse. */
export function parseSource(source: string, file: string): TSESTree.Program {
  return parse(source, { jsx: /\.[jt]sx$/.test(file), loc: true, range: true })
}

/** Depth-first walk. `visit` returns false to skip a node's children. */
export function walk(
  node: Node,
  visit: (node: Node, parent: Node | null, key: string) => boolean | void,
  parent: Node | null = null,
  key = '',
): void {
  if (visit(node, parent, key) === false) return
  for (const [k, child] of Object.entries(node)) {
    if (k === 'parent' || k === 'loc' || k === 'range') continue
    if (Array.isArray(child)) {
      for (const c of child) if (c && typeof c === 'object' && 'type' in c) walk(c, visit, node, k)
    } else if (child && typeof child === 'object' && 'type' in child) {
      walk(child as Node, visit, node, k)
    }
  }
}
