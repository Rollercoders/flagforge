# FlagForge MCP Server — Design

**Data:** 2026-07-02
**Stato:** approvato per implementazione

## Obiettivo

Esporre un server MCP (Model Context Protocol) accanto all'istanza centralizzata di
FlagForge, così che agenti AI (Claude Desktop, Claude Code, ecc.) — anche remoti —
possano gestire i feature flag: elencarli, crearli, aggiornarli (accendere/spegnere,
targeting, rollout) e valutarli. Caso d'uso primario: un agente che sviluppa contro
FlagForge deve poter "smanettare sui flag" per i propri test.

## Decisioni di scope

- **Un solo processo `flagforge`.** L'endpoint MCP è montato dallo stesso processo che
  serve UI/API/admin. Condivide le **istanze `Storage` e `FlagEvaluator` in memoria** →
  nessun problema di lock/concorrenza SQLite.
- **Trasporto HTTP** (non stdio): l'istanza FlagForge è centralizzata e unica, gli agenti
  che la pilotano possono essere su macchine diverse.
- **Auth: bearer token statico** (`MCP_TOKEN`). Un token = pieni poteri sui tool, su
  qualsiasi progetto/environment. Nessun altro guardrail (deciso esplicitamente).
- **Opt-in esplicito:** l'endpoint MCP viene montato **solo se `MCP_TOKEN` è configurato**.
  A differenza di `ADMIN_PASSWORD`, il token **non** viene auto-generato al boot. Se manca,
  la superficie MCP non esiste (default off).
- **SDK ufficiale MCP** (`@modelcontextprotocol/sdk`) in **stateless mode**
  (`sessionIdGenerator: undefined`), montato come route Express `POST /mcp`. Non
  reimplementiamo il protocollo JSON-RPC a mano.
- **L'MCP non elimina flag.** La cancellazione resta un'azione umana dalla UI. L'agente
  può creare, aggiornare (incluso spegnere via `enabled: false`) e valutare.
- **Fuori scope:** gestione progetti (create/delete), gestione environment
  (create/rename/delete), esposizione delle API key `ff_`. I progetti/environment si
  creano dalla UI; l'MCP li legge soltanto per orientarsi.

## Architettura

```
processo flagforge (Express)
├── /auth, /admin/*, /api/*        ← invariati
├── /health                        ← invariato
└── POST /mcp   [mcpBearerAuth(MCP_TOKEN)]   ← NUOVO (solo se MCP_TOKEN presente)
        └── McpServer (SDK) ── tools ──▶ Storage / FlagEvaluator (istanze condivise)
```

Aggancio in `src/server.ts`, dopo la creazione di `storage` ed `evaluator`:

```ts
if (process.env.MCP_TOKEN) {
  app.use('/mcp', createMcpRouter(storage, evaluator, process.env.MCP_TOKEN));
  console.log('✓ MCP endpoint mounted at /mcp');
}
```

`ServerConfig` acquisisce un campo `mcpToken?: string` letto da `.env`, coerente con la
gestione di `adminPassword`.

## Autenticazione

Middleware `mcpBearerAuth(token)` davanti a `POST /mcp`:

- legge `Authorization: Bearer <token>`;
- confronto **timing-safe** (`crypto.timingSafeEqual`) contro `MCP_TOKEN`;
- header assente o token diverso → `401`.

## Tool MCP

Cinque tool. Input validati con schema Zod; ogni handler chiama `Storage`/`FlagEvaluator`
e ritorna il risultato come `content` testuale (JSON). Handler iniettati con `Storage` e
`FlagEvaluator` (dependency injection, niente singleton globali).

**Bussola (read-only)**

1. **`list_projects`** — nessun input → elenco progetti (`id`, `name`).
2. **`list_environments`** — `{ projectId }` → environment del progetto (`id`, `name`).
   **Non** espone le API key `ff_`.
3. **`list_flags`** — `{ projectId, environment }` → tutti i flag del contesto.

**Gestione flag**

