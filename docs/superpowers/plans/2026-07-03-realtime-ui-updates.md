# Realtime UI Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando un flag cambia (da UI o da agente via MCP), la UI aperta si aggiorna in tempo reale via SSE, senza reload.

**Architecture:** Un decorator `EventEmittingStorage` avvolge lo Storage reale ed emette su un `FlagChangeBus` dopo ogni mutazione flag. Sia le route `/admin/*` sia i tool MCP usano lo Storage avvolto → entrambe le strade emettono. Un endpoint `GET /admin/events` (SSE, protetto da sessione) inoltra i cambiamenti al browser; un hook React `useFlagChanges` apre un `EventSource` e, su evento con scope combaciante, rifà la fetch che la UI già conosce.

**Tech Stack:** TypeScript (ESM), Express 4, Node `EventEmitter`, SSE (`text/event-stream` + `EventSource`), React (Vite), Vitest + supertest.

## Global Constraints

- Node >= 20, ESM (`"type": "module"`): import relativi interni con estensione `.js`.
- Yarn 4 (`yarn@4.12.0`): `yarn test <file>`, `yarn lint`, `yarn build`. Mai `npm`.
- Commit conventional in italiano, senza scope (`feat: ...`). Mai su `develop`; branch di lavoro `feat/mcp-server` (già attivo).
- Test server in `src/test/`, stile Vitest + supertest esistente.
- Payload evento = solo `{ projectId: string; environment?: string }` (segnale refetch con scope). Nessun merge di stato lato client.
- Fuori scope: eventi per mutazioni di environment/progetto. Solo flag (`createFlag`/`updateFlag`/`deleteFlag`).
- NON modificare le implementazioni concrete `src/storage/sqlite.ts` e `src/storage/json.ts`.

---

### Task 1: FlagChangeBus

**Files:**
- Create: `src/events/flagChangeBus.ts`
- Test: `src/test/flagChangeBus.test.ts`

**Interfaces:**
- Consumes: `EventEmitter` da `'events'` (Node).
- Produces:
  - `interface FlagChange { projectId: string; environment?: string }`
  - `class FlagChangeBus` con `emit(change: FlagChange): void` e `subscribe(listener: (change: FlagChange) => void): () => void` (ritorna la funzione di unsubscribe).

- [ ] **Step 1: Scrivere il test che fallisce**

Create `src/test/flagChangeBus.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';

describe('FlagChangeBus', () => {
  it('consegna gli eventi ai sottoscrittori', () => {
    const bus = new FlagChangeBus();
    const received: FlagChange[] = [];
    bus.subscribe(c => received.push(c));
    bus.emit({ projectId: 'p1', environment: 'production' });
    expect(received).toEqual([{ projectId: 'p1', environment: 'production' }]);
  });

  it('consegna a più sottoscrittori', () => {
    const bus = new FlagChangeBus();
    let a = 0, b = 0;
    bus.subscribe(() => a++);
    bus.subscribe(() => b++);
    bus.emit({ projectId: 'p1' });
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('unsubscribe ferma le notifiche', () => {
    const bus = new FlagChangeBus();
    const received: FlagChange[] = [];
    const unsub = bus.subscribe(c => received.push(c));
    unsub();
    bus.emit({ projectId: 'p1' });
    expect(received).toEqual([]);
  });
});
```

- [ ] **Step 2: Eseguire il test per vederlo fallire**

Run: `yarn test src/test/flagChangeBus.test.ts`
Expected: FAIL — `Cannot find module '../events/flagChangeBus.js'`.

- [ ] **Step 3: Implementare il bus**

Create `src/events/flagChangeBus.ts`:
```ts
import { EventEmitter } from 'events';

export interface FlagChange {
  projectId: string;
  environment?: string;
}

const EVENT = 'flag-change';

export class FlagChangeBus {
  private emitter = new EventEmitter();

  constructor() {
    // Molte connessioni SSE possono sottoscrivere: alza il limite per evitare il warning di leak.
    this.emitter.setMaxListeners(0);
  }

  emit(change: FlagChange): void {
    this.emitter.emit(EVENT, change);
  }

  subscribe(listener: (change: FlagChange) => void): () => void {
    this.emitter.on(EVENT, listener);
    return () => this.emitter.off(EVENT, listener);
  }
}
```

- [ ] **Step 4: Eseguire il test per vederlo passare**

