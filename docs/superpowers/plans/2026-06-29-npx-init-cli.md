# `npx flagforge init` (1-click installer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far sì che `npx flagforge init` avvii un wizard interattivo che configura e fa partire FlagForge con un solo comando.

**Architecture:** Si estrae la logica di avvio Express da `src/index.ts` in una funzione esportabile `startServer(config)` dentro `src/server.ts`. Un nuovo entry point `src/cli.ts` (registrato come `bin`) gestisce i comandi `init`/`start`, esegue il wizard `@clack/prompts`, scrive `.env`, prepara `data/` e chiama `startServer()`. `index.ts` resta come entry point diretto per `yarn start` e delega anch'esso a `startServer()`.

**Tech Stack:** TypeScript (ESM), Express, `@clack/prompts`, `nanoid`, `better-sqlite3`, Vitest, Yarn 4.

## Global Constraints

- ESM puro (`"type": "module"`): import locali con estensione `.js` nei sorgenti TS compilati. Copia lo stile da `src/index.ts`.
- Default config (verbatim da `index.ts` attuale): `PORT=6789`, `STORAGE_TYPE=sqlite`, `STORAGE_PATH=./data/flagforge.db`. Per JSON il path di default è `./data/flags.json`.
- Formato admin password generata: `ff_admin_${nanoid(32)}` (verbatim da `bootstrapAdminPassword`).
- I dati vivono nella `process.cwd()` (modello CLI globale): `.env` e `data/` si scrivono lì.
- Nessuna dipendenza pesante nuova oltre `@clack/prompts`.
- TypeScript `strict: true`. `outDir: ./dist`, `rootDir: ./src`.
- Commit in conventional commits in italiano. Mai committare su `develop`/`main`.

---

### Task 1: Estrarre `startServer()` in `src/server.ts`

**Files:**
- Create: `src/server.ts`
- Modify: `src/index.ts` (interamente riscritto come thin wrapper)

**Interfaces:**
- Produces:
  ```ts
  export interface ServerConfig {
    port: number;
    storageType: 'sqlite' | 'json';
    storagePath: string;
    adminPassword?: string;
  }
  export interface StartResult {
    adminPassword: string;
    generatedPassword: boolean;
    url: string;
  }
  export async function startServer(config: ServerConfig): Promise<StartResult>;
  ```
- `startServer` NON legge `process.env` internamente. Se `config.adminPassword` è assente, ne genera una (`ff_admin_${nanoid(32)}`), la imposta su `process.env.ADMIN_PASSWORD` (richiesto dai middleware auth) e la restituisce con `generatedPassword: true`. NON scrive su `.env` (responsabilità del chiamante).

- [ ] **Step 1: Creare `src/server.ts` con `startServer()`**

Sposta qui tutta la logica di `main()` da `index.ts`, parametrizzata dalla config. Codice completo:

