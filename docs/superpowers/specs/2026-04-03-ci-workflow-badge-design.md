# Design: GitHub Actions CI Workflow + Test Badge

**Date:** 2026-04-03  
**Status:** Approved

## Goal

Add a GitHub Actions CI workflow that clones the repo, installs dependencies, and runs the test suite. Add a test status badge to the README.

## Workflow File

**Path:** `.github/workflows/ci.yml`  
**Name:** `CI`

### Triggers

- `push` to `develop`
- `pull_request` targeting `develop`

### Job: `test`

Runner: `ubuntu-latest`

Steps:
1. `actions/checkout@v4` — clone the repo
2. `actions/setup-node@v4` — Node.js 22, yarn cache enabled
3. `yarn install --immutable` — install deps respecting the lockfile
4. `yarn test` — run Vitest in run mode (non-watch)

## README Badge

Added immediately below the `# FlagForge` title:

```markdown
[![Tests](https://github.com/rollercoders/flagforge/actions/workflows/ci.yml/badge.svg)](https://github.com/rollercoders/flagforge/actions/workflows/ci.yml)
```

The badge reflects the latest run status on the default branch.

## Out of Scope

- Lint step (can be added later)
- Multi-version Node matrix (can be added later)
- Coverage reporting
- Deployment steps