Run: `yarn test src/test/flagChangeBus.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add src/events/flagChangeBus.ts src/test/flagChangeBus.test.ts
git commit -m "feat: aggiungi bus per gli eventi di cambio flag"
```

---

### Task 2: EventEmittingStorage (decorator)

**Files:**
- Create: `src/storage/eventEmittingStorage.ts`
- Test: `src/test/eventEmittingStorage.test.ts`

**Interfaces:**
- Consumes: `Storage`, `Flag`, `Project`, `Environment` da `../types.js`; `FlagChangeBus`, `FlagChange` da `../events/flagChangeBus.js`.
- Produces: `class EventEmittingStorage implements Storage` con costruttore `(inner: Storage, bus: FlagChangeBus)`. Delega ogni metodo a `inner`; dopo le mutazioni flag emette su `bus`.

Note di dominio (firme reali, verificate in `src/types.ts`):
- `createFlag(flag: Omit<Flag,'id'|'createdAt'|'updatedAt'>): Promise<Flag[]>`
- `updateFlag(id: string, updates: Partial<Flag>): Promise<Flag>`
- `deleteFlag(projectId: string, key: string): Promise<void>`
- Metodi da delegare senza emit: `initialize`, `createProject`, `getProject`, `getAllProjects`, `deleteProject`, `createEnvironment`, `getEnvironmentsByProject`, `deleteEnvironment`, `renameEnvironment`, `regenerateEnvironmentKey`, `getEnvironmentByKey`, `getFlag`, `getAllFlags`, `getAdminKey`, `bootstrapAdminKey`.

- [ ] **Step 1: Scrivere il test che fallisce**

Create `src/test/eventEmittingStorage.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmittingStorage } from '../storage/eventEmittingStorage.js';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';
import { Storage, Flag } from '../types.js';

// FakeStorage minimale: implementa i metodi toccati dai test.
class FakeStorage implements Partial<Storage> {
  createFlagCalls: unknown[] = [];
  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    this.createFlagCalls.push(flag);
    return [{ ...flag, id: 'f1', createdAt: 't', updatedAt: 't' }];
  }
  async updateFlag(id: string, updates: Partial<Flag>): Promise<Flag> {
    return { id, projectId: 'p1', key: 'k', name: 'N', enabled: true, environment: 'production', createdAt: 't', updatedAt: 't2', ...updates };
  }
  async deleteFlag(_projectId: string, _key: string): Promise<void> { /* noop */ }
  async getAllProjects() { return []; }
}

let inner: FakeStorage;
let bus: FlagChangeBus;
let changes: FlagChange[];
let storage: EventEmittingStorage;

beforeEach(() => {
  inner = new FakeStorage();
  bus = new FlagChangeBus();
  changes = [];
  bus.subscribe(c => changes.push(c));
  storage = new EventEmittingStorage(inner as unknown as Storage, bus);
});

describe('EventEmittingStorage', () => {
  it('createFlag emette {projectId, environment} dopo la scrittura e delega', async () => {
    const result = await storage.createFlag({ projectId: 'p1', key: 'k', name: 'N', enabled: false, environment: 'production' });
    expect(result).toHaveLength(1);           // valore di ritorno dell'inner passato attraverso
    expect(inner.createFlagCalls).toHaveLength(1); // delega avvenuta
    expect(changes).toEqual([{ projectId: 'p1', environment: 'production' }]);
  });

  it('updateFlag emette usando projectId/environment del flag ritornato', async () => {
    await storage.updateFlag('f1', { enabled: false });
    expect(changes).toEqual([{ projectId: 'p1', environment: 'production' }]);
  });

  it('deleteFlag emette {projectId}', async () => {
    await storage.deleteFlag('p1', 'k');
    expect(changes).toEqual([{ projectId: 'p1' }]);
  });

  it('i metodi di lettura NON emettono', async () => {
    await storage.getAllProjects();
    expect(changes).toEqual([]);
  });
});
```

- [ ] **Step 2: Eseguire il test per vederlo fallire**

Run: `yarn test src/test/eventEmittingStorage.test.ts`
Expected: FAIL — `Cannot find module '../storage/eventEmittingStorage.js'`.

- [ ] **Step 3: Implementare il decorator**