```ts
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SqliteStorage } from './storage/sqlite.js';
import { JsonStorage } from './storage/json.js';
import { Storage } from './types.js';
import { FlagEvaluator } from './evaluator.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { requireAdminSession, SessionStore } from './middleware/adminAuth.js';
import { createFlagsRouter } from './routes/flags.js';
import { createEvaluateRouter } from './routes/evaluate.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createProjectsRouter } from './routes/projects.js';
import { createAdminFlagsRouter } from './routes/adminFlags.js';
import { createAdminEvaluateRouter } from './routes/adminEvaluate.js';
import { nanoid } from 'nanoid';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  storageType: 'sqlite' | 'json';
  storagePath: string;
  adminPassword?: string;
}

export interface StartResult {
  adminPassword: string;
  generatedPassword: boolean;
  url: string;
}

export async function startServer(config: ServerConfig): Promise<StartResult> {
  let adminPassword = config.adminPassword;
  let generatedPassword = false;
  if (!adminPassword) {
    adminPassword = `ff_admin_${nanoid(32)}`;
    generatedPassword = true;
  }
  process.env.ADMIN_PASSWORD = adminPassword;

  const app = express();
  const sessions: SessionStore = new Map();

  setInterval(() => {
    const now = new Date();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
  }, 3_600_000).unref();

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  let storage: Storage;
  if (config.storageType === 'json') {
    storage = new JsonStorage(config.storagePath);
  } else {
    storage = new SqliteStorage(config.storagePath);
  }

  await storage.initialize();
  console.log(`✓ Storage initialized (${config.storageType})`);

  await storage.bootstrapAdminKey();
  console.log('✓ UI admin key ready');

  const evaluator = new FlagEvaluator();
  const authMiddleware = createAuthMiddleware(storage);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', storage: config.storageType });
  });

  app.use('/auth', createAuthRouter(sessions));
  app.use('/admin', requireAdminSession(sessions), createAdminRouter(storage));
  app.use('/admin', requireAdminSession(sessions), createProjectsRouter(storage));
  app.use('/admin/flags', requireAdminSession(sessions), createAdminFlagsRouter(storage));
  app.use('/admin/evaluate', requireAdminSession(sessions), createAdminEvaluateRouter(storage, evaluator));
  app.use('/api/flags', authMiddleware, createFlagsRouter(storage));
  app.use('/api/evaluate', authMiddleware, createEvaluateRouter(storage, evaluator));

  const uiDistPath = join(__dirname, '../ui/dist');
  app.use(express.static(uiDistPath));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.get('*', (_req, res) => {
    res.sendFile(join(uiDistPath, 'index.html'), (err) => {
      if (err) res.status(404).send('Not found');
    });
  });

  const url = `http://localhost:${config.port}`;

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, () => resolve());
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`La porta ${config.port} è già in uso. Scegli un'altra porta o libera quella attuale.`));
      } else {
        reject(err);
      }
    });
  });

  console.log(`\n🚀 FlagForge is running on ${url}`);
  console.log(`   Storage: ${config.storageType}`);
  console.log(`   Path: ${config.storagePath}\n`);

  return { adminPassword, generatedPassword, url };
}
```

- [ ] **Step 2: Riscrivere `src/index.ts` come thin wrapper**

Sostituisci interamente il contenuto:

```ts
import dotenv from 'dotenv';
import { startServer, ServerConfig } from './server.js';

dotenv.config();

const config: ServerConfig = {
  port: Number(process.env.PORT) || 6789,
  storageType: (process.env.STORAGE_TYPE as 'sqlite' | 'json') || 'sqlite',
  storagePath: process.env.STORAGE_PATH || './data/flagforge.db',
  adminPassword: process.env.ADMIN_PASSWORD,
};

startServer(config).catch((error) => {
  console.error('Failed to start server:', error.message ?? error);
  process.exit(1);
});
```

> Nota: la persistenza della password generata su `.env` (vecchio `bootstrapAdminPassword`) NON viene replicata in `index.ts`: chi usa `yarn start` ha già `.env`. La persistenza è ora responsabilità della CLI `init`.

- [ ] **Step 3: Build per verificare che compili**

Run: `yarn build`
Expected: compila senza errori TypeScript; `dist/server.js` e `dist/index.js` esistono.

- [ ] **Step 4: Verificare che i test esistenti restino verdi**

Run: `yarn test`
Expected: PASS. (I test montano i router a mano e non importano `index.ts`, quindi non sono impattati.)

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "refactor: estrai startServer() in server.ts"
```

---

### Task 2: Logica pura `buildConfigFromAnswers()` + test

**Files:**
- Create: `src/cliConfig.ts`
- Test: `src/test/cliConfig.test.ts`

**Interfaces:**
- Consumes: `ServerConfig` da `./server.js` (Task 1).
- Produces:
  ```ts
  export interface WizardAnswers {
    port: number;
    storageType: 'sqlite' | 'json';
    storagePath: string;
    adminPassword?: string; // undefined/'' => genera in startServer
  }
  export function defaultStoragePath(storageType: 'sqlite' | 'json'): string;
  export function buildConfigFromAnswers(answers: WizardAnswers): ServerConfig;
  export function renderEnvFile(config: ServerConfig): string;
  ```

- [ ] **Step 1: Scrivere i test (failing)**

