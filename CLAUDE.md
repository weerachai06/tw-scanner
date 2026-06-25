# CLAUDE.md

Guidance for Claude Code working in this repo.

## Monorepo structure

One package right now. Don't add more unless asked.

```
tailwind-validator/
├── packages/
│   └── tw-scanner/          @weerachai06/tw-scanner
├── package.json             workspace root (private)
└── turbo.json
```

## Commands

No build step needed for development — bun runs TypeScript directly.

```bash
bun install                  # install everything
bun run build                # compile all packages
bun run typecheck            # type-check all packages
bun run test                 # run all tests

# Run the scanner without building
bun packages/tw-scanner/src/cli.ts --src <dir> --css <tailwind-entry.css> [--verbose] [--output report.json] [--json]
```

## Architecture (`packages/tw-scanner`)

The pipeline is linear: **cli → scanner → extractor + validator → reporter**.

| File | What it does |
|---|---|
| `cli.ts` | Parses args, calls `scan()`, exits 1 if invalid classes found |
| `scanner.ts` | Owns all file I/O — globs files, reads each once, orchestrates the pipeline |
| `extractor.ts` | Pure functions — takes source strings, returns classes. No filesystem access. |
| `validator.ts` | Loads Tailwind via `@tailwindcss/node`, checks if a candidate produces CSS output |
| `reporter.ts` | Formats terminal output (picocolors), writes JSON reports |
| `types.ts` | Shared types: `ExtractedClass`, `ValidationResult`, `ScanResult` |

### The key constraint: scanner owns I/O, extractor is pure

`scanner.ts` reads each file once and passes the source string to `extractor.ts`. The extractor never touches the filesystem. This is load-bearing — it's why the extractor functions are fully testable with inline strings, no fixtures needed.

Don't reach into `extractor.ts` to add `fs.readFileSync`. If you need to read a file, do it in `scanner.ts`.

### Extraction (`extractor.ts`)

Walks the full AST and collects classes from:
- `className="..."` and `class="..."` JSX attributes
- Call arguments of `clsx`, `cn`, `cx`, `classnames`, `cva`, `tv` — extend via `CLASS_UTIL_NAMES`
- Nested `ObjectExpression`, `ConditionalExpression`, `LogicalExpression`, `ArrayExpression`, `TemplateLiteral`
- `@apply` directives in `.css` files
- `styles.foo` / `styles['foo']` CSS Module access

TemplateLiterals with expressions are split: static quasis validated normally, the full expression recorded as `isDynamic: true` for the warning report.

### Validation (`validator.ts`)

Calls `compile(css, { base })` once per CSS file (cached), then `context.build(candidates)`. A class is valid if its escaped selector appears in the output. All unique values go through a single `build()` call per batch — don't split them up.

`loadTailwindContext` accepts an optional `compileFn` parameter. Use that for testing — don't mock the module.

### Data flow

```
ScanOptions { src, css }
  → globSync → file list
  → loadTailwindContext(css) → TailwindCompileResult
  → scanner reads each file once → source string
  → parseClassesFromSource(source, file, isJSX) → ExtractedClass[]
  → validateBatch(uniqueValues, context) → Map<string, boolean>
  → ScanResult { invalid, dynamic, cssModuleViolations, totalClasses, totalFiles, durationMs }
```

Exit codes: `0` = clean, `1` = invalid classes found, `2` = fatal error.

## Releasing

Uses [Changesets](https://github.com/changesets/changesets). The workflow:

1. `bun run changeset:gen` — generates `.changeset/auto-*.md` from commits since last tag
2. Review the file, commit it
3. Push to `main` — GitHub Actions opens a "Version Packages" PR
4. Merge the PR — bumps version, updates `CHANGELOG.md`, publishes to npm

Don't run `npm publish` directly. The CI does it.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `weerachai06/tw-scanner`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical label names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — `CONTEXT-MAP.md` at the root points to per-package context files. See `docs/agents/domain.md`.
