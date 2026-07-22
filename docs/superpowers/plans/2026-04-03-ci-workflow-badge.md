# CI Workflow + Test Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI workflow that installs deps and runs tests on every push/PR to `develop`, and show a test status badge in the README.

**Architecture:** A single `.github/workflows/ci.yml` file defines a `test` job on `ubuntu-latest`. The badge URL points to that workflow file on the `rollercoders/flagforge` repo. No source code changes are required.

**Tech Stack:** GitHub Actions, `actions/checkout@v4`, `actions/setup-node@v4`, Yarn 4 (berry), Vitest

---

### Task 1: Create the GitHub Actions workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the `.github/workflows/` directory structure and write the workflow file**

Create `.github/workflows/ci.yml` with this exact content:

```yaml
name: CI

on:
  push:
    branches:
      - develop
  pull_request:
    branches:
      - develop

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: yarn

      - name: Install dependencies
        run: yarn install --immutable

      - name: Run tests
        run: yarn test
```

- [ ] **Step 2: Verify the file is valid YAML**

Run:
```bash
node -e "const fs=require('fs'); require('js-yaml' in require.resolve ? 'js-yaml' : 'node:path'); console.log('ok')" 2>/dev/null || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML valid')"
```

Expected: `YAML valid`

If `python3` is not available, visually confirm indentation — YAML requires consistent spaces (2-space indent used throughout).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for tests"
```

---

### Task 2: Add test badge to README

**Files:**
- Modify: `README.md` (line 1, after `# FlagForge`)

- [ ] **Step 1: Add the badge line to README.md**

Open `README.md`. The first two lines currently read:

```markdown
# FlagForge

Open-source, on-premise feature flagging platform built for speed and simplicity.
```

Change them to:

```markdown
# FlagForge

[![Tests](https://github.com/rollercoders/flagforge/actions/workflows/ci.yml/badge.svg)](https://github.com/rollercoders/flagforge/actions/workflows/ci.yml)

Open-source, on-premise feature flagging platform built for speed and simplicity.
```

- [ ] **Step 2: Verify the README renders correctly (optional local check)**

Run:
```bash
head -6 README.md
```

Expected output:
```
# FlagForge

[![Tests](https://github.com/rollercoders/flagforge/actions/workflows/ci.yml/badge.svg)](https://github.com/rollercoders/flagforge/actions/workflows/ci.yml)

Open-source, on-premise feature flagging platform built for speed and simplicity.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add CI test badge to README"
```

---

### Task 3: Push and verify on GitHub

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/ci-workflow
```

- [ ] **Step 2: Open a PR on GitHub**

Go to `https://github.com/rollercoders/flagforge` and open a pull request from `feat/ci-workflow` → `develop`.

The CI workflow should trigger automatically on PR creation.

- [ ] **Step 3: Confirm the workflow runs successfully**

In the PR page, verify the `CI / test` check appears and turns green.

In Actions tab (`https://github.com/rollercoders/flagforge/actions`), confirm:
- Job `test` completes with status ✅
- All 136 tests pass (matching local run output)

- [ ] **Step 4: Merge the PR**

Once CI is green, merge the PR into `develop`. The badge in the README will now reflect live CI status.