Crea `src/test/cliConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defaultStoragePath, buildConfigFromAnswers, renderEnvFile } from '../cliConfig';

describe('defaultStoragePath', () => {
  it('returns sqlite db path for sqlite', () => {
    expect(defaultStoragePath('sqlite')).toBe('./data/flagforge.db');
  });
  it('returns json path for json', () => {
    expect(defaultStoragePath('json')).toBe('./data/flags.json');
  });
});

describe('buildConfigFromAnswers', () => {
  it('maps answers to ServerConfig', () => {
    const cfg = buildConfigFromAnswers({
      port: 8080,
      storageType: 'json',
      storagePath: './data/flags.json',
      adminPassword: 'secret',
    });
    expect(cfg).toEqual({
      port: 8080,
      storageType: 'json',
      storagePath: './data/flags.json',
      adminPassword: 'secret',
    });
  });

  it('omits adminPassword when empty string', () => {
    const cfg = buildConfigFromAnswers({
      port: 6789,
      storageType: 'sqlite',
      storagePath: './data/flagforge.db',
      adminPassword: '',
    });
    expect(cfg.adminPassword).toBeUndefined();
  });
});

describe('renderEnvFile', () => {
  it('renders env without admin password line when absent', () => {
    const env = renderEnvFile({
      port: 6789,
      storageType: 'sqlite',
      storagePath: './data/flagforge.db',
    });
    expect(env).toContain('PORT=6789');
    expect(env).toContain('STORAGE_TYPE=sqlite');
    expect(env).toContain('STORAGE_PATH=./data/flagforge.db');
    expect(env).not.toContain('ADMIN_PASSWORD');
  });

  it('renders admin password line when present', () => {
    const env = renderEnvFile({
      port: 6789,
      storageType: 'sqlite',
      storagePath: './data/flagforge.db',
      adminPassword: 'ff_admin_x',
    });
    expect(env).toContain('ADMIN_PASSWORD=ff_admin_x');
  });
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `yarn vitest run src/test/cliConfig.test.ts`
Expected: FAIL — "Cannot find module '../cliConfig'".

- [ ] **Step 3: Implementare `src/cliConfig.ts`**

```ts
import { ServerConfig } from './server.js';

export interface WizardAnswers {
  port: number;
  storageType: 'sqlite' | 'json';
  storagePath: string;
  adminPassword?: string;
}

export function defaultStoragePath(storageType: 'sqlite' | 'json'): string {
  return storageType === 'json' ? './data/flags.json' : './data/flagforge.db';
}

export function buildConfigFromAnswers(answers: WizardAnswers): ServerConfig {
  return {
    port: answers.port,
    storageType: answers.storageType,
    storagePath: answers.storagePath,
    adminPassword: answers.adminPassword ? answers.adminPassword : undefined,
  };
}

export function renderEnvFile(config: ServerConfig): string {
  const lines = [
    `PORT=${config.port}`,
    `STORAGE_TYPE=${config.storageType}`,
    `STORAGE_PATH=${config.storagePath}`,
  ];
  if (config.adminPassword) {
    lines.push(`ADMIN_PASSWORD=${config.adminPassword}`);
  }
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `yarn vitest run src/test/cliConfig.test.ts`
Expected: PASS (tutti i casi).

- [ ] **Step 5: Commit**

```bash
git add src/cliConfig.ts src/test/cliConfig.test.ts
git commit -m "feat: logica pura buildConfigFromAnswers per la CLI"
```

---

### Task 3: Aggiungere `@clack/prompts` come dipendenza

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Installare la dipendenza**

Run: `corepack enable && yarn add @clack/prompts`
Expected: `@clack/prompts` aggiunto a `dependencies` in `package.json`; `yarn.lock` aggiornato.

> Nota CI: `corepack enable` è obbligatorio prima di qualsiasi `yarn` (Yarn 4 berry).

- [ ] **Step 2: Verificare che il build regga ancora**

Run: `yarn build`
Expected: compila senza errori.

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: aggiungi @clack/prompts per il wizard CLI"
```

---

### Task 4: Entry point CLI `src/cli.ts` (comandi init/start/help/version)

**Files:**
- Create: `src/cli.ts`

**Interfaces:**
- Consumes: `startServer`, `ServerConfig` da `./server.js`; `buildConfigFromAnswers`, `defaultStoragePath`, `renderEnvFile`, `WizardAnswers` da `./cliConfig.js`.

- [ ] **Step 1: Implementare `src/cli.ts`**

```ts
#!/usr/bin/env node
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { intro, outro, text, select, confirm, isCancel, cancel, note, log } from '@clack/prompts';
import { startServer, ServerConfig } from './server.js';
import {
  buildConfigFromAnswers,
  defaultStoragePath,
  renderEnvFile,
  WizardAnswers,
} from './cliConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp(): void {
  console.log(`
FlagForge — open-source feature flagging platform

Usage:
  flagforge init      Configura e avvia FlagForge (wizard interattivo)
  flagforge start     Avvia FlagForge usando il .env esistente
  flagforge --help    Mostra questo messaggio
  flagforge --version Mostra la versione
`);
}