4. **`set_flag`** — upsert. Input:
   `{ projectId, environment, key, name?, description?, enabled?, targeting?, rollout? }`.
   Se il flag non esiste → `createFlag`; se esiste → `updateFlag` (patch). Un solo tool
   "upsert" invece di create + update separati. Valida `rollout.percentage` in [0, 100] e
   la forma di `targeting`. Nota: le route admin attuali **non** validano `rollout.percentage`,
   quindi questa validazione viene introdotta negli schemi Zod dei tool MCP.

5. **`evaluate_flag`** — `{ projectId, environment, key, userId?, attributes? }` → usa
   `FlagEvaluator` e ritorna se il flag risulta attivo per quel contesto, con la
   motivazione (enabled / targeting / rollout).

Nessun tool di delete (deciso).

## Struttura del codice

Nuova cartella `src/mcp/`, con confini netti:

- **`src/mcp/auth.ts`** — `mcpBearerAuth(token)`. Non sa nulla di MCP.
- **`src/mcp/tools.ts`** — definizione dei 5 tool (nome, schema Zod, handler). Handler
  ricevono `Storage` e `FlagEvaluator` per DI. Contiene la mappatura input→Storage e la
  validazione di `targeting`/`rollout`. Non sa nulla di HTTP.
- **`src/mcp/server.ts`** — `createMcpRouter(storage, evaluator, token)`: costruisce
  `McpServer`, registra i tool da `tools.ts`, monta `StreamableHTTPServerTransport`
  stateless su un `express.Router` con `mcpBearerAuth` davanti. Ritorna il router. Fa solo
  wiring.

Aggancio in `src/server.ts`: poche righe (vedi Architettura).

## Testing

Vitest + supertest, un file per unità in `src/test/`. Sviluppo in TDD.

- **`src/test/mcp-auth.test.ts`** — `mcpBearerAuth`: no header → 401; token errato → 401;
  token corretto → `next()`.
- **`src/test/mcp-tools.test.ts`** — ogni handler con uno **Storage fake in-memory** +
  `FlagEvaluator` reale:
  - `list_projects` / `list_environments` / `list_flags` ritornano i dati attesi;
  - `set_flag` **crea** quando il flag non esiste e **aggiorna** quando esiste (incluso
    `enabled: false`);
  - `set_flag` valida `rollout.percentage` (rifiuta fuori [0, 100]) e `targeting` malformato;
  - `list_environments` **non** espone la chiave `ff_`;
  - `evaluate_flag` restituisce l'esito corretto per targeting/rollout/enabled.
- **`src/test/mcp-server.test.ts`** — integrazione via supertest: chiamata JSON-RPC
  `tools/list` e `tools/call` (es. `set_flag` poi `list_flags`) con `Authorization: Bearer`;
  verifica anche il `401` senza token.

## Setup e documentazione

**`flagforge init`** (`src/cli.ts` + `src/cliConfig.ts`): dopo le domande attuali (porta,
storage, admin password), un prompt `@clack/prompts`:
*"Setup also FlagForge MCP server? (lets AI agents manage flags)"* → sì/no.

- **Sì:** genera `MCP_TOKEN` (`ff_mcp_${nanoid(32)}`) e lo scrive in `.env`. A fine wizard
  stampa il token e uno snippet di config MCP pronto (blocco `mcpServers` con URL
  `http://<host>:<port>/mcp` e header `Authorization: Bearer <token>`).
- **No:** `.env` senza `MCP_TOKEN`, endpoint spento.

**Documentazione:**

- `.env.example`: `MCP_TOKEN=` commentato con una riga di spiegazione.
- `README.md`: sezione "MCP Server" — cos'è, come abilitarlo, i 5 tool, lo snippet di
  config client. Chiarisce che è opt-in e che il token dà pieni poteri sui flag.

## Dipendenze nuove

- `@modelcontextprotocol/sdk` (SDK MCP ufficiale).
- `zod` (schema input dei tool), se non già presente transitivamente.

Il nome/percorso esatto dei simboli dell'SDK (`McpServer`, `StreamableHTTPServerTransport`)
verrà confermato in fase di plan contro la versione installata.
