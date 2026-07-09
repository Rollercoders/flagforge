# Release automatica su tag da CI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatizzare bump versione + tag git + publish su npm a partire da uno Squash-and-Merge su `develop`, senza commit di ritorno e senza token statici.

**Architecture:** Il `package.json` versionato resta fisso a `0.0.0`; la versione vive solo nel tag git. Uno script bash calcola la prossima versione da (ultimo tag + tipo dell'ultimo commit). Un job `release` in `ci.yml` (dopo il job `test`) scrive la versione nel runner, pubblica via OIDC Trusted Publisher e pusha il tag.

**Tech Stack:** GitHub Actions, bash, Node 24 / npm ≥ 11.5.1, Yarn 4 (corepack), npm Trusted Publisher (OIDC).

## Global Constraints

- Publish npm via **Trusted Publisher (OIDC)**, mai `NPM_TOKEN`. Già configurato lato npm: repo `Rollercoders/flagforge`, workflow filename `ci.yml`, environment vuoto.
- Runner deve avere **npm ≥ 11.5.1** (requisito publish OIDC nativo) → upgrade esplicito nel job.
- `package.json` `version` = `0.0.0` sul repo; la versione reale è solo nel tag `vX.Y.Z`.
- Nessun commit di ritorno su `develop`; nessun token con write su develop (solo `GITHUB_TOKEN` + `contents: write` per il tag).
- Bump da conventional commit: `feat!:`/`BREAKING CHANGE` → major, `feat:` → minor, `fix:`/`revert:` → patch, altro → nessun rilascio.
- Commit in italiano, conventional, senza scope. Mai commit diretti su `develop`.
- Tag formato `vX.Y.Z`. Ultimo tag esistente: `v0.2.1`.
- Il branch di lavoro è `ci/release-automatica` (già creato). Design in `docs/superpowers/specs/2026-07-09-release-automatica-ci-design.md`.

---

### Task 1: Script `next-version.sh` — calcolo versione e bump

**Files:**
- Create: `scripts/next-version.sh`
- Test: `scripts/test-next-version.sh` (script bash di test, nessun framework)

**Interfaces:**
- Consumes: due variabili d'ambiente in input — `LAST_TAG` (es. `v0.2.1`, oppure vuoto/`v0.0.0` se non ci sono tag) e `COMMIT_MSG` (subject dell'ultimo commit, es. `fix: qualcosa (#17)`).
- Produces: su stdout stampa **la sola versione nuda** senza prefisso (es. `0.2.2`) se c'è da rilasciare; **non stampa nulla** se non c'è da rilasciare. Exit code sempre `0` (il "no release" non è un errore). Il chiamante distingue i due casi controllando se l'output è vuoto.

- [ ] **Step 1: Scrivere lo script di test (che fallisce perché lo script non esiste)**

Create `scripts/test-next-version.sh`:

```bash
#!/usr/bin/env bash
# Test per next-version.sh. Esegue casi noti e verifica l'output.
set -u
SCRIPT="$(dirname "$0")/next-version.sh"
fail=0

check() {
  local desc="$1" last="$2" msg="$3" expected="$4"
  local got
  got="$(LAST_TAG="$last" COMMIT_MSG="$msg" bash "$SCRIPT")"
  if [ "$got" != "$expected" ]; then
    echo "FAIL: $desc → atteso '[$expected]', ottenuto '[$got]'"
    fail=1
  else
    echo "ok: $desc → '$got'"
  fi
}

check "fix bumpa patch"            "v0.2.1" "fix: bug (#17)"            "0.2.2"
check "feat bumpa minor"           "v0.2.1" "feat: cosa (#18)"         "0.3.0"
check "feat! bumpa major"          "v0.2.1" "feat!: rottura (#19)"     "1.0.0"
check "revert bumpa patch"         "v0.2.1" "revert: x (#20)"          "0.2.2"
check "chore non rilascia"         "v0.2.1" "chore: deps (#21)"        ""
check "docs non rilascia"          "v0.2.1" "docs: readme (#22)"       ""
check "commit dependabot non rilascia" "v0.2.1" "chore(deps): bump x"  ""
check "nessun tag parte da 0.0.0"  ""       "fix: primo (#1)"          "0.0.1"
check "nessun tag + feat"          "v0.0.0" "feat: primo (#1)"         "0.1.0"

exit $fail
```