function bail(): never {
  cancel('Operazione annullata.');
  process.exit(0);
}

async function runInit(): Promise<void> {
  intro('FlagForge — setup');

  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const overwrite = await confirm({
      message: 'Esiste già un .env in questa cartella. Vuoi riconfigurare e sovrascriverlo?',
      initialValue: false,
    });
    if (isCancel(overwrite)) bail();
    if (!overwrite) {
      log.info('Mantengo il .env esistente. Avvio con la configurazione attuale…');
      await runStart();
      return;
    }
  }

  const portRaw = await text({
    message: 'Su quale porta vuoi avviare FlagForge?',
    initialValue: '6789',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return 'Inserisci una porta valida (1-65535).';
      return undefined;
    },
  });
  if (isCancel(portRaw)) bail();

  const storageType = await select({
    message: 'Quale storage vuoi usare?',
    options: [
      { value: 'sqlite', label: 'SQLite (consigliato)' },
      { value: 'json', label: 'File JSON' },
    ],
    initialValue: 'sqlite',
  });
  if (isCancel(storageType)) bail();

  const storagePath = await text({
    message: 'Percorso dello storage:',
    initialValue: defaultStoragePath(storageType as 'sqlite' | 'json'),
  });
  if (isCancel(storagePath)) bail();

  const adminPassword = await text({
    message: 'Admin password (lascia vuoto per generarne una automaticamente):',
    initialValue: '',
  });
  if (isCancel(adminPassword)) bail();

  const answers: WizardAnswers = {
    port: Number(portRaw),
    storageType: storageType as 'sqlite' | 'json',
    storagePath: storagePath as string,
    adminPassword: (adminPassword as string).trim() || undefined,
  };

  const config = buildConfigFromAnswers(answers);

  // Crea la cartella data/ (deriva dal path dello storage)
  const dataDir = dirname(join(process.cwd(), config.storagePath));
  mkdirSync(dataDir, { recursive: true });

  // Scrive .env (senza ancora la password generata; verrà aggiunta dopo l'avvio se generata)
  writeFileSync(envPath, renderEnvFile(config), 'utf8');

  await launch(config, envPath);
  outro('FlagForge è pronto. Buon feature-flagging!');
}

async function runStart(): Promise<void> {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    console.error('Nessun .env trovato in questa cartella. Esegui prima `flagforge init`.');
    process.exit(1);
  }
  // Carica .env manualmente nel process.env tramite dotenv-style parsing.
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }

  const config: ServerConfig = {
    port: Number(process.env.PORT) || 6789,
    storageType: (process.env.STORAGE_TYPE as 'sqlite' | 'json') || 'sqlite',
    storagePath: process.env.STORAGE_PATH || './data/flagforge.db',
    adminPassword: process.env.ADMIN_PASSWORD,
  };
  await launch(config, envPath);
}

