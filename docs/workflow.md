# Git & Release Workflow

## Git Flow

```
main          ──●──────────────────●──────────────────●──▶
                 \                /  \                /
feature/*         ●──●──●──●──●──    ●──●──●──●──●──
```

### Branches

| Branch | Purpose |
|---|---|
| `main` | Production-ready code. CI runs on every push. |
| `feature/<name>` | New features or fixes. Always branch off `main`. |

### Daily Flow

```bash
# 1. Create a feature branch
git checkout -b feature/my-feature

# 2. Make changes, then commit
git add <files>
git commit -m "feat: describe what changed"

# 3. Push and open a PR → CI runs (type check + tests)
git push -u origin feature/my-feature

# 4. Merge PR into main after CI passes
```

### Commit Message Convention

```
<type>: <short description>

Types:
  feat     — new feature
  fix      — bug fix
  chore    — config, deps, tooling
  test     — adding or updating tests
  ci       — CI/CD changes
  docs     — documentation only
  refactor — code change with no feature or fix
```

---

## Release Flow

```
main  ──●──●──●──●──────────────────────────▶
                  │
                  └─ bump version in package.json
                     git tag v1.x.x
                     push tag
                     create GitHub Release
                          │
                          └─ publish.yml triggers
                               bun install
                               bun test
                               bun run build
                               npm publish
```

### Step-by-step

**1. Bump version**

```bash
# Edit package.json version manually, then commit
git add package.json
git commit -m "chore: bump version to 1.x.x"
git push
```

**2. Create a GitHub Release**

Go to **GitHub → Releases → Draft a new release**

- Tag: `v1.x.x` (create on publish)
- Target: `main`
- Title: `v1.x.x`
- Describe what changed in this release
- Click **Publish release**

**3. CI publishes automatically**

`publish.yml` triggers on release publish:

```
install → test → build → npm publish
```

Package becomes available at:

```bash
npx @weerachai06/tw-scanner
```

### Prerequisites (one-time setup)

- `NPM_TOKEN` must be set in **GitHub → Settings → Secrets and variables → Actions**
- Get token from **npmjs.com → Account → Access Tokens → Generate New Token (Automation)**