Create `src/storage/eventEmittingStorage.ts`:
```ts
import { Storage, Project, Environment, Flag } from '../types.js';
import { FlagChangeBus } from '../events/flagChangeBus.js';

export class EventEmittingStorage implements Storage {
  constructor(private inner: Storage, private bus: FlagChangeBus) {}

  initialize(): Promise<void> { return this.inner.initialize(); }

  // Projects
  createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> { return this.inner.createProject(project); }
  getProject(id: string): Promise<Project | null> { return this.inner.getProject(id); }
  getAllProjects(): Promise<Project[]> { return this.inner.getAllProjects(); }
  deleteProject(id: string): Promise<void> { return this.inner.deleteProject(id); }

  // Environments
  createEnvironment(env: Omit<Environment, 'id' | 'createdAt' | 'key'>): Promise<Environment> { return this.inner.createEnvironment(env); }
  getEnvironmentsByProject(projectId: string): Promise<Environment[]> { return this.inner.getEnvironmentsByProject(projectId); }
  deleteEnvironment(id: string): Promise<void> { return this.inner.deleteEnvironment(id); }
  renameEnvironment(id: string, name: string): Promise<Environment> { return this.inner.renameEnvironment(id, name); }
  regenerateEnvironmentKey(envId: string): Promise<Environment> { return this.inner.regenerateEnvironmentKey(envId); }
  getEnvironmentByKey(key: string): Promise<Environment | null> { return this.inner.getEnvironmentByKey(key); }

  // Flags — emit dopo mutazione
  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    const result = await this.inner.createFlag(flag);
    this.bus.emit({ projectId: flag.projectId, environment: flag.environment });
    return result;
  }
  async updateFlag(id: string, updates: Partial<Flag>): Promise<Flag> {
    const updated = await this.inner.updateFlag(id, updates);
    this.bus.emit({ projectId: updated.projectId, environment: updated.environment });
    return updated;
  }
  async deleteFlag(projectId: string, key: string): Promise<void> {
    await this.inner.deleteFlag(projectId, key);
    this.bus.emit({ projectId });
  }
  getFlag(projectId: string, key: string, environment: string): Promise<Flag | null> { return this.inner.getFlag(projectId, key, environment); }
  getAllFlags(projectId: string, environment?: string): Promise<Flag[]> { return this.inner.getAllFlags(projectId, environment); }

  // Admin key
  getAdminKey(): Promise<string | null> { return this.inner.getAdminKey(); }
  bootstrapAdminKey(): Promise<void> { return this.inner.bootstrapAdminKey(); }
}
```

- [ ] **Step 4: Eseguire il test per vederlo passare**

Run: `yarn test src/test/eventEmittingStorage.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Verifica che implementi l'intera interfaccia**

Run: `yarn build`
Expected: 0 errori TypeScript (se manca un metodo di `Storage`, `implements Storage` fallisce qui). Se `build` segnala un metodo mancante, aggiungerlo come delega semplice a `this.inner`.

- [ ] **Step 6: Commit**

```bash
git add src/storage/eventEmittingStorage.ts src/test/eventEmittingStorage.test.ts
git commit -m "feat: aggiungi storage decorator che emette eventi di cambio flag"
```

---

### Task 3: Endpoint SSE `GET /admin/events`

**Files:**
- Create: `src/routes/adminEvents.ts`
- Test: `src/test/routes-adminEvents.test.ts`

**Interfaces:**
- Consumes: `FlagChangeBus` da `../events/flagChangeBus.js`; `Router` da express.
- Produces: `createAdminEventsRouter(bus: FlagChangeBus): Router` — gestisce `GET /` (montato a `/admin/events`), risponde SSE, inoltra ogni `FlagChange` come `data: <json>\n\n`.

- [ ] **Step 1: Scrivere il test che fallisce**

Create `src/test/routes-adminEvents.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminEventsRouter } from '../routes/adminEvents.js';
import { FlagChangeBus } from '../events/flagChangeBus.js';

function app(bus: FlagChangeBus) {
  const a = express();
  a.use('/admin/events', createAdminEventsRouter(bus));
  return a;
}