- [ ] **Step 2: Eseguire il test e verificare che fallisce**

Run: `bash scripts/test-next-version.sh`
Expected: FAIL — errori tipo `next-version.sh: No such file or directory`, ogni check fallisce.

- [ ] **Step 3: Scrivere `scripts/next-version.sh`**

Create `scripts/next-version.sh`:

```bash
#!/usr/bin/env bash
# Calcola la prossima versione da LAST_TAG + COMMIT_MSG secondo i conventional commit.
# Stampa la versione nuda (es. 0.2.2) se c'è da rilasciare, altrimenti stampa nulla.
set -euo pipefail

last="${LAST_TAG:-}"
msg="${COMMIT_MSG:-}"

# Normalizza il tag: togli il prefisso v, default 0.0.0
last="${last#v}"
[ -z "$last" ] && last="0.0.0"

IFS='.' read -r major minor patch <<< "$last"
major="${major:-0}"; minor="${minor:-0}"; patch="${patch:-0}"

# Determina il tipo di bump dal messaggio del commit.
bump=""
if printf '%s' "$msg" | grep -qE '^feat!:' || printf '%s' "$msg" | grep -qE 'BREAKING CHANGE'; then
  bump="major"
elif printf '%s' "$msg" | grep -qE '^feat(\(.+\))?:'; then
  bump="minor"
elif printf '%s' "$msg" | grep -qE '^(fix|revert)(\(.+\))?:'; then
  bump="patch"
fi

case "$bump" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  *) exit 0 ;;  # nessun rilascio: nessun output
esac

printf '%s.%s.%s\n' "$major" "$minor" "$patch"
```

- [ ] **Step 4: Rendere eseguibili gli script**

Run: `chmod +x scripts/next-version.sh scripts/test-next-version.sh`

- [ ] **Step 5: Eseguire il test e verificare che passa**

Run: `bash scripts/test-next-version.sh`
Expected: tutte le righe `ok:`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/next-version.sh scripts/test-next-version.sh
git commit -m "ci: aggiungi script calcolo prossima versione da conventional commit"
```

---

### Task 2: `package.json` a `0.0.0`

**Files:**
- Modify: `package.json` (campo `version`)

**Interfaces:**
- Consumes: niente.
- Produces: `package.json` con `"version": "0.0.0"`. Il job `release` lo sovrascriverà in RAM al momento del publish.

- [ ] **Step 1: Portare la versione a 0.0.0**

Run: `npm version 0.0.0 --no-git-tag-version --allow-same-version`
Expected: `package.json` ora ha `"version": "0.0.0"`. Nessun tag/commit creato.

- [ ] **Step 2: Verificare che sia l'unica modifica**

Run: `git status --short && grep '"version"' package.json`
Expected: solo `M package.json`, e `"version": "0.0.0"`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "ci: fissa version a 0.0.0 (la versione reale vive nel tag git)"
```

---

### Task 3: Job `release` in `ci.yml`

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/next-version.sh` (Task 1) via env `LAST_TAG`/`COMMIT_MSG`; `package.json` a `0.0.0` (Task 2); Trusted Publisher già configurato su npm (workflow filename `ci.yml`).
- Produces: un job `release` che, su push a `develop` con commit di tipo rilasciabile, pubblica su npm e pusha il tag `vX.Y.Z`.

- [ ] **Step 1: Sostituire `ci.yml` con la versione che aggiunge il job `release`**

Il job `test` resta identico a prima; si aggiunge in coda il job `release`.
Contenuto completo del file:

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
        uses: actions/checkout@v6.0.3

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Enable Corepack
        run: corepack enable

      - name: Install dependencies
        run: yarn install --immutable

      - name: Run tests
        run: yarn test

      - name: Security audit
        run: yarn npm audit --environment production --severity high

  release:
    needs: test
    # Solo su push a develop (mai su PR)
    if: github.event_name == 'push' && github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    concurrency: release
    permissions:
      contents: write   # push del tag
      id-token: write   # OIDC per npm Trusted Publisher

    steps:
      - name: Checkout
        uses: actions/checkout@v6.0.3
        with:
          fetch-depth: 0
          fetch-tags: true

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Aggiorna npm (OIDC publish richiede >= 11.5.1)
        run: npm install -g npm@latest

      - name: Enable Corepack
        run: corepack enable

      - name: Calcola prossima versione
        id: ver
        run: |
          LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || echo '')"
          COMMIT_MSG="$(git log -1 --pretty=%s)"
          NEXT="$(LAST_TAG="$LAST_TAG" COMMIT_MSG="$COMMIT_MSG" bash scripts/next-version.sh)"
          echo "next=$NEXT" >> "$GITHUB_OUTPUT"
          if [ -z "$NEXT" ]; then
            echo "Commit non di rilascio ($COMMIT_MSG) — skip release."
          else
            echo "Prossima versione: $NEXT (da $LAST_TAG)"
          fi

      - name: Install dependencies
        if: steps.ver.outputs.next != ''
        run: yarn install --immutable

      - name: Bump versione nel runner (non committato)
        if: steps.ver.outputs.next != ''
        run: npm version "${{ steps.ver.outputs.next }}" --no-git-tag-version --allow-same-version

      - name: Publish su npm (OIDC)
        if: steps.ver.outputs.next != ''
        run: npm publish

      - name: Crea e pusha il tag
        if: steps.ver.outputs.next != ''
        run: |
          git tag "v${{ steps.ver.outputs.next }}"
          git push origin "v${{ steps.ver.outputs.next }}"
```

