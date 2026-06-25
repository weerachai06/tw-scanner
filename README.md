# tw-scanner

AST-based Tailwind v4 class validator for React projects.
Detects invalid, renamed, or missing classes after design token / plugin migrations.

## Usage

Run directly without installing:

```bash
npx @weerachai06/tw-scanner --src ./src --css ./src/globals.css
```

Or install globally:

```bash
npm install -g @weerachai06/tw-scanner
tw-scanner --src ./src --css ./src/globals.css
```

### Options

| Flag | Description |
|---|---|
| `--src` | Directory to scan (default: `./src`) |
| `--css` | Path to Tailwind v4 CSS entry file (with `@import tailwindcss` + `@theme`) |
| `--verbose` | Show source context snippet for each error |
| `--output report.json` | Save full JSON report to file |
| `--json` | Print JSON report to stdout (for CI piping) |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No invalid classes found |
| `1` | Invalid classes found |
| `2` | Fatal error (missing CSS file, parse failure) |

### Examples

```bash
# Basic scan
npx @weerachai06/tw-scanner --src ./src --css ./src/globals.css

# With verbose context + save report
npx @weerachai06/tw-scanner --src ./src --css ./src/globals.css --verbose --output report.json

# CI mode (exits with code 1 if invalid classes found)
npx @weerachai06/tw-scanner --src ./src --css ./src/globals.css --json | jq '.invalid | length'
```

## What it detects

| Type | Example | Action |
|---|---|---|
| ❌ Invalid class | `bg-old-token-500` | **Error** — invalid after migration |
| ❌ Invalid in cva variants | `danger: 'bg-red-danger'` | **Error** — detected via AST |
| ❌ Invalid `@apply` class | `@apply bg-fake-999;` in `.css` | **Error** — validated against your config |
| ❌ Missing CSS Module class | `styles.nonExistent` | **Error** — class not defined in `.module.css` |
| ⚠️ Dynamic expression | `` `text-${color}` `` | **Warning** — cannot validate statically |
| ⚠️ Dynamic module access | `styles[variable]` | **Warning** — skipped, cannot resolve statically |

## How it works

The pipeline runs in sequence: **scanner → extractor → validator → reporter**.

### 1. File discovery

`scanner` globs `.ts`, `.tsx`, `.js`, `.jsx`, and `.css` files from `--src`, then reads each file once and passes the source string down the pipeline.

### 2. AST extraction

`extractor` receives source strings and parses them with `@typescript-eslint/typescript-estree`. It collects classes from:

- `className="..."` and `class="..."` JSX props
- `clsx(...)`, `cn(...)`, `cva(...)`, `tv(...)` call arguments (including nested arrays, objects, conditionals, and logical expressions)
- `TemplateLiteral` — static quasis extracted normally, expressions flagged as `isDynamic`
- `@apply` directives in `.css` files
- `styles.foo` / `styles['foo']` CSS Module access

### 3. Tailwind v4 validation

Uses `@tailwindcss/node`'s `compile()` API to load your CSS entry file (including all `@theme` tokens and plugins), then calls `build([candidates])` once per batch. A class is valid if its escaped CSS selector appears in the output.

Validation is **100% accurate against your real config** — custom tokens, plugins, and all.

If `@apply` references an unknown utility (e.g. from an external design system), the compiler automatically stubs it and retries so scanning can continue.

### 4. CSS Modules validation

When a JS/TS file imports a `.module.css` file, all `styles.xxx` and `styles['xxx']` usages are cross-referenced against class names actually defined in that file.

```tsx
import styles from './button.module.css'

<button className={styles.btn}>...</button>          // ✓ defined
<button className={styles.nonExistent}>...</button>  // ✗ error
<button className={styles[variant]}>...</button>     // ⚠ skipped (dynamic)
```

## Programmatic API

All extraction functions are pure — they accept source strings and return results without touching the filesystem.

```ts
import {
  parseClassesFromSource,
  parseCssApply,
  parseCssModuleUsages,
  parseCssModuleClasses,
} from '@weerachai06/tw-scanner/extractor'

import { loadTailwindContext, validateBatch } from '@weerachai06/tw-scanner/validator'
import { scan } from '@weerachai06/tw-scanner/scanner'
```

### `parseClassesFromSource(source, file, isJSX)`

```ts
const { classes, error } = parseClassesFromSource(source, './Button.tsx', true)
// classes: ExtractedClass[]
// error:   Error | undefined  (set if AST parse failed, does not throw)
```

### `parseCssApply(source, file)`

```ts
const classes = parseCssApply(source, './styles.css')
// ExtractedClass[] from @apply directives
```

### `parseCssModuleUsages(source, file)`

```ts
const { usages, error } = parseCssModuleUsages(source, './Button.tsx')
// usages: CssModuleUsage[]
```

### `parseCssModuleClasses(source)`

```ts
const defined = parseCssModuleClasses(source)
// Set<string> of class names defined in a CSS module file
```

### `scan(options)`

High-level entry point. Handles all file I/O, validation, and returns a `ScanResult`.

```ts
const result = await scan({ src: './src', css: './src/globals.css' })
// result.invalid          — ValidationResult[]
// result.dynamic          — ExtractedClass[] (warnings)
// result.cssModuleViolations — CssModuleViolation[]
// result.totalClasses     — number
// result.totalFiles       — number
// result.durationMs       — number
```

## Extending

To add support for more class utilities (e.g. a custom `cx`), add the function name to `CLASS_UTIL_NAMES` in `src/extractor.ts`:

```ts
const CLASS_UTIL_NAMES = new Set(['clsx', 'cn', 'cx', 'classnames', 'cva', 'tv'])
```

## Development

```bash
bun install        # install dependencies
bun run build      # compile TypeScript → dist/
bun test           # run tests
bun test --coverage  # run tests with coverage report
bun run scan -- --src ./src --css ./src/globals.css  # run locally without building
```

### Releasing

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

```bash
# 1. Generate a changeset from commits since last tag
bun run changeset:gen

# 2. Review .changeset/auto-*.md, edit if needed, then commit
git add .changeset && git commit -m "chore: add changeset"

# 3. On merge to main, GitHub Actions creates a "Version Packages" PR automatically.
#    Merging that PR bumps the version, updates CHANGELOG.md, and publishes to npm.
```

Or use the interactive CLI to write a changeset manually:

```bash
bun run changeset
```