describe('GET /admin/events', () => {
  it('risponde con content-type SSE', async () => {
    const bus = new FlagChangeBus();
    // Chiude la connessione dopo un breve intervallo emettendo e poi abortendo la richiesta.
    const req = request(app(bus)).get('/admin/events');
    // Emette dopo un tick così lo stream ha un evento da consegnare.
    setTimeout(() => bus.emit({ projectId: 'p1', environment: 'production' }), 20);
    // Timeout basso: raccogliamo l'inizio dello stream e chiudiamo.
    const res = await req.timeout({ deadline: 200, response: 200 }).catch((e: { response?: { headers: Record<string,string>; text: string } }) => e.response ?? e);
    const headers = (res as { headers: Record<string, string> }).headers;
    const text = (res as { text?: string }).text ?? '';
    expect(headers['content-type']).toContain('text/event-stream');
    expect(text).toContain('"projectId":"p1"');
    expect(text).toContain('"environment":"production"');
  });
});
```

> Nota per l'implementatore: testare uno stream SSE con supertest è intrinsecamente "aperto" (la connessione non si chiude da sola). Il pattern sopra usa un `timeout` breve e cattura la risposta parziale. Se questo risulta instabile nell'ambiente, in alternativa: (a) fai in modo che il router accetti un secondo parametro opzionale per iniettabilità, oppure (b) testa la logica di formattazione del messaggio estraendo una funzione pura `formatSseMessage(change): string` (che ritorna `` `data: ${JSON.stringify(change)}\n\n` ``) e testa quella in isolamento, più un test che verifica solo l'header `content-type` chiudendo subito la connessione con `.abort()`. Preferisci (b) se il timeout dà flakiness. Documenta la scelta nel report.

- [ ] **Step 2: Eseguire il test per vederlo fallire**

Run: `yarn test src/test/routes-adminEvents.test.ts`
Expected: FAIL — `Cannot find module '../routes/adminEvents.js'`.

- [ ] **Step 3: Implementare il router SSE**

Create `src/routes/adminEvents.ts`:
```ts
import { Router } from 'express';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';

export function formatSseMessage(change: FlagChange): string {
  return `data: ${JSON.stringify(change)}\n\n`;
}

export function createAdminEventsRouter(bus: FlagChangeBus): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = bus.subscribe((change) => {
      res.write(formatSseMessage(change));
    });

    // Heartbeat: commento SSE per tenere viva la connessione attraverso proxy/timeout.
    const heartbeat = setInterval(() => {
      res.write(':\n\n');
    }, 25_000);
    heartbeat.unref?.();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  return router;
}
```

- [ ] **Step 4: Eseguire il test per vederlo passare**

Run: `yarn test src/test/routes-adminEvents.test.ts`
Expected: PASS. Se instabile, applicare l'alternativa (b) documentata nello Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/routes/adminEvents.ts src/test/routes-adminEvents.test.ts
git commit -m "feat: aggiungi endpoint sse per gli eventi di cambio flag"
```

---

### Task 4: Wiring in `server.ts`

**Files:**
- Modify: `src/server.ts`
- Test: `src/test/routes-adminEvents.test.ts` (aggiungere un test di auth end-to-end via `startServer`? NO — vedi nota). Usare invece un test mirato che verifica il mount dietro sessione.

**Interfaces:**
- Consumes: `FlagChangeBus`, `EventEmittingStorage`, `createAdminEventsRouter`.
- Produces: lo `storage` usato da tutti i router e da `createMcpRouter` è l'istanza `EventEmittingStorage`; `/admin/events` montato dietro `requireAdminSession`.

- [ ] **Step 1: Avvolgere lo Storage e creare il bus**

In `src/server.ts`, aggiungere gli import in cima:
```ts
import { FlagChangeBus } from './events/flagChangeBus.js';
import { EventEmittingStorage } from './storage/eventEmittingStorage.js';
import { createAdminEventsRouter } from './routes/adminEvents.js';
```

Individuare il blocco esistente che crea lo storage:
```ts
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
```

