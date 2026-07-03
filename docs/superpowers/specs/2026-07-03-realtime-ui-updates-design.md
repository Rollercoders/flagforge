# Realtime UI Updates — Design

**Data:** 2026-07-03
**Stato:** approvato per implementazione

## Obiettivo

Quando un flag cambia — da UI o da un agente via MCP — la UI aperta deve aggiornarsi
in tempo reale senza reload manuale. Caso d'uso: un agente AI modifica i flag mentre
l'utente guarda la UI; oggi non vede nulla finché non ricarica.

## Contesto attuale

- UI React (Vite) servita dallo stesso processo Express.
- La UI carica i dati con `fetch` dentro `useEffect` (on-mount / on-change delle
  dipendenze). Nessun polling, nessun realtime.
- Le mutazioni sui flag arrivano da due strade — le route `/admin/*` (UI) e i tool MCP —
  ma **entrambe passano dallo stesso oggetto `Storage`**.

## Decisioni di scope

- **Trasporto: SSE** (Server-Sent Events). Push unidirezionale server→UI, nativo nel
  browser (`EventSource`), zero dipendenze in Express. WebSocket sarebbe sovradimensionato
  (flusso solo server→client); il polling non è vero realtime.
- **Payload evento: segnale "refetch" con scope.** L'evento trasporta solo
  `{ projectId, environment? }`. La UI, se sta guardando quella vista, rifà la fetch che
  già sa fare e ridisegna. Nessuna logica di merge di stato lato client → nessuna
  divergenza di sincronizzazione. L'evento è un *trigger*, non una nuova sorgente di verità.
- **Sorgente eventi: un decorator attorno allo Storage.** `EventEmittingStorage` avvolge lo
  Storage reale ed emette dopo ogni mutazione flag. Sia le route admin sia i tool MCP usano
  lo Storage, quindi il decorator cattura entrambe le strade per costruzione, senza
  duplicare codice e **senza toccare** le implementazioni `sqlite`/`json` (persistenza e
  notifica restano responsabilità separate).
- **Fuori scope:** eventi per mutazioni di environment (rename/regenerate-key/delete) e di
  progetto. La richiesta riguarda i flag; l'MCP tocca solo i flag. YAGNI.

## Architettura

```
UI (EventSource /admin/events) ◀──SSE── GET /admin/events ◀── FlagChangeBus
                                                                 ▲ emit {projectId, environment}
                          route /admin/* ─┐                      │
                          tool MCP        ─┴─▶ EventEmittingStorage(Storage reale)
```

In `server.ts` lo Storage reale viene avvolto una volta con `EventEmittingStorage`; da lì
in poi ogni consumatore (admin + MCP) usa il wrapper. Un nuovo endpoint `GET /admin/events`
tiene aperta una connessione SSE sottoscritta al bus e inoltra i cambiamenti al browser.

## Componenti

### `FlagChangeBus` (`src/events/flagChangeBus.ts`)

Wrapper tipato su `EventEmitter` di Node:
- `emit(change: { projectId: string; environment?: string }): void`
- `subscribe(listener: (change) => void): () => void` — ritorna la funzione di unsubscribe.

Non sa nulla di HTTP né di Storage.

### `EventEmittingStorage` (`src/storage/eventEmittingStorage.ts`)

Implementa `Storage`. Costruttore: `(inner: Storage, bus: FlagChangeBus)`. Delega tutti i
metodi all'inner; emette **dopo** che la scrittura è riuscita, solo per le mutazioni flag:
- `createFlag(flag)` → `emit({ projectId: flag.projectId, environment: flag.environment })`
- `updateFlag(id, updates)` → l'inner ritorna il `Flag` aggiornato; emette
  `{ projectId: updated.projectId, environment: updated.environment }`
- `deleteFlag(projectId, key)` → `emit({ projectId })` (la delete è per progetto+key,
  senza environment)

Gli altri metodi (progetti, environment, letture, admin key) delegano e basta. Non sa nulla
di SSE. Non tocca `sqlite.ts`/`json.ts`.

### `GET /admin/events` (`src/routes/adminEvents.ts`)

Router montato sotto `requireAdminSession` come le altre `/admin/*`. Riceve il
`FlagChangeBus`. Alla connessione:
- header SSE (`Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`) + `flushHeaders()`;
- `subscribe` al bus: ad ogni change scrive `data: {"projectId":...,"environment":...}\n\n`;
- heartbeat periodico (commento SSE `:\n\n` ogni ~25s) per tenere viva la connessione
  attraverso proxy/timeout;
- su `req.on('close')`: unsubscribe + clear dell'interval heartbeat (nessun listener orfano).

Poiché è protetto da sessione, l'`EventSource` del browser invia automaticamente il cookie
(stesso dominio) — nessuna auth aggiuntiva.

### `useFlagChanges` (`ui/src/hooks/useFlagChanges.ts`)

Hook React: apre `EventSource('/admin/events')`, fa il parse di ogni messaggio in
`{ projectId, environment }`, invoca `onChange(change)`. Cleanup (`es.close()`) allo
smontaggio; la riconnessione automatica è gestita dall'`EventSource` nativo.

Aggancio nelle viste:
- **FlagsPage** (`projectId`+`environment` correnti): su evento il cui `projectId` **e**
  `environment` combaciano con la vista corrente, richiama la fetch dei flag esistente.
  Match mirato → nessun refetch inutile per altri progetti/environment.
- **Projects/Environments view**: rifetch della lista pertinente su evento rilevante.

Il refetch riusa le funzioni in `ui/src/api/flags.ts` già usate dagli `useEffect`.

## Integrazione in `server.ts`

- Creare il `FlagChangeBus`; avvolgere lo Storage reale: `storage = new
  EventEmittingStorage(realStorage, bus)` **dopo** `initialize()`/`bootstrapAdminKey()`
  (o avvolgere e delegare quelle chiamate all'inner — l'avvolgimento deve preservare il
  comportamento di init).
- Montare `/admin/events` con `requireAdminSession`, insieme alle altre `/admin/*`,
  **prima** dello static e del catch-all SPA.
- Tutti i router e `createMcpRouter` ricevono lo `storage` avvolto (così l'MCP emette).

## Testing

Vitest + supertest lato server.

- **`src/test/flagChangeBus.test.ts`** — `emit` invoca i listener col payload giusto;
  l'unsubscribe ferma le notifiche; più sottoscrittori ricevono tutti.
- **`src/test/eventEmittingStorage.test.ts`** — con `FakeStorage` + bus spiato: `createFlag`
  emette `{projectId, environment}`; `updateFlag` emette dal flag ritornato; `deleteFlag`
  emette `{projectId}`; le letture NON emettono; tutte le chiamate delegano (valore di
  ritorno passato attraverso).
- **`src/test/routes-adminEvents.test.ts`** — supertest: senza sessione → 401; con sessione
  → `Content-Type: text/event-stream`; su `bus.emit` lo stream riceve una riga `data: ...`
  col payload atteso. Timeout breve e chiusura esplicita per non lasciare handle aperti.

**UI:** la suite UI attuale è minima. Mantenere `useFlagChanges` piccolo; se manca il setup
di test React, testare almeno la funzione pura di parsing del messaggio evento senza montare
React. Non introdurre un nuovo framework di test UI.

## Confini

- `FlagChangeBus`: non conosce HTTP né Storage.
- `EventEmittingStorage`: non conosce SSE; non tocca le implementazioni concrete.
- `adminEvents`: non conosce lo Storage, solo il bus.
- `useFlagChanges`: solo trasporto+parse; il refetch è delle viste, che riusano l'API esistente.
