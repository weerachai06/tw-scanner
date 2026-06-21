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

### 1. AST Extraction

Uses `@typescript-eslint/typescript-estree` to parse `.ts/.tsx/.js/.jsx` and traverse:
- `className="..."` JSX props
- `clsx(...)`, `cn(...)`, `cva(...)` call arguments
- Nested `ObjectExpression` (cva variant maps)
- `ConditionalExpression` and `LogicalExpression` inside class utilities
- `TemplateLiteral` — static parts extracted, dynamic parts flagged as warnings

### 2. CSS file scanning

`.css` and `.module.css` files are also scanned. Classes inside `@apply` directives are extracted and validated against your Tailwind config.

```css
.btn {
  @apply bg-blue-500 text-white px-4; /* ✓ valid */
  @apply bg-fake-999;                 /* ✗ error */
}
```

### 3. CSS Modules validation

When a JS/TS file imports a `.module.css` file, all `styles.xxx` and `styles['xxx']` usages are checked against the class names actually defined in that file.

```tsx
import styles from './button.module.css'

<button className={styles.btn}>...</button>          // ✓ defined
<button className={styles.nonExistent}>...</button>  // ✗ error
<button className={styles[variant]}>...</button>     // ⚠ skipped (dynamic)
```

### 4. Tailwind v4 Validation

Uses `@tailwindcss/node`'s `compile()` API to load your actual CSS entry file (including all `@theme` tokens and plugins), then calls `build([candidate])` for each class. If the class generates no CSS rule in the output, it's invalid.

Validation is **100% accurate against your real config** — custom tokens, plugins, and all.

### 5. Batch validation

All unique class values are validated in a single `build()` call per batch for performance.

## Extending

To add support for more class utilities (e.g. `tv` from `tailwind-variants`), add the function name to `CLASS_UTIL_NAMES` in `src/extractor.ts`:

```ts
const CLASS_UTIL_NAMES = new Set(['clsx', 'cn', 'cx', 'classnames', 'cva', 'tv'])
```

## Development

```bash
bun install        # install dependencies
bun run build      # compile TypeScript → dist/
bun test           # run tests
bun run scan -- --src ./src --css ./src/globals.css  # run locally without building
```