Sostituirlo con (avvolgimento DOPO init/bootstrap, così l'inner è pronto; il wrapper delega comunque, quindi l'ordine è indifferente per correttezza, ma teniamo init sull'inner per chiarezza):
```ts
  let realStorage: Storage;
  if (config.storageType === 'json') {
    realStorage = new JsonStorage(config.storagePath);
  } else {
    realStorage = new SqliteStorage(config.storagePath);
  }

  await realStorage.initialize();
  console.log(`✓ Storage initialized (${config.storageType})`);

  await realStorage.bootstrapAdminKey();
  console.log('✓ UI admin key ready');

  const flagChangeBus = new FlagChangeBus();
  const storage: Storage = new EventEmittingStorage(realStorage, flagChangeBus);
```

> Nota: tutte le righe successive che usano `storage` (router admin, mcp, ecc.) restano invariate — ora puntano al wrapper. Verificare che non esistano altri riferimenti a `realStorage` oltre init/bootstrap.

- [ ] **Step 2: Montare l'endpoint SSE**

Individuare il blocco dei mount `/admin/*` esistente:
```ts
  app.use('/admin', requireAdminSession(sessions), createAdminRouter(storage));
  app.use('/admin', requireAdminSession(sessions), createProjectsRouter(storage));
  app.use('/admin/flags', requireAdminSession(sessions), createAdminFlagsRouter(storage));
  app.use('/admin/evaluate', requireAdminSession(sessions), createAdminEvaluateRouter(storage, evaluator));
```
Aggiungere subito dopo:
```ts
  app.use('/admin/events', requireAdminSession(sessions), createAdminEventsRouter(flagChangeBus));
```
Questo blocco resta **prima** di `express.static` e del catch-all SPA (invariati).

- [ ] **Step 3: Verifica build + suite completa**

Run: `yarn build && yarn test`
Expected: build ok; tutti i test verdi (i router esistenti continuano a funzionare col wrapper, che delega). Nessuna regressione.

- [ ] **Step 4: Verifica manuale end-to-end (SSE + MCP)**

Run (adatta la porta se serve):
```bash
MCP_TOKEN=demo-token ADMIN_PASSWORD=pw PORT=6799 STORAGE_TYPE=sqlite STORAGE_PATH=/tmp/ff-sse.db node dist/index.js &
SRV=$!
sleep 1
# login admin -> cookie
COOKIE=$(curl -s -i -X POST http://localhost:6799/auth/login -H 'Content-Type: application/json' -d '{"password":"pw"}' | grep -i 'set-cookie' | sed 's/.*set-cookie: //I;s/;.*//')
# crea progetto + env
PID=$(curl -s -X POST http://localhost:6799/admin/projects -H 'Content-Type: application/json' -H "Cookie: $COOKIE" -d '{"name":"SSE Test"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -X POST http://localhost:6799/admin/projects/$PID/environments -H 'Content-Type: application/json' -H "Cookie: $COOKIE" -d '{"name":"production"}' >/dev/null
# apri lo stream SSE in background, salva su file
( curl -s -N http://localhost:6799/admin/events -H "Cookie: $COOKIE" > /tmp/ff-sse-out.txt & echo $! > /tmp/ff-sse-curl.pid )
sleep 1
# muta un flag via MCP -> deve generare un evento sullo stream
curl -s -X POST http://localhost:6799/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'Authorization: Bearer demo-token' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"set_flag\",\"arguments\":{\"projectId\":\"$PID\",\"environment\":\"production\",\"key\":\"sse-flag\",\"name\":\"SSE\",\"enabled\":true}}}" >/dev/null
sleep 1
echo "=== contenuto stream SSE (atteso: una riga data: con projectId ed environment=production) ==="
cat /tmp/ff-sse-out.txt
# cleanup
kill "$(cat /tmp/ff-sse-curl.pid)" 2>/dev/null
kill $SRV 2>/dev/null
rm -f /tmp/ff-sse.db /tmp/ff-sse-out.txt /tmp/ff-sse-curl.pid
```
Expected: `/tmp/ff-sse-out.txt` contiene `data: {"projectId":"<PID>","environment":"production"}`. Conferma che una mutazione **via MCP** genera l'evento SSE. Riportare l'output nel report. Non lasciare processi orfani.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: avvolgi lo storage con gli eventi e monta lʼendpoint sse"
```

---

### Task 5: Hook UI `useFlagChanges` + aggancio nelle viste

**Files:**
- Create: `ui/src/hooks/useFlagChanges.ts`
- Modify: `ui/src/pages/FlagsPage.tsx` (usare l'hook per rifare `loadFlags` su evento con scope combaciante)
- Modify: `ui/src/App.tsx` (rifetch progetti/environment su evento rilevante — opzionale ma coerente)

**Interfaces:**
- Consumes: niente lato server (usa l'endpoint `/admin/events` via `EventSource`).
- Produces:
  - `interface FlagChange { projectId: string; environment?: string }`
  - `function useFlagChanges(onChange: (change: FlagChange) => void): void` — apre `EventSource('/admin/events')`, fa il parse dei messaggi, invoca `onChange`; cleanup allo smontaggio.

- [ ] **Step 1: Implementare l'hook**

Create `ui/src/hooks/useFlagChanges.ts`:
```ts
import { useEffect, useRef } from 'react';

export interface FlagChange {
  projectId: string;
  environment?: string;
}

export function useFlagChanges(onChange: (change: FlagChange) => void): void {
  // Ref al callback per non ricreare l'EventSource ad ogni render.
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const es = new EventSource('/admin/events');
    es.onmessage = (ev: MessageEvent) => {
      try {
        const change = JSON.parse(ev.data) as FlagChange;
        cb.current(change);
      } catch {
        // ignora messaggi non-JSON (es. heartbeat, che comunque è un commento e non arriva come onmessage)
      }
    };
    // onerror: EventSource ritenta automaticamente; non chiudiamo.
    return () => es.close();
  }, []);
}
```

- [ ] **Step 2: Agganciare l'hook in `FlagsPage.tsx`**

In `ui/src/pages/FlagsPage.tsx`, aggiungere l'import:
```ts
import { useFlagChanges } from '../hooks/useFlagChanges.js';
```
> Nota ESM/Vite: se gli altri import in questo file NON usano l'estensione `.js` (Vite/TS lo permette), seguire lo stile del file — usare `'../hooks/useFlagChanges'` senza estensione per coerenza. Controllare gli import esistenti nel file e uniformarsi.

Dopo la definizione di `loadFlags` (che è un `useCallback` con deps `[projectId, environment, showToast]`) e del suo `useEffect`, aggiungere:
```ts
  useFlagChanges((change) => {
    // Rifai la fetch solo se l'evento riguarda la vista corrente.
    if (change.projectId === projectId && (change.environment === undefined || change.environment === environment)) {
      void loadFlags();
    }
  });
