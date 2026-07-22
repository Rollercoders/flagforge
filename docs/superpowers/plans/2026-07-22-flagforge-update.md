# `flagforge update` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un comando `flagforge update` che aggiorna l'istanza all'ultima versione npm quando può, e stampa i comandi root quando non può, senza mai prescrivere un comando di restart.

**Architecture:** La logica dell'updater vive in un modulo separato `src/updater.ts` con l'esecuzione comandi iniettabile (pattern come `cliConfig.ts`), testabile in isolamento. `src/cli.ts` aggiunge solo `case 'update'` che invoca `runUpdate`. L'output usa `console.log` (semplice, coerente con `readVersion`/`printHelp`).

**Tech Stack:** TypeScript, Node ESM, `child_process` per comandi esterni, Vitest. Package manager: **yarn 4** (usare `yarn`, mai `npm` per gli script di sviluppo — `npm` compare solo come stringa nei comandi che l'updater esegue/stampa).

## Global Constraints

- ESM: gli import relativi runtime DEVONO avere estensione `.js` (es. `from './updater.js'`). Vedi il crash 0.3.0/0.3.1. Verificare con `yarn build && yarn smoke`.
- L'updater NON riavvia mai il processo e NON stampa mai un comando di restart. Stampa comandi di *install* solo nel caso EACCES.
- Detezione permessi: **prova e cattura EACCES**, non pre-check.
- Ultima versione da `npm view flagforge version`; versione locale da `readVersion()` (in dev è `0.0.0`, in produzione è quella reale del pacchetto npm — comportamento accettato).
- `nodenv rehash` eseguito solo se `nodenv` è nel PATH; altrimenti skip con nota.
- Commit in italiano, conventional commits, no scope.
- Test: `yarn test`. Siamo sul branch `feat/flagforge-update`.

## File Structure

- `src/updater.ts` — **new**: `runUpdate(deps)` + tipi. Contiene tutta la logica (confronto versioni, install, rehash, output). L'esecuzione comandi è iniettata via `deps` per i test.
- `src/cli.ts` — **modify**: import di `runUpdate`, `case 'update'` nello switch, voce nell'help.
- `src/test/updater.test.ts` — **new**: test di `runUpdate` con runner simulato.

---

### Task 1: Modulo updater con runner iniettabile

**Files:**
- Create: `src/updater.ts`
- Test: `src/test/updater.test.ts` (new)

**Interfaces:**
- Consumes: niente (modulo base).
- Produces:
  - `interface UpdaterDeps { currentVersion: string; run: (cmd: string, args: string[]) => { status: number; stdout: string; stderr: string; error?: NodeJS.ErrnoException }; hasCommand: (cmd: string) => boolean; log: (msg: string) => void; }`
  - `function runUpdate(deps: UpdaterDeps): void` — sincrono; orchestrazione + output via `deps.log`.

- [ ] **Step 1: Scrivi i test che falliscono** in `src/test/updater.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { runUpdate, UpdaterDeps } from '../updater';

function makeDeps(overrides: Partial<UpdaterDeps> = {}): { deps: UpdaterDeps; out: string[] } {
  const out: string[] = [];
  const deps: UpdaterDeps = {
    currentVersion: '0.3.2',
    run: (cmd, args) => {
      if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.3.2\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    hasCommand: () => true,
    log: (m) => out.push(m),
    ...overrides,
  };
  return { deps, out };
}

describe('runUpdate', () => {
  it('reports already up to date when npm latest equals current', () => {
    const { deps, out } = makeDeps();
    runUpdate(deps);
    expect(out.join('\n')).toMatch(/gi[àa] all.ultima versione.*0\.3\.2/i);
  });

  it('installs and reports upgraded when a newer version exists', () => {
    const calls: string[][] = [];
    const { deps, out } = makeDeps({
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    expect(calls).toContainEqual(['npm', 'install', '-g', 'flagforge@latest']);
    expect(calls).toContainEqual(['nodenv', 'rehash']);
    expect(out.join('\n')).toMatch(/aggiornato da 0\.3\.2 a 0\.4\.0/i);
  });

  it('skips nodenv rehash when nodenv is not on PATH', () => {
    const calls: string[][] = [];
    const { deps, out } = makeDeps({
      hasCommand: (cmd) => cmd !== 'nodenv',
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    expect(calls.some(c => c[0] === 'nodenv')).toBe(false);
    expect(out.join('\n')).toMatch(/aggiornato/i);
  });

  it('prints root install commands (no restart) when install fails with EACCES', () => {
    const { deps, out } = makeDeps({
      run: (cmd, args) => {
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        if (cmd === 'npm' && args[0] === 'install') {
          const err = new Error('EACCES') as NodeJS.ErrnoException;
          err.code = 'EACCES';
          return { status: 1, stdout: '', stderr: 'permission denied', error: err };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    const text = out.join('\n');
    expect(text).toMatch(/permessi insufficienti/i);
    expect(text).toMatch(/npm i(nstall)? -g flagforge@latest/i);
  });

  it('never prints a restart command in any branch', () => {
    for (const latest of ['0.3.2', '0.4.0']) {
      const { deps, out } = makeDeps({
        run: (cmd, args) => {
          if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: `${latest}\n`, stderr: '' };
          return { status: 0, stdout: '', stderr: '' };
        },
      });
      runUpdate(deps);
      expect(out.join('\n')).not.toMatch(/pm2|systemctl|restart|riavvia il servizio con/i);
    }
  });
});
```

- [ ] **Step 2: Esegui e verifica il fallimento**

Run: `yarn test src/test/updater.test.ts`
Expected: FAIL (modulo `../updater` non trovato).

- [ ] **Step 3: Implementa `src/updater.ts`**

```ts
export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

export interface UpdaterDeps {
  currentVersion: string;
  run: (cmd: string, args: string[]) => RunResult;
  hasCommand: (cmd: string) => boolean;
  log: (msg: string) => void;
}

function isPermissionError(res: RunResult): boolean {
  if (res.error?.code === 'EACCES') return true;
  return /eacces|permission denied|EACCES/i.test(res.stderr);
}

export function runUpdate(deps: UpdaterDeps): void {
  const { currentVersion, run, hasCommand, log } = deps;

  const view = run('npm', ['view', 'flagforge', 'version']);
  if (view.status !== 0) {
    log('Impossibile determinare l’ultima versione su npm.');
    if (view.stderr.trim()) log(view.stderr.trim());
    return;
  }
  const latest = view.stdout.trim();
  if (!latest) {
    log('Impossibile determinare l’ultima versione su npm.');
    return;
  }

  if (latest === currentVersion) {
    log(`Già all’ultima versione (${currentVersion}).`);
    return;
  }

  const install = run('npm', ['install', '-g', 'flagforge@latest']);
  if (install.status !== 0) {
    if (isPermissionError(install)) {
      log('Impossibile aggiornare: permessi insufficienti.');
      log('Esegui come root:');
      log('  npm i -g flagforge@latest');
      if (hasCommand('nodenv')) log('  nodenv rehash');
      return;
    }
    log('Aggiornamento fallito.');
    if (install.stderr.trim()) log(install.stderr.trim());
    return;
  }

  if (hasCommand('nodenv')) {
    run('nodenv', ['rehash']);
  } else {
    log('nodenv non rilevato: salto il rehash.');
  }

  log(`Aggiornato da ${currentVersion} a ${latest}.`);
  log('Riavvia il servizio per applicare la nuova versione.');
}
```

- [ ] **Step 4: Esegui i test e verifica che passano**

Run: `yarn test src/test/updater.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater.ts src/test/updater.test.ts
git commit -m "feat: aggiungi modulo updater con runner iniettabile"
```

---

### Task 2: Integrazione nel CLI

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `runUpdate`, `UpdaterDeps`, `RunResult` da `src/updater.js`.
- Produces: `flagforge update` funzionante; voce help.

- [ ] **Step 1: Import e helper di esecuzione reale** in cima a `src/cli.ts`

Aggiungi agli import esistenti:

```ts
import { spawnSync } from 'child_process';
import { runUpdate, RunResult } from './updater.js';
```

Aggiungi una funzione `runRealUpdate` vicino a `runStart`:

```ts
function runRealUpdate(): void {
  const run = (cmd: string, args: string[]): RunResult => {
    const res = spawnSync(cmd, args, { encoding: 'utf8' });
    return {
      status: res.status ?? (res.error ? 1 : 0),
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
      error: res.error as NodeJS.ErrnoException | undefined,
    };
  };
  const hasCommand = (cmd: string): boolean => {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
    return (probe.status ?? 1) === 0;
  };
  runUpdate({
    currentVersion: readVersion(),
    run,
    hasCommand,
    log: (m) => console.log(m),
  });
}
```

- [ ] **Step 2: Aggiungi il case nello switch**

Dentro `switch (cmd)` in `main()`, prima di `default`:

```ts
    case 'update':
      runRealUpdate();
      break;
```

- [ ] **Step 3: Aggiorna l'help**

In `printHelp`, aggiungi la riga sotto `start`:

```
  flagforge update    Aggiorna FlagForge all'ultima versione (dove i permessi lo consentono)
```

- [ ] **Step 4: Build + smoke + verifica manuale help**

Run: `yarn build && yarn smoke && node dist/cli.js --help`
Expected: build OK, smoke OK, l'help mostra la riga `update`.

- [ ] **Step 5: Verifica `update` in dev (già "aggiornato" o messaggio coerente)**

Run: `node dist/cli.js update`
Expected: stampa un messaggio sensato. Nota: in dev `readVersion()` è `0.0.0` mentre npm ha una versione reale → il comando tenterà l'install. Per una verifica non distruttiva puoi limitarti al fatto che NON crasha e stampa output coerente (non serve completare un'install reale). Se preferisci evitare l'install, interrompi pure — il comportamento reale è coperto dai test unitari del Task 1.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat: aggiungi comando update alla cli"
```

---

### Task 3: Documentazione e verifica finale

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Documenta il comando nel README**

Trova la sezione che elenca i comandi CLI (`flagforge init`, `flagforge start`) — cercala con una lettura del README (es. attorno alla "Quick Start"). Aggiungi una voce per `flagforge update` con una descrizione onesta:

```markdown
### Updating

```bash
flagforge update
```

Updates the global `flagforge` package to the latest version published on npm.
If the update needs elevated permissions (global install owned by root), the
command prints the exact commands to run as root instead of failing. It never
restarts your service — restart it yourself with whatever process manager you
use.
```

Se non esiste una sezione comandi dedicata, inseriscila in modo coerente vicino a "Quick Start"/"Running".

- [ ] **Step 2: Verifica finale completa**

Run: `yarn test && yarn build && yarn smoke`
Expected: tutto PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: documenta il comando flagforge update"
```

---

## Note finali

- Non pushare né aprire la PR senza conferma esplicita dell'utente.
- PR verso `develop`, titolo `feat: ...` → bump minor in CI.
- Al merge, lo smoke test in CI proteggerà comunque da import ESM rotti.
