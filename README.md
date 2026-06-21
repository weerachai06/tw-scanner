# tw-scanner

AST-based Tailwind v4 class validator for React projects.
Detects invalid, renamed, or missing classes after design token / plugin migrations.

## Setup

```bash
npm install
```

Dependencies: `@tailwindcss/node`, `@typescript-eslint/typescript-estree`, `glob`, `picocolors`, `tsx`

## Usage

```bash
npx tsx src/cli.ts --src ./src --css ./src/globals.css
```

### Options

| Flag | Description |
|---|---|
| `--src` | Directory to scan (default: `./src`) |
| `--css` | Path to Tailwind v4 CSS entry file (with `@import tailwindcss` + `@theme`) |
| `--verbose` | Show source context snippet for each error |
| `--output report.json` | Save full JSON report to file |
| `--json` | Print JSON report to stdout (for CI piping) |

### Examples

```bash
# Basic scan
npx tsx src/cli.ts --src ./src --css ./src/globals.css

# With verbose context + save report
npx tsx src/cli.ts --src ./src --css ./src/globals.css --verbose --output report.json

# CI mode (exits with code 1 if invalid classes found)
npx tsx src/cli.ts --src ./src --css ./src/globals.css --json | jq '.invalid | length'
```

## What it detects

| Type | Example | Action |
|---|---|---|
| ❌ Invalid class | `bg-old-token-500` | **Error** — invalid after migration |
| ❌ Invalid in cva variants | `danger: 'bg-red-danger'` | **Error** — detected via AST |
| ⚠️ Dynamic expression | `` `text-${color}` `` | **Warning** — cannot validate statically |

## How it works

### 1. AST Extraction (`extractor.ts`)
Uses `@typescript-eslint/typescript-estree` to parse `.ts/.tsx/.js/.jsx` and traverse:
- `className="..."` JSX props
- `clsx(...)`, `cn(...)`, `cva(...)` call arguments
- Nested `ObjectExpression` (cva variant maps)
- `ConditionalExpression` and `LogicalExpression` inside class utilities
- `TemplateLiteral` — static parts extracted, dynamic parts flagged as warnings

### 2. Tailwind v4 Validation (`validator.ts`)
Uses `@tailwindcss/node`'s `compile()` API to load your actual `tailwind.config.css` (including all `@theme` tokens and plugins), then calls `build([candidate])` for each class. If the class generates no CSS rule in the output, it's invalid.

This means validation is **100% accurate against your real config** — custom tokens, plugins, and all.

### 3. Batch validation
All unique class values are validated in a single `build()` call per batch for performance.

## Extending

To add support for more class utilities (e.g. `tv` from `tailwind-variants`), add the function name to `CLASS_UTIL_NAMES` in `extractor.ts`:

```ts
const CLASS_UTIL_NAMES = new Set(['clsx', 'cn', 'cx', 'classnames', 'cva', 'tv'])
```
# tw-scanner
