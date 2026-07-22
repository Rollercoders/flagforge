# FlagForge — `npx flagforge init` (1-click installer)

**Data:** 2026-06-29
**Branch:** `feature/npx-init-cli`

## Obiettivo

Permettere a un utente di mettere su FlagForge "up and running" con un singolo
comando: `npx flagforge init`. Un wizard interattivo raccoglie la
configurazione, scrive `.env`, prepara lo storage e avvia il server, stampando
l'URL e la password admin.

## Decisioni chiave

| Aspetto | Decisione |
|---------|-----------|
| Tipo di init | Wizard interattivo (porta, storage, password) |
| Distribuzione | Pacchetto pubblicato su npm con campo `bin` |
| Modello runtime | CLI globale: codice nel pacchetto, dati nella `cwd` |
| Fine wizard | Avvia subito il server **+** comando `start` separato per i riavvii |
| Auto-open browser | No — stampa solo URL e password |
| Libreria prompt | `@clack/prompts` (UX curata, dependency leggera) |
| Architettura | CLI sottile che riusa una `startServer()` estratta da `index.ts` |

## Architettura

Refactor minimo + nuovo entry point CLI. Tre file con responsabilità nette:

```
cli.ts  ──┐
          ├──► server.ts  (startServer(config))
index.ts ─┘
```

### `src/server.ts` (nuovo)

Estrae da `index.ts` tutta la logica Express in una funzione esportabile:

```ts
export interface ServerConfig {
  port: number;
  storageType: 'sqlite' | 'json';
  storagePath: string;
  adminPassword?: string; // se assente, generata e restituita
}

export async function startServer(config: ServerConfig): Promise<{ adminPassword: string; url: string }>;
```

- Tutta la configurazione arriva dalla `config`, **non** letta da `process.env`
  internamente.
- La generazione della admin password (oggi `bootstrapAdminPassword`) si sposta
  qui ma diventa pura: se `config.adminPassword` manca, ne genera una e la
  restituisce al chiamante (chi chiama decide come mostrarla/persisterla).
- Serve la UI da `../ui/dist` relativo a `__dirname` come oggi.

### `src/index.ts` (semplificato)

Resta l'entry point "diretto" per `node dist/index.js` / `yarn start`:
- `dotenv.config()`
- costruisce `ServerConfig` da `process.env` (con i default attuali)
- chiama `startServer()` e stampa l'output.

Retro-compatibilità totale: `yarn start` continua a funzionare identico.

### `src/cli.ts` (nuovo — è il `bin`)

Shebang `#!/usr/bin/env node`. Responsabilità:
- parsing del comando (`init` | `start` | `--help` | `--version`)
- wizard interattivo (solo `init`)
- scrittura `.env`, `mkdir -p data/`
- chiamata a `startServer()`

Una funzione pura `buildConfigFromAnswers(answers): ServerConfig` separa la
logica decisionale (default, derivazione storage path) dal wizard interattivo,
così è testabile in isolamento.

## Comandi

### `flagforge init`

1. Se `.env` esiste → chiede conferma prima di sovrascrivere (default: no,
   prosegue con quello esistente).
2. Wizard `@clack/prompts`:
   - **Porta** — default `6789`
   - **Storage** — select `sqlite` (default) / `json`
   - **Storage path** — default coerente (`./data/flagforge.db` o
     `./data/flags.json`)
   - **Admin password** — text opzionale; se vuoto → genera
     `ff_admin_<nanoid>` e la mostra a fine setup
3. Scrive `.env` con i valori, crea la cartella `data/`.
4. Chiama `startServer(config)`. Stampa URL + password admin (se generata).

### `flagforge start`

Nessun prompt. Carica `.env` esistente (errore chiaro se manca: "esegui prima
`flagforge init`"), costruisce config, avvia. Equivalente di `yarn start` come
binario globale.

### `flagforge --help` / `--version`

Output sintetico.

### Ctrl-C

Chiusura pulita del processo. Durante il wizard, `@clack/prompts` gestisce
`isCancel` → uscita pulita.

## Packaging npm

- `"bin": { "flagforge": "./dist/cli.js" }`
- `"files": ["dist", "ui/dist", "README.md", "LICENSE"]` — include server+CLI
  buildati e UI buildata nel tarball.
- `"prepublishOnly": "yarn build"` — garantisce che `ui/dist` e `dist` esistano
  al publish (`build` già fa `ui:build && tsc`).
- `better-sqlite3`: resta `dependency` reale (modulo nativo, ricompilato in
  install sull'host). Coerente col modello globale.
- `@clack/prompts`: aggiunto alle `dependencies` (serve a runtime nella CLI).
- Verifica: `npm pack --dry-run` mostra il contenuto atteso.

## Error handling

- `.env` mancante su `start` → messaggio chiaro + exit 1.
- Porta occupata (`EADDRINUSE`) → messaggio leggibile, non stack trace.
- `Ctrl-C` durante il wizard → uscita pulita.
- Storage path non scrivibile → errore comprensibile.

## Testing

- I test esistenti restano verdi dopo l'estrazione di `startServer` (verifica
  con `yarn test`).
- Nuovo test unitario per `buildConfigFromAnswers()` (logica pura).
- Smoke test manuale: `npm pack` → install del tarball in cartella temp →
  `npx flagforge init`.

## Docs

README: nuova sezione "Quick Start" in cima con `npx flagforge init` come modo
consigliato.

## Out of scope (YAGNI)

- Auto-open browser
- Modalità eject / Docker installer
- Pubblicazione effettiva su npm (il design la abilita, ma il publish è un atto
  separato e manuale a discrezione dell'utente)