async function launch(config: ServerConfig, envPath: string): Promise<void> {
  let result;
  try {
    result = await startServer(config);
  } catch (err) {
    console.error((err as Error).message ?? err);
    process.exit(1);
  }

  // Persisti la password generata su .env, così `start` la riusa.
  if (result.generatedPassword) {
    try {
      const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
      const sep = current.endsWith('\n') || current === '' ? '' : '\n';
      writeFileSync(envPath, `${current}${sep}ADMIN_PASSWORD=${result.adminPassword}\n`, 'utf8');
    } catch {
      // non bloccante
    }
    note(
      `Admin password (generata):\n  ${result.adminPassword}\n\nSalvata in .env — conservala.`,
      'Credenziali'
    );
  }

  note(`FlagForge è in esecuzione su:\n  ${result.url}`, 'Pronto');
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'init':
      await runInit();
      break;
    case 'start':
      await runStart();
      break;
    case '--version':
    case '-v':
      console.log(readVersion());
      break;
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Comando sconosciuto: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Build per verificare la compilazione**

Run: `yarn build`
Expected: compila senza errori; `dist/cli.js` esiste con shebang in prima riga.

- [ ] **Step 3: Verifica `--help` e `--version`**

Run: `node dist/cli.js --help && node dist/cli.js --version`
Expected: stampa l'help; poi la versione (es. `0.1.0`).

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: CLI flagforge con comandi init e start"
```

---

### Task 5: Registrare il `bin` e configurare il packaging npm

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Aggiungere `bin`, `files`, `prepublishOnly`**

Aggiungi a `package.json` (a livello root, accanto a `"main"`):

```json
  "bin": {
    "flagforge": "./dist/cli.js"
  },
  "files": [
    "dist",
    "ui/dist",
    "README.md",
    "LICENSE"
  ],
```

E aggiungi agli `scripts`:

```json
    "prepublishOnly": "yarn build",
```

- [ ] **Step 2: Build completo**

Run: `yarn build`
Expected: `dist/` e `ui/dist/` esistono.

- [ ] **Step 3: Verificare il contenuto del tarball**

Run: `npm pack --dry-run`
Expected: l'elenco include `dist/cli.js`, `dist/server.js`, `dist/index.js`, file sotto `ui/dist/`, `README.md`, `LICENSE`, `package.json`. NON deve includere `src/` né `node_modules/`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: registra bin flagforge e configura files per il publish npm"
```

---

### Task 6: Smoke test end-to-end del pacchetto

**Files:** nessuno (verifica manuale).

- [ ] **Step 1: Creare il tarball**

Run: `yarn build && npm pack`
Expected: genera `flagforge-<version>.tgz` nella root.

- [ ] **Step 2: Installare il tarball in una cartella temporanea e lanciare init**

```bash
SCRATCH=$(mktemp -d)
cp flagforge-*.tgz "$SCRATCH/"
cd "$SCRATCH"
npm init -y >/dev/null
npm install ./flagforge-*.tgz
npx flagforge --help
```
Expected: `npx flagforge --help` stampa l'help. (Il wizard `init` è interattivo: la verifica completa di `init` è manuale — l'operatore digita le risposte e conferma che il server parte su `http://localhost:<porta>` e che `.env` + `data/` vengono creati nella cwd temporanea.)

- [ ] **Step 3: Cleanup**

```bash
cd - && rm -f flagforge-*.tgz && rm -rf "$SCRATCH"
```
Expected: nessun residuo nella root del repo.

- [ ] **Step 4: (nessun commit)** — task di sola verifica.

---

### Task 7: Aggiornare la documentazione (README)

**Files:**
- Modify: `README.md` (sezione "Quick Start")

**Interfaces:**
- Consumes: comandi `flagforge init` / `flagforge start` (Task 4).

- [ ] **Step 1: Aggiungere il blocco `npx flagforge init` in cima a Quick Start**

Sostituisci la sezione `### Installation` esistente con un nuovo blocco che mette `npx` come metodo consigliato, mantenendo il metodo `yarn` per lo sviluppo:

```markdown
## Quick Start

### Fastest: 1-click installer

```bash
npx flagforge init
```

Un wizard interattivo ti chiede porta, storage e password admin, crea `.env` e
`data/` nella cartella corrente e avvia subito il server. Per riavviare in
seguito senza riconfigurare:

```bash
flagforge start
```

### From source (development)

```bash
yarn install
cp .env.example .env
```
```

(Lascia invariate le sezioni Configuration/Running/Testing successive.)

- [ ] **Step 2: Verificare che il README renda correttamente**

Run: `grep -n "npx flagforge init" README.md`
Expected: la riga è presente nella sezione Quick Start.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: documenta npx flagforge init come quick start"
```

---

## Note di esecuzione

- L'ordine dei task è sequenziale: Task 1 (refactor) sblocca tutto il resto. Task 2 e 3 sono indipendenti tra loro ma entrambi precedono Task 4.
- Dopo ogni task far girare `yarn test` e `yarn lint` per non accumulare regressioni.
- A fine implementazione: aprire PR verso `develop` (mai commit diretti su develop/main), previa conferma dell'utente per il push.