- [ ] **Step 2: Validare la sintassi YAML**

Run: `yarn dlx --quiet js-yaml .github/workflows/ci.yml >/dev/null && echo "YAML ok" || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML ok')"`
Expected: `YAML ok` (uno dei due metodi deve funzionare; se nessuno è disponibile, ispezione manuale dell'indentazione).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: aggiungi release automatica su develop con publish npm oidc e tag"
```

---

### Task 4: PR e verifica end-to-end

**Files:** nessuno (solo processo).

**Interfaces:**
- Consumes: i tre commit dei task precedenti sul branch `ci/release-automatica`.
- Produces: PR verso `develop`; al merge, il primo rilascio automatico.

- [ ] **Step 1: Push del branch**

Run: `git push -u origin ci/release-automatica`
Expected: branch pushato.

- [ ] **Step 2: Aprire la PR**

Run:
```bash
gh pr create --base develop --head ci/release-automatica \
  --title "ci: release automatica su develop (bump+tag+publish via oidc)" \
  --body "Vedi docs/superpowers/specs/2026-07-09-release-automatica-ci-design.md. Automatizza bump, tag e publish npm a partire da Squash-and-Merge, versione solo nel tag, publish via Trusted Publisher OIDC."
```
Expected: URL della PR.

- [ ] **Step 3: Verifica sulla PR (dry-run implicito)**

Sulla PR il job `test` gira; il job `release` **non** deve girare (è gated su `push` a `develop`). Controllare nei check della PR che compaia solo `test`.
Expected: solo `test` eseguito sulla PR.

- [ ] **Step 4: Merge e verifica del primo rilascio**

Questo step è **manuale e va confermato dall'utente** (regola git: niente merge in autonomia). Il titolo della PR è `ci: ...` → di tipo NON rilasciabile, quindi **questo primo merge non produrrà un rilascio** (atteso e voluto: valida che il job giri e faccia correttamente "skip release").

Dopo il merge, verificare nella tab Actions:
- il job `release` è partito, ha calcolato `next` vuoto e ha loggato "skip release";
- nessun tag nuovo, nessuna pubblicazione.

Il primo rilascio vero avverrà al primo merge successivo di una PR `fix:`/`feat:`.
Expected: workflow verde, nessun tag/publish per il commit `ci:`.

---

## Note operative post-piano

- **Prova reale del rilascio:** al primo merge di una PR `fix:` o `feat:` dopo questo, verificare in Actions che `release` calcoli la versione, pubblichi su npm e crei il tag `vX.Y.Z`. Poi `npm view flagforge version` deve mostrare la nuova versione.
- **Recovery se publish OK ma tag KO:** il tag si può creare a mano (`git tag vX.Y.Z <sha> && git push origin vX.Y.Z`). Se il tag c'è ma il publish è fallito, ri-lanciare il job (npm rifiuta una versione già pubblicata, quindi è sicuro).
- **Aggiornamento istanza server:** invariato e manuale (comandi pm2, vedi memoria di progetto).
