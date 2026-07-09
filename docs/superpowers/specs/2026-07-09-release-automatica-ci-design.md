# Release automatica su tag da CI

Data: 2026-07-09
Stato: approvato

## Obiettivo

Automatizzare i passaggi manuali di rilascio (bump versione, tag git, publish su
npm) in modo che il gesto dell'utente si riduca a premere **Squash and Merge** su
GitHub. La versione da rilasciare viene dedotta dal tipo del commit di merge
secondo le convenzioni dei conventional commit.

## Principio di fondo

Il `package.json` versionato nel repo resta **fisso a `0.0.0`**. La versione reale
vive **solo nel tag git** (`vX.Y.Z`). Al momento del rilascio, la CI:

1. calcola la prossima versione dai tag + dal messaggio dell'ultimo commit,
2. scrive quella versione nel `package.json` **solo dentro il runner** (mai
   committata sul repo),
3. pubblica su npm,
4. crea e pusha il tag.

Conseguenza: **nessun commit di ritorno** dalla CI su `develop`, nessun token di
scrittura sul branch, nessun rischio di loop di trigger. Il tag è l'unica fonte di
verità della versione.

## Trigger

- Il job **`test`** esistente resta invariato: gira su `push` a `develop` e su
  `pull_request` verso `develop`.
- Il nuovo job **`release`** gira **solo su `push` a `develop`** (cioè dopo uno
  Squash and Merge), **mai** sulle PR. Dipende da `test` (`needs: test`): se i
  test falliscono, non si rilascia.

## Flusso end-to-end

1. L'utente preme **Squash and Merge** → su `develop` appare un commit
   `fix: ... (#N)` (o `feat:`, `feat!:`, ecc.).
2. Il job `test` gira come oggi (install + test + audit).
3. Il job `release` parte solo se `test` passa:
   - legge l'ultimo tag: `git describe --tags --abbrev=0` (fallback `v0.0.0`);
   - legge il messaggio dell'ultimo commit: `git log -1 --pretty=%s`;
   - determina il bump:
     - `feat!:` oppure corpo/commit con `BREAKING CHANGE` → **major**
     - `feat:` → **minor**
     - `fix:` o `revert:` → **patch**
     - qualsiasi altro tipo (`chore`, `docs`, `ci`, `style`, `test`, `refactor`,
       merge di dependabot, ecc.) → **nessun rilascio**, il job esce con successo
       senza fare nulla;
   - calcola la prossima versione `X.Y.Z`;
   - `npm version <next> --no-git-tag-version` (bump solo nel runner, non committato);
   - build via `prepublishOnly` (già presente: `yarn build`);
   - `npm publish`;
   - `git tag v<next> && git push origin v<next>`.

## Componenti

### `package.json` (modifica una tantum)
- `version` → `0.0.0`.
- La versione corrente `0.2.1` è già coperta dal tag `v0.2.1` (già pushato), quindi
  il primo calcolo automatico partirà correttamente da lì.

### `scripts/next-version.sh` (nuovo)
Script bash (~40 righe) che:
- riceve/legge l'ultimo tag e il messaggio dell'ultimo commit;
- applica le regole di bump sopra;
- stampa su stdout la prossima versione **senza** prefisso `v` (es. `0.2.2`),
  oppure non stampa nulla ed esce con un codice/segnale che indica "no release".
- Contratto preciso (da definire nel piano): output = versione nuda su stdout se
  c'è da rilasciare; stringa vuota / exit dedicato se non c'è da rilasciare. La
  scelta esatta del meccanismo di segnalazione (exit code vs output vuoto vs flag)
  viene fissata nel piano di implementazione, ma il workflow deve poter distinguere
  in modo non ambiguo i due casi.
- Isolato dal workflow così è leggibile e testabile in locale.

### `.github/workflows/ci.yml` (modifica)
- Il job `test` resta invariato.
- Il job `release` viene aggiunto **nello stesso file `ci.yml`** (non un file
  separato). Questo determina il "workflow filename" da configurare in npm Trusted
  Publisher: **`ci.yml`**.
- Nuovo job `release`:
  - `needs: test`
  - `if:` limitato a push su `develop` (non PR)
  - `permissions: { contents: write, id-token: write }`
    - `contents: write` → push del tag col `GITHUB_TOKEN` di default
    - `id-token: write` → token OIDC per il publish npm via Trusted Publisher
  - `concurrency: release` (serializza release concorrenti da merge ravvicinati)
  - checkout con `fetch-depth: 0` e `fetch-tags: true` (serve la storia dei tag per
    `git describe`)
  - `setup-node` con `registry-url: https://registry.npmjs.org` e **npm ≥ 11.5.1**
    (requisito per il publish OIDC nativo)
  - invoca `scripts/next-version.sh`; se "no release" → termina;
  - altrimenti: bump in runner, publish, tag+push.

## Autenticazione e permessi

Il publish su npm usa **Trusted Publisher (OIDC)**, non un token statico. npm si
fida della GitHub Action tramite identità OIDC: nessun segreto da generare, salvare
o ruotare.

- **Configurazione npm (una tantum, lato utente)**: sul package `flagforge` su
  npmjs.com → Settings → Trusted Publisher → GitHub Actions, con:
  - Organization/user: `Rollercoders`
  - Repository: `flagforge`
  - Workflow filename: `ci.yml`
  - Environment name: *(vuoto)*
- **Nel workflow**: `permissions: id-token: write` abilita lo scambio OIDC; il
  publish resta un semplice `npm publish` (npm ≥ 11.5.1 fa lo scambio nativamente).
  Nessun `NODE_AUTH_TOKEN`/`NPM_TOKEN`.
- **Push del tag**: `GITHUB_TOKEN` di default + `permissions: contents: write`.
  Nessun token custom.

## Rischi e mitigazioni

- **Merge ravvicinati** → due job release quasi paralleli. Mitigazione:
  `concurrency: release` nel workflow serializza i job.
- **Publish riuscito ma push tag fallito** (o viceversa) → stato incoerente
  (versione su npm senza tag, o tag senza publish). Mitigazione: ordinare le
  operazioni in modo che il caso peggiore sia recuperabile a mano; documentare la
  procedura di recovery nel piano. `npm publish` di una versione già esistente
  fallisce (idempotenza parziale a nostro favore).
- **Commit non di rilascio** (chore/docs/dependabot) → nessun tag, nessun publish:
  gestito esplicitamente dallo script (caso "no release").

## Fuori scope (YAGNI, per scelta esplicita)

- CHANGELOG.md versionato nel repo.
- Commit di ritorno / token di scrittura su `develop`.
- GitHub Release automatica (aggiungibile in seguito con poche righe).

## Cosa cambia per l'utente

- **Prima**: 5 passaggi manuali (PR di bump, merge, tag, `npm login`, `npm publish`).
- **Dopo**: premere **Squash and Merge**. Il resto è automatico. Nessun token npm
  da gestire (Trusted Publisher/OIDC).
- L'aggiornamento dell'istanza sul server (comandi pm2) resta manuale: gira sul
  server, fuori dalla portata della CI.