```

- [ ] **Step 3: (Opzionale, coerente) rifetch in `App.tsx`**

In `ui/src/App.tsx`, per aggiornare la lista flag anche quando l'utente è sulla pagina progetti, NON è necessario: `FlagsPage` copre la vista dei flag. Lasciare `App.tsx` invariato salvo che si voglia reagire a cambi di progetto/ambiente, che sono fuori scope. **Saltare questo step** a meno di necessità emersa; documentarlo.

- [ ] **Step 4: Build UI**

Run: `yarn build`
Expected: build (vite + tsc) senza errori. `EventSource` è un tipo DOM standard, disponibile nella lib TS del progetto UI.

- [ ] **Step 5: Verifica manuale nel browser**

1. `yarn build` poi avvia: `MCP_TOKEN=demo-token ADMIN_PASSWORD=pw PORT=6789 STORAGE_TYPE=sqlite STORAGE_PATH=./data/flagforge.db node dist/index.js`
2. Apri `http://localhost:6789`, login `pw`, crea (se assenti) un progetto + environment `production`, vai su Feature Flags di quella vista.
3. In un terminale, muta un flag via MCP (curl `set_flag` come nel Task 4 Step 4, sullo stesso projectId/environment).
4. Atteso: la lista dei flag nella UI **si aggiorna da sola** entro ~1s, senza reload.

Riportare l'esito nel report (screenshot o descrizione del comportamento osservato).

- [ ] **Step 6: Commit**

```bash
git add ui/src/hooks/useFlagChanges.ts ui/src/pages/FlagsPage.tsx
git commit -m "feat: aggiorna la lista flag in tempo reale via sse nella ui"
```

---

### Task 6: Documentazione

**Files:**
- Modify: `README.md`

**Interfaces:** nessuna.

- [ ] **Step 1: Aggiornare il README**

Aggiungere, nella sezione "Web App" del `README.md`, un breve paragrafo "Realtime updates": la UI si aggiorna automaticamente quando un flag cambia — da un altro utente della UI o da un agente via MCP — grazie a un canale Server-Sent Events (`/admin/events`), senza bisogno di ricaricare la pagina. Testo in inglese, coerente col resto del README.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: documenta gli aggiornamenti realtime della ui"
```

---

## Note finali per l'implementatore

- Non modificare `src/storage/sqlite.ts` né `src/storage/json.ts`: il realtime è tutto nel decorator + bus + endpoint + hook.
- Flaky pre-esistente `src/test/routes-projects.test.ts`: se blocca il pre-commit SOLO lui, rilancia i tuoi in isolamento, poi riprova; `--no-verify` solo in quel caso, documentandolo.
- I test SSE sono intrinsecamente "a stream aperto": usare timeout brevi e chiusura esplicita per non lasciare handle. Preferire il test della funzione pura `formatSseMessage` se il test di streaming dà flakiness.
- Al termine, NON aprire la PR in autonomia: chiedere conferma all'utente.
